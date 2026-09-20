/**
 * ConversationService — private & group conversations.
 *
 * Design notes:
 *   - Private DMs are idempotent (unique `privateKey`).
 *   - Participant state (pin/archive/mute/unread) is per-user.
 *   - Authorization: participant to view; admin/owner to modify group.
 *   - "Deleted for me" / "left" conversations behave as 404 to the leaver.
 */

'use strict';

const mongoose = require('mongoose');
const { Conversation, User } = require('../models');
const {
    BadRequestError,
    NotFoundError,
    ForbiddenError,
    ConflictError,
} = require('../utils/exceptions');
const { publicProfile } = require('./user.service');
const { UserService } = require('./user.service');
const { participantId } = require('../utils/helpers/conversation');
const {
    CONVERSATION_TYPE,
    PARTICIPANT_ROLE,
} = require('../config/constants');
const { broadcast } = require('../sockets');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidId(id) {
    return mongoose.Types.ObjectId.isValid(id);
}

function assertValidId(id, label = 'Conversation') {
    if (!isValidId(id)) throw new BadRequestError(`Invalid ${label} ID`, 'INVALID_ID');
}

/**
 * Standard conversation serializer.
 * @param {Document|Object} conv — Mongoose doc or lean object
 * @param {string|ObjectId} viewerId — who's asking (for `myFlags`)
 */
function serializeConversation(conv, viewerId) {
    if (!conv) return null;
    const viewerStr = viewerId ? viewerId.toString() : null;

    const me = viewerStr
        ? conv.participants.find((p) => {
            const pid = participantId(p);
            return pid && pid.toString() === viewerStr;
        })
        : null;

    // Only show active participants
    const activeParticipants = conv.participants.filter((p) => !p.leftAt);

    const sortedParticipants = [...activeParticipants].sort((a, b) => {
        const rank = { owner: 0, admin: 1, member: 2 };
        const ra = rank[a.role] ?? 3;
        const rb = rank[b.role] ?? 3;
        if (ra !== rb) return ra - rb;
        return new Date(a.joinedAt) - new Date(b.joinedAt);
    });

    return {
        id: conv._id.toString(),
        type: conv.type,
        group: conv.type === CONVERSATION_TYPE.GROUP
            ? {
                name: conv.group?.name || null,
                description: conv.group?.description || '',
                avatar: conv.group?.avatar || { url: null, publicId: null },
            }
            : null,
        participants: sortedParticipants.map((p) => {
            const populatedUser = p.userId && p.userId._id ? p.userId : null;
            const pid = participantId(p);
            return {
                user: populatedUser
                    ? publicProfile(populatedUser)
                    : { id: pid ? pid.toString() : null },
                role: p.role,
                joinedAt: p.joinedAt,
            };
        }),
        lastMessage:
            conv.lastMessage && conv.lastMessage.messageId
                ? {
                    messageId: conv.lastMessage.messageId.toString(),
                    content: conv.lastMessage.content,
                    senderId: conv.lastMessage.senderId
                        ? conv.lastMessage.senderId._id
                            ? conv.lastMessage.senderId._id.toString()
                            : conv.lastMessage.senderId.toString()
                        : null,
                    type: conv.lastMessage.type,
                    createdAt: conv.lastMessage.createdAt,
                }
                : null,
        myFlags: me
            ? {
                pinned: !!me.pinned,
                archived: !!me.archived,
                muted: !!me.muted,
                mutedUntil: me.mutedUntil || null,
                unreadCount: me.unreadCount || 0,
                lastReadAt: me.lastReadAt || null,
                deleted: !!me.deleted,
            }
            : null,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
    };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class ConversationService {
    // -----------------------------------------------------------------------
    // Create
    // -----------------------------------------------------------------------

    static async create(userId, payload) {
        if (payload.type === CONVERSATION_TYPE.PRIVATE) {
            return this._createPrivate(userId, payload);
        }
        return this._createGroup(userId, payload);
    }

    static async _createPrivate(userId, { recipientId }) {
        assertValidId(recipientId, 'Recipient');

        if (recipientId.toString() === userId.toString()) {
            throw new BadRequestError(
                'Cannot create a conversation with yourself',
                'SELF_CONVERSATION'
            );
        }

        const [me, recipient] = await Promise.all([
            User.findById(userId),
            User.findById(recipientId),
        ]);

        if (!me) throw new NotFoundError('User not found', 'USER_NOT_FOUND');
        if (!recipient) throw new NotFoundError('Recipient not found', 'RECIPIENT_NOT_FOUND');

        // Block check — either direction
        const mutual = await UserService.isMutuallyBlocked(userId, recipientId);
        if (mutual) throw new ForbiddenError('Cannot message this user', 'USER_BLOCKED');

        // Try to find existing DM
        const existing = await Conversation.findPrivate(userId, recipientId);
        if (existing) {
            // Restore the DM for the caller if it was:
            //   - deleted-for-me (soft-deleted by them)
            //   - archived (moved to the archive folder)
            //
            // Rationale: the caller is explicitly opening this DM from the "+"
            // modal, which is a strong "I want this back" signal. Matches
            // WhatsApp/Telegram behavior. Sidebar clicks from the Archived tab
            // do NOT trigger this path (they use GET /conversations/:id).
            const meParticipant = existing.getParticipant(userId);
            let restored = false;

            if (meParticipant) {
                if (meParticipant.deleted) {
                    meParticipant.deleted = false;
                    meParticipant.deletedAt = null;
                    meParticipant.unreadCount = 0;
                    restored = true;
                }
                if (meParticipant.archived) {
                    meParticipant.archived = false;
                    restored = true;
                }
                if (restored) {
                    await existing.save();
                }
            }
            await existing.populate([
                {
                    path: 'participants.userId',
                    select: 'name username avatar status lastSeen settings',
                },
                { path: 'lastMessage.senderId', select: 'name username avatar' },
            ]);
            return {
                conversation: serializeConversation(existing, userId),
                created: false,
            };
        }

        // Create new
        const conv = await Conversation.create({
            type: CONVERSATION_TYPE.PRIVATE,
            participants: [
                { userId: me._id, role: PARTICIPANT_ROLE.OWNER, joinedAt: new Date() },
                { userId: recipient._id, role: PARTICIPANT_ROLE.MEMBER, joinedAt: new Date() },
            ],
            createdBy: me._id,
        });

        await conv.populate([
            {
                path: 'participants.userId',
                select: 'name username avatar status lastSeen settings',
            },
            { path: 'lastMessage.senderId', select: 'name username avatar' },
        ]);

        const participantIds = conv.participants
            .map((p) => (p.userId._id ? p.userId._id.toString() : p.userId.toString()));

        broadcast.conversationNew({
            participantIds,
            conversation: serializeConversation(conv, userId),
        });

        return {
            conversation: serializeConversation(conv, userId),
            created: true,
        };
    }

    static async _createGroup(userId, { name, description, participants, avatar }) {
        const userIdStr = userId.toString();
        const uniqueIds = Array.from(
            new Set(participants.map((p) => p.toString()).filter((id) => id !== userIdStr))
        );

        if (uniqueIds.length === 0) {
            throw new BadRequestError(
                'A group requires at least one other participant',
                'NO_PARTICIPANTS'
            );
        }

        const users = await User.find({ _id: { $in: uniqueIds } }).select('_id');
        if (users.length !== uniqueIds.length) {
            const found = new Set(users.map((u) => u._id.toString()));
            const missing = uniqueIds.filter((id) => !found.has(id));
            throw new NotFoundError(
                `Some participants were not found: ${missing.join(', ')}`,
                'PARTICIPANTS_NOT_FOUND'
            );
        }

        // Reject if the creator already belongs to a group with this name.
        // Reasoning: two groups with the same name are indistinguishable in the
        // sidebar, so we enforce uniqueness per-user. Case-insensitive to catch
        // "Project X" vs "project x".
        const escapedName = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const existingWithName = await Conversation.findOne({
            type: CONVERSATION_TYPE.GROUP,
            'group.name': { $regex: `^${escapedName}$`, $options: 'i' },
            participants: {
                $elemMatch: {
                    userId: new mongoose.Types.ObjectId(userIdStr),
                    leftAt: null,
                },
            },
        })
            .select('_id group.name')
            .lean();

        if (existingWithName) {
            throw new ConflictError(
                `You already have a group named "${name.trim()}". Please choose a different name.`,
                'GROUP_NAME_TAKEN'
            );
        }

        let conv;
        try {
            conv = await Conversation.create({
                type: CONVERSATION_TYPE.GROUP,
                group: {
                    name: name.trim(),
                    description: (description || '').trim(),
                    avatar: avatar || { url: null, publicId: null },
                },
                participants: [
                    {
                        userId: new mongoose.Types.ObjectId(userIdStr),
                        role: PARTICIPANT_ROLE.OWNER,
                        joinedAt: new Date(),
                    },
                    ...uniqueIds.map((id) => ({
                        userId: new mongoose.Types.ObjectId(id),
                        role: PARTICIPANT_ROLE.MEMBER,
                        joinedAt: new Date(),
                    })),
                ],
                createdBy: new mongoose.Types.ObjectId(userIdStr),
            });
        } catch (err) {
            // Catch any remaining duplicate-key error from a race condition
            // and surface it as a friendly message.
            if (err.code === 11000) {
                throw new ConflictError(
                    `A group named "${name.trim()}" with the same members already exists.`,
                    'GROUP_ALREADY_EXISTS'
                );
            }
            throw err;
        }

        await conv.populate([
            {
                path: 'participants.userId',
                select: 'name username avatar status lastSeen settings',
            },
            { path: 'lastMessage.senderId', select: 'name username avatar' },
        ]);

        return {
            conversation: serializeConversation(conv, userId),
            created: true,
        };
    }

    // -----------------------------------------------------------------------
    // Read
    // -----------------------------------------------------------------------

    static async getById(userId, conversationId) {
        assertValidId(conversationId);
        const conv = await Conversation.findById(conversationId)
            .populate('participants.userId', 'name username avatar status lastSeen settings')
            .populate('lastMessage.senderId', 'name username avatar');

        if (!conv) throw new NotFoundError('Conversation not found', 'CONVERSATION_NOT_FOUND');

        // Two-step authorization:
        //   1. Find MY participant entry (may be populated or not).
        //   2. If I have `deleted: true` or `leftAt` set → behave as 404 (privacy).
        //   3. If I was never a participant → 403.
        const me = conv.getParticipant(userId);
        if (me && (me.deleted || me.leftAt)) {
            throw new NotFoundError('Conversation not found', 'CONVERSATION_NOT_FOUND');
        }
        if (!conv.isParticipant(userId)) {
            throw new ForbiddenError('You are not a participant', 'NOT_PARTICIPANT');
        }

        return serializeConversation(conv, userId);
    }

    static async list(userId, { archived = false, pinned, limit = 30, before = null } = {}) {
        const l = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);

        const query = {
            'participants.userId': userId,
            'participants.deleted': { $ne: true },
        };

        if (archived) {
            query.participants = {
                $elemMatch: { userId, deleted: { $ne: true }, archived: true },
            };
        } else {
            query.participants = {
                $elemMatch: { userId, deleted: { $ne: true }, archived: { $ne: true } },
            };
        }

        if (pinned === true) {
            query.$and = [{ participants: { $elemMatch: { userId, pinned: true } } }];
        }

        if (before) {
            const beforeDate = new Date(before);
            if (!isNaN(beforeDate.getTime())) {
                query.updatedAt = { $lt: beforeDate };
            }
        }

        const items = await Conversation.find(query)
            .sort({ updatedAt: -1 })
            .limit(l)
            .populate('participants.userId', 'name username avatar status lastSeen settings')
            .populate('lastMessage.senderId', 'name username avatar');

        const serialized = items.map((c) => serializeConversation(c, userId));
        const hasMore = items.length === l;
        const nextCursor = hasMore ? items[items.length - 1].updatedAt.toISOString() : null;

        return {
            items: serialized,
            meta: { limit: l, hasMore, nextCursor },
        };
    }

    // -----------------------------------------------------------------------
    // Update group info
    // -----------------------------------------------------------------------

    static async update(userId, conversationId, updates) {
        assertValidId(conversationId);

        const conv = await Conversation.findById(conversationId);
        if (!conv) throw new NotFoundError('Conversation not found', 'CONVERSATION_NOT_FOUND');
        if (conv.type !== CONVERSATION_TYPE.GROUP) {
            throw new BadRequestError('Only groups can be updated', 'NOT_A_GROUP');
        }
        if (!conv.isParticipant(userId)) {
            throw new ForbiddenError('You are not a participant', 'NOT_PARTICIPANT');
        }
        if (!conv.isAdmin(userId)) {
            throw new ForbiddenError('Only admins can update group info', 'NOT_ADMIN');
        }

        if (updates.name !== undefined) conv.group.name = updates.name.trim();
        if (updates.description !== undefined) conv.group.description = updates.description.trim();
        if (updates.avatar !== undefined) {
            conv.group.avatar = {
                url: updates.avatar.url ?? null,
                publicId: updates.avatar.publicId ?? null,
            };
        }

        await conv.save();
        await conv.populate([
            { path: 'participants.userId', select: 'name username avatar status lastSeen settings' },
            { path: 'lastMessage.senderId', select: 'name username avatar' },
        ]);

        return serializeConversation(conv, userId);
    }

    // -----------------------------------------------------------------------
    // Members
    // -----------------------------------------------------------------------

    static async addMember(userId, conversationId, newMemberId) {
        assertValidId(conversationId);
        assertValidId(newMemberId, 'User');

        const conv = await Conversation.findById(conversationId);
        if (!conv) throw new NotFoundError('Conversation not found', 'CONVERSATION_NOT_FOUND');
        if (conv.type !== CONVERSATION_TYPE.GROUP) {
            throw new BadRequestError('Cannot add members to a private conversation', 'NOT_A_GROUP');
        }
        if (!conv.isAdmin(userId)) {
            throw new ForbiddenError('Only admins can add members', 'NOT_ADMIN');
        }

        const existing = conv.getParticipant(newMemberId);
        if (existing && !existing.leftAt && !existing.deleted) {
            throw new ConflictError('User is already a participant', 'ALREADY_PARTICIPANT');
        }

        const newUser = await User.findById(newMemberId);
        if (!newUser) throw new NotFoundError('User not found', 'USER_NOT_FOUND');

        if (existing) {
            existing.leftAt = null;
            existing.deleted = false;
            existing.deletedAt = null;
            existing.unreadCount = 0;
            existing.role = PARTICIPANT_ROLE.MEMBER;
            existing.joinedAt = new Date();
        } else {
            conv.participants.push({
                userId: newUser._id,
                role: PARTICIPANT_ROLE.MEMBER,
                joinedAt: new Date(),
            });
        }

        await conv.save();
        await conv.populate('participants.userId', 'name username avatar status lastSeen settings');

        return serializeConversation(conv, userId);
    }

    static async removeMember(userId, conversationId, targetId) {
        assertValidId(conversationId);
        assertValidId(targetId, 'User');

        if (userId.toString() === targetId.toString()) {
            throw new BadRequestError('Use the leave endpoint to remove yourself', 'USE_LEAVE');
        }

        const conv = await Conversation.findById(conversationId);
        if (!conv) throw new NotFoundError('Conversation not found', 'CONVERSATION_NOT_FOUND');
        if (conv.type !== CONVERSATION_TYPE.GROUP) {
            throw new BadRequestError(
                'Cannot remove members from a private conversation',
                'NOT_A_GROUP'
            );
        }
        if (!conv.isAdmin(userId)) {
            throw new ForbiddenError('Only admins can remove members', 'NOT_ADMIN');
        }

        const target = conv.getParticipant(targetId);
        if (!target || target.leftAt) {
            throw new NotFoundError('User is not a participant', 'NOT_PARTICIPANT');
        }
        if (target.role === PARTICIPANT_ROLE.OWNER) {
            throw new ForbiddenError('Cannot remove the group owner', 'CANNOT_REMOVE_OWNER');
        }

        target.leftAt = new Date();
        await conv.save();

        await conv.populate('participants.userId', 'name username avatar status lastSeen settings');
        return serializeConversation(conv, userId);
    }

    static async updateMemberRole(userId, conversationId, targetId, newRole) {
        assertValidId(conversationId);
        assertValidId(targetId, 'User');

        if (newRole === PARTICIPANT_ROLE.OWNER) {
            throw new BadRequestError('Cannot assign owner role directly', 'INVALID_ROLE');
        }

        const conv = await Conversation.findById(conversationId);
        if (!conv) throw new NotFoundError('Conversation not found', 'CONVERSATION_NOT_FOUND');
        if (conv.type !== CONVERSATION_TYPE.GROUP) {
            throw new BadRequestError('Only groups have roles', 'NOT_A_GROUP');
        }

        const me = conv.getParticipant(userId);
        if (!me || me.role !== PARTICIPANT_ROLE.OWNER) {
            throw new ForbiddenError('Only the owner can change roles', 'NOT_OWNER');
        }

        const target = conv.getParticipant(targetId);
        if (!target || target.leftAt) {
            throw new NotFoundError('User is not a participant', 'NOT_PARTICIPANT');
        }
        if (target.role === PARTICIPANT_ROLE.OWNER) {
            throw new ForbiddenError('Cannot change the owner role', 'CANNOT_CHANGE_OWNER');
        }

        target.role = newRole;
        await conv.save();

        await conv.populate('participants.userId', 'name username avatar status lastSeen settings');
        return serializeConversation(conv, userId);
    }

    // -----------------------------------------------------------------------
    // Leave / delete for me
    // -----------------------------------------------------------------------

    static async leave(userId, conversationId) {
        assertValidId(conversationId);
        const conv = await Conversation.findById(conversationId);
        if (!conv) throw new NotFoundError('Conversation not found', 'CONVERSATION_NOT_FOUND');

        const me = conv.getParticipant(userId);
        if (!me || me.leftAt) {
            throw new NotFoundError('You are not a participant', 'NOT_PARTICIPANT');
        }

        // For groups: if I'm the owner and others remain, transfer ownership
        if (
            conv.type === CONVERSATION_TYPE.GROUP &&
            me.role === PARTICIPANT_ROLE.OWNER
        ) {
            const others = conv.participants.filter(
                (p) => participantId(p).toString() !== userId.toString() && !p.leftAt
            );
            if (others.length > 0) {
                const nextOwner =
                    others.find((p) => p.role === PARTICIPANT_ROLE.ADMIN) ||
                    others.sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt))[0];
                nextOwner.role = PARTICIPANT_ROLE.OWNER;
            }
        }

        me.leftAt = new Date();
        me.deleted = true;
        me.deletedAt = new Date();
        await conv.save();

        return { left: true };
    }

    // -----------------------------------------------------------------------
    // Per-user flags
    // -----------------------------------------------------------------------

    static async setPinned(userId, conversationId, pinned) {
        return this._updateMyFlag(userId, conversationId, { pinned: !!pinned });
    }

    static async setArchived(userId, conversationId, archived) {
        return this._updateMyFlag(userId, conversationId, { archived: !!archived });
    }

    static async setMuted(userId, conversationId, muted, mutedUntil = null) {
        const updates = { muted: !!muted };
        if (muted) {
            updates.mutedUntil = mutedUntil ? new Date(mutedUntil) : null;
        } else {
            updates.mutedUntil = null;
        }
        return this._updateMyFlag(userId, conversationId, updates);
    }

    static async markRead(userId, conversationId, upToMessageId = null) {
        assertValidId(conversationId);
        const conv = await Conversation.findById(conversationId);
        if (!conv) throw new NotFoundError('Conversation not found', 'CONVERSATION_NOT_FOUND');

        const me = conv.getParticipant(userId);
        if (!me || me.leftAt) {
            throw new ForbiddenError('You are not a participant', 'NOT_PARTICIPANT');
        }

        const lastReadAt = new Date();
        const lastReadMessageId = upToMessageId
            ? new mongoose.Types.ObjectId(upToMessageId)
            : null;

        // ---------------------------------------------------------------------
        // 1. Update the caller's participant flags on the conversation.
        //    Use updateOne + timestamps:false so this doesn't reorder the
        //    sidebar (order is driven by lastMessage.createdAt).
        // ---------------------------------------------------------------------
        const setFields = {
            'participants.$[p].unreadCount': 0,
            'participants.$[p].lastReadAt': lastReadAt,
        };
        if (lastReadMessageId) {
            setFields['participants.$[p].lastReadMessageId'] = lastReadMessageId;
        }

        await Conversation.updateOne(
            { _id: conversationId },
            { $set: setFields },
            {
                arrayFilters: [
                    { 'p.userId': new mongoose.Types.ObjectId(userId.toString()) },
                ],
                timestamps: false,
            }
        );

        // ---------------------------------------------------------------------
        // 2. Mark messages as read by this user.
        //
        //    This is what drives the sender's read receipts. We add the user
        //    to readBy[] on every message they haven't already read.
        //
        //    Constraints:
        //      - Only messages in this conversation
        //      - Only messages NOT sent by the caller (you can't "read" your
        //        own message — you always have, and it's already counted)
        //      - Only messages up to upToMessageId (if provided)
        //      - Skip messages already containing the user in readBy (idempotent)
        // ---------------------------------------------------------------------
        const { Message } = require('../models');

        const messageFilter = {
            conversationId,
            senderId: { $ne: new mongoose.Types.ObjectId(userId.toString()) },
            'readBy.userId': { $ne: new mongoose.Types.ObjectId(userId.toString()) },
        };

        if (lastReadMessageId) {
            messageFilter._id = { $lte: lastReadMessageId };
        }

        await Message.updateMany(messageFilter, {
            $push: { readBy: { userId, readAt: lastReadAt } },
        });
        // Notify all participants that this user has read up to a message.
        // The sender's UI uses this to flip the read tick in real time.
        const { broadcast } = require('../sockets');
        if (broadcast) {
            broadcast.messageRead({
                conversationId: conversationId.toString(),
                userId: userId.toString(),
                upToMessageId: lastReadMessageId ? lastReadMessageId.toString() : null,
                readAt: lastReadAt,
            });
        }
        // ---------------------------------------------------------------------
        // 3. Return the same shape as before so nothing downstream breaks.
        //    The socket broadcast is fired by the controller, not here, so
        //    we don't duplicate it.
        // ---------------------------------------------------------------------
        return {
            unreadCount: 0,
            lastReadAt,
            lastReadMessageId,
        };
    }

    static async _updateMyFlag(userId, conversationId, updates) {
        assertValidId(conversationId);
        const conv = await Conversation.findById(conversationId);
        if (!conv) throw new NotFoundError('Conversation not found', 'CONVERSATION_NOT_FOUND');

        const me = conv.getParticipant(userId);
        if (!me || me.leftAt) {
            throw new ForbiddenError('You are not a participant', 'NOT_PARTICIPANT');
        }

        // Restore from "deleted for me" if the user re-engages
        const shouldUndelete =
            me.deleted &&
            Object.keys(updates).some((k) => k === 'pinned' || k === 'archived' || k === 'muted');

        const setFields = {};
        for (const [key, value] of Object.entries(updates)) {
            setFields[`participants.$[p].${key}`] = value;
        }
        if (shouldUndelete) {
            setFields['participants.$[p].deleted'] = false;
            setFields['participants.$[p].deletedAt'] = null;
        }

        // Use updateOne + timestamps: false — flag changes must not reorder.
        await Conversation.updateOne(
            { _id: conversationId },
            { $set: setFields },
            {
                arrayFilters: [{ 'p.userId': new mongoose.Types.ObjectId(userId.toString()) }],
                timestamps: false,
            }
        );

        // Reload for the return value
        const fresh = await Conversation.findById(conversationId).populate(
            'participants.userId',
            'name username avatar status lastSeen settings'
        );

        return serializeConversation(fresh, userId);
    }

    // -----------------------------------------------------------------------
    // Utilities used by other services
    // -----------------------------------------------------------------------

    static async requireParticipant(userId, conversationId) {
        assertValidId(conversationId);
        const conv = await Conversation.findById(conversationId);
        if (!conv) throw new NotFoundError('Conversation not found', 'CONVERSATION_NOT_FOUND');
        if (!conv.isParticipant(userId)) {
            throw new ForbiddenError('You are not a participant', 'NOT_PARTICIPANT');
        }
        return conv;
    }

    static async incrementUnread(conversationId, senderId) {
        await Conversation.updateOne(
            { _id: conversationId },
            { $inc: { 'participants.$[p].unreadCount': 1 } },
            {
                arrayFilters: [
                    {
                        'p.userId': { $ne: senderId },
                        'p.leftAt': null,
                        'p.deleted': { $ne: true },
                    },
                ],
            }
        );
    }

    static async findOrCreatePrivate(userId, recipientId) {
        return this._createPrivate(userId, { recipientId });
    }
}

module.exports = { ConversationService, serializeConversation };