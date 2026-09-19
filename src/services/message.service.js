/**
 * MessageService — send, read, edit, delete, react, star, pin, forward, search.
 *
 * Design notes:
 *   - All visibility checks funnel through `isVisibleTo`.
 *   - `senderId` may be populated; use `refId` everywhere.
 *   - Reactions: one per user per message (toggling replaces).
 *   - Edit window: 15 minutes by default; configurable via env.
 *   - Notifications + socket broadcasts are fire-and-forget and never fail
 *     the primary operation.
 */

'use strict';

const mongoose = require('mongoose');
const { Message, Conversation, User } = require('../models');
const {
    BadRequestError,
    NotFoundError,
    ForbiddenError,
} = require('../utils/exceptions');
const logger = require('../config/logger');
const { publicProfile } = require('./user.service');
const { UserService } = require('./user.service');
const { ConversationService } = require('./conversation.service');
const { NotificationService } = require('./notification.service');
const { broadcast } = require('../sockets');
const {
    refId,
    isVisibleTo,
    isValidEmoji,
    buildPreview,
} = require('../utils/helpers/message');
const {
    MESSAGE_TYPE,
    CONVERSATION_TYPE,
    PARTICIPANT_ROLE,
} = require('../config/constants');

const EDIT_WINDOW_MS = parseInt(process.env.MESSAGE_EDIT_WINDOW_MS || '900000', 10); // 15 min

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidId(id) {
    return mongoose.Types.ObjectId.isValid(id);
}

function assertValidId(id, label = 'Message') {
    if (!isValidId(id)) throw new BadRequestError(`Invalid ${label} ID`, 'INVALID_ID');
}

/**
 * Serialize a message for a given viewer.
 * Strips deleted content and per-user fields as needed.
 */
function serializeMessage(message, viewerId) {
    if (!message) return null;

    const isDeleted = message.deletedForEveryone === true;
    const populatedSender =
        message.senderId && message.senderId._id ? message.senderId : null;
    const senderId = refId(message.senderId);

    // Reaction summary: { emoji: { count, mine } }
    const reactionSummary = {};
    for (const r of message.reactions || []) {
        const rid = refId(r.userId).toString();
        if (!reactionSummary[r.emoji]) reactionSummary[r.emoji] = { count: 0, mine: false };
        reactionSummary[r.emoji].count += 1;
        if (viewerId && rid === viewerId.toString()) {
            reactionSummary[r.emoji].mine = true;
        }
    }

    // Reply preview
    let replyPreview = null;
    if (message.replyTo && message.replyTo._id) {
        const r = message.replyTo;
        replyPreview = {
            id: r._id.toString(),
            content: r.deletedForEveryone ? '' : r.content || '',
            type: r.type,
            sender:
                r.senderId && r.senderId._id
                    ? publicProfile(r.senderId)
                    : { id: refId(r.senderId)?.toString() || null },
            deleted: !!r.deletedForEveryone,
        };
    } else if (message.replyTo) {
        replyPreview = { id: message.replyTo.toString() };
    }

    return {
        id: message._id.toString(),
        conversationId: message.conversationId.toString(),
        sender: populatedSender
            ? publicProfile(populatedSender)
            : { id: senderId ? senderId.toString() : null },
        content: isDeleted ? '' : message.content || '',
        type: message.type,
        attachments: isDeleted ? [] : message.attachments || [],
        replyTo: replyPreview,
        forwardedFrom: message.forwardedFrom
            ? refId(message.forwardedFrom).toString()
            : null,
        reactions: reactionSummary,
        readBy: (message.readBy || []).map((r) => ({
            userId: refId(r.userId).toString(),
            readAt: r.readAt,
        })),
        deliveredTo: (message.deliveredTo || []).map((d) => ({
            userId: refId(d.userId).toString(),
            deliveredAt: d.deliveredAt,
        })),
        isEdited: !!message.isEdited,
        editedAt: message.editedAt || null,
        isDeleted,
        deletedAt: message.deletedAt || null,
        isStarred: viewerId
            ? (message.starredBy || []).some(
                (id) => refId(id).toString() === viewerId.toString()
            )
            : false,
        isPinned: !!message.isPinned,
        isSystemMessage: !!message.isSystemMessage,
        mentions: (message.mentions || []).map((id) => refId(id).toString()),
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
    };
}

/**
 * Extract active participant IDs from a conversation.
 * Works whether participants.userId is populated or not.
 */
function activeParticipantIds(conv) {
    return conv.participants
        .filter((p) => !p.leftAt && !p.deleted)
        .map((p) => (p.userId._id ? p.userId._id.toString() : p.userId.toString()));
}



// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class MessageService {
    // -----------------------------------------------------------------------
    // Send
    // -----------------------------------------------------------------------

    static async send(senderId, payload) {
        const { conversationId, content, type, attachments, replyTo, mentions } = payload;
        assertValidId(conversationId, 'Conversation');

        const conv = await ConversationService.requireParticipant(senderId, conversationId);

        // Block enforcement (private only)
        if (conv.type === CONVERSATION_TYPE.PRIVATE) {
            const recipientId = conv.otherParticipant(senderId);
            if (recipientId) {
                const blocked = await UserService.isMutuallyBlocked(senderId, recipientId);
                if (blocked) {
                    throw new ForbiddenError('Cannot message this user', 'USER_BLOCKED');
                }
            }
        }

        // Validate reply-to
        let replyToId = null;
        if (replyTo) {
            assertValidId(replyTo, 'Reply');
            const parent = await Message.findById(replyTo);
            if (!parent || parent.conversationId.toString() !== conversationId.toString()) {
                throw new BadRequestError('Invalid reply target', 'INVALID_REPLY');
            }
            if (parent.deletedForEveryone) {
                throw new BadRequestError('Cannot reply to a deleted message', 'REPLY_DELETED');
            }
            replyToId = parent._id;
        }

        // Determine final type
        let finalType = type;
        if (!finalType || finalType === MESSAGE_TYPE.TEXT) {
            if (attachments && attachments.length > 0) {
                const first = attachments[0];
                finalType = first.type || MESSAGE_TYPE.FILE;
            } else {
                finalType = MESSAGE_TYPE.TEXT;
            }
        }

        const message = await Message.create({
            conversationId: conv._id,
            senderId,
            content: content || '',
            type: finalType,
            attachments: attachments || [],
            replyTo: replyToId,
            mentions: mentions || [],
            deliveredTo: [{ userId: senderId, deliveredAt: new Date() }],
            readBy: [{ userId: senderId, readAt: new Date() }],
        });

        // Update conversation denormalized lastMessage
        await conv.updateLastMessage({
            messageId: message._id,
            content: buildPreview(message),
            senderId,
            type: message.type,
            createdAt: message.createdAt,
        });

        // Increment unread count for other participants
        await ConversationService.incrementUnread(conv._id, senderId);

        // ---------------------------------------------------------------------
        // Fire-and-forget notification fan-out.
        // Never awaited — a notification failure must not fail the message send.
        // ---------------------------------------------------------------------
        (async () => {
            try {
                const senderUser = await User.findById(senderId).select('name username').lean();
                const senderName = senderUser?.name || 'Someone';
                const hydrated = await Conversation.findById(conv._id);
                if (!hydrated) return;
                await NotificationService.notifyNewMessage(hydrated, message, senderName);
            } catch (err) {
                logger.error(`Notification fan-out failed: ${err.message}`);
            }
        })();

        // Populate for serialization
        await message.populate([
            { path: 'senderId', select: 'name username avatar status lastSeen settings' },
            {
                path: 'replyTo',
                select: 'content type senderId deletedForEveryone',
                populate: { path: 'senderId', select: 'name username avatar' },
            },
        ]);

        const serialized = serializeMessage(message, senderId);

        // ---------------------------------------------------------------------
        // Real-time broadcast
        // ---------------------------------------------------------------------
        broadcast.newMessage({
            conversationId: conv._id.toString(),
            participantIds: activeParticipantIds(conv),
            message: serialized,
            senderId: senderId.toString(),
        });

        return serialized;
    }

    /**
     * Mark a message as delivered by a user (idempotent).
     */
    static async markDelivered(userId, messageId) {
        assertValidId(messageId);
        const message = await Message.findById(messageId);
        if (!message) throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');

        const conv = await Conversation.findById(message.conversationId).select('participants');
        if (!conv || !conv.isParticipant(userId)) {
            throw new ForbiddenError('You are not a participant', 'NOT_PARTICIPANT');
        }

        const already = (message.deliveredTo || []).some(
            (d) => refId(d.userId).toString() === userId.toString()
        );
        if (!already) {
            message.deliveredTo.push({ userId, deliveredAt: new Date() });
            await message.save();
        }

        return { delivered: true, alreadyDelivered: already };
    }

    // -----------------------------------------------------------------------
    // Read (single / history)
    // -----------------------------------------------------------------------

    static async getById(viewerId, messageId) {
        assertValidId(messageId);
        const message = await Message.findById(messageId)
            .populate('senderId', 'name username avatar status lastSeen settings')
            .populate({
                path: 'replyTo',
                select: 'content type senderId deletedForEveryone',
                populate: { path: 'senderId', select: 'name username avatar' },
            });

        if (!message) throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');

        const conv = await Conversation.findById(message.conversationId).select('participants');
        const isParticipant = conv && conv.isParticipant(viewerId);
        if (!isParticipant) {
            throw new ForbiddenError('You are not a participant', 'NOT_PARTICIPANT');
        }

        if (!isVisibleTo(message, viewerId)) {
            throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');
        }

        return serializeMessage(message, viewerId);
    }

    static async getHistory(viewerId, conversationId, { limit = 30, before, after } = {}) {
        assertValidId(conversationId, 'Conversation');
        const l = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);

        await ConversationService.requireParticipant(viewerId, conversationId);

        const query = {
            conversationId,
            // Return tombstoned messages (deletedForEveryone: true) — the UI
            // renders them as "This message was deleted". Only exclude messages
            // the viewer deleted for themselves.
            deletedFor: { $ne: viewerId },
        };

        if (before) {
            const d = new Date(before);
            if (!isNaN(d.getTime())) query.createdAt = { ...(query.createdAt || {}), $lt: d };
        }
        if (after) {
            const d = new Date(after);
            if (!isNaN(d.getTime())) query.createdAt = { ...(query.createdAt || {}), $gt: d };
        }

        const docs = await Message.find(query)
            .sort({ createdAt: -1 })
            .limit(l)
            .populate('senderId', 'name username avatar status lastSeen settings')
            .populate({
                path: 'replyTo',
                select: 'content type senderId deletedForEveryone',
                populate: { path: 'senderId', select: 'name username avatar' },
            });

        const items = docs.map((m) => serializeMessage(m, viewerId));
        const hasMore = docs.length === l;
        const nextCursor = hasMore
            ? docs[docs.length - 1].createdAt.toISOString()
            : null;

        return {
            items,
            meta: { limit: l, hasMore, nextCursor },
        };
    }

    // -----------------------------------------------------------------------
    // Edit
    // -----------------------------------------------------------------------

    static async edit(senderId, messageId, { content }) {
        assertValidId(messageId);
        const message = await Message.findById(messageId);
        if (!message) throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');

        if (refId(message.senderId).toString() !== senderId.toString()) {
            throw new ForbiddenError('Only the sender can edit this message', 'NOT_SENDER');
        }
        if (message.deletedForEveryone) {
            throw new BadRequestError('Cannot edit a deleted message', 'MESSAGE_DELETED');
        }
        if (message.type !== MESSAGE_TYPE.TEXT) {
            throw new BadRequestError('Only text messages can be edited', 'NOT_EDITABLE');
        }

        const age = Date.now() - new Date(message.createdAt).getTime();
        if (age > EDIT_WINDOW_MS) {
            throw new ForbiddenError('Edit window has expired', 'EDIT_WINDOW_EXPIRED');
        }

        if (!message.originalContent) {
            message.originalContent = message.content;
        }
        message.content = content;
        message.isEdited = true;
        message.editedAt = new Date();
        await message.save();

        await message.populate('senderId', 'name username avatar status lastSeen settings');

        const serialized = serializeMessage(message, senderId);

        broadcast.messageEdited({
            conversationId: message.conversationId.toString(),
            message: serialized,
        });

        return serialized;
    }

    // -----------------------------------------------------------------------
    // Delete
    // -----------------------------------------------------------------------

    static async delete(userId, messageId, scope = 'me') {
        assertValidId(messageId);
        const message = await Message.findById(messageId);
        if (!message) throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');

        const conv = await Conversation.findById(message.conversationId).select(
            'participants type lastMessage'
        );
        if (!conv || !conv.isParticipant(userId)) {
            throw new ForbiddenError('You are not a participant', 'NOT_PARTICIPANT');
        }

        if (scope === 'everyone') {
            const isSender = refId(message.senderId).toString() === userId.toString();
            const isAdmin = conv.isAdmin(userId);
            if (!isSender && !isAdmin) {
                throw new ForbiddenError(
                    'Only the sender or an admin can delete for everyone',
                    'NOT_ALLOWED'
                );
            }
            if (message.deletedForEveryone) {
                return { deleted: 'everyone', alreadyDeleted: true };
            }

            await message.softDeleteForEveryone();

            if (conv.lastMessage?.messageId?.toString() === message._id.toString()) {
                conv.lastMessage = {
                    messageId: message._id,
                    content: 'This message was deleted',
                    senderId: refId(message.senderId),
                    type: 'text',
                    createdAt: message.createdAt,
                };
                await conv.save();
            }

            broadcast.messageDeleted({
                conversationId: message.conversationId.toString(),
                messageId: message._id.toString(),
                deletedForEveryone: true,
                actorId: userId.toString(),
            });

            return { deleted: 'everyone' };
        }

        await message.softDeleteForUser(userId);
        return { deleted: 'me' };
    }

    // -----------------------------------------------------------------------
    // Reactions
    // -----------------------------------------------------------------------

    static async addReaction(userId, messageId, emoji) {
        assertValidId(messageId);
        if (!isValidEmoji(emoji)) {
            throw new BadRequestError('Invalid emoji', 'INVALID_EMOJI');
        }

        const message = await Message.findById(messageId);
        if (!message) throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');
        if (message.deletedForEveryone) {
            throw new BadRequestError('Cannot react to a deleted message', 'MESSAGE_DELETED');
        }

        const conv = await Conversation.findById(message.conversationId).select('participants');
        if (!conv || !conv.isParticipant(userId)) {
            throw new ForbiddenError('You are not a participant', 'NOT_PARTICIPANT');
        }

        // One reaction per user: remove any existing from this user, add new one
        const before = message.reactions.length;
        message.reactions = message.reactions.filter(
            (r) => refId(r.userId).toString() !== userId.toString()
        );
        message.reactions.push({ userId, emoji, createdAt: new Date() });
        await message.save();

        // Fire-and-forget reaction notification
        (async () => {
            try {
                const reactor = await User.findById(userId).select('name username').lean();
                if (!reactor) return;
                await NotificationService.notifyReaction(
                    message,
                    userId,
                    reactor.name || 'Someone',
                    emoji
                );
            } catch (err) {
                logger.error(`Reaction notification failed: ${err.message}`);
            }
        })();

        const payload = {
            added: true,
            emoji,
            replaced: before !== message.reactions.length,
        };

        broadcast.messageReaction({
            conversationId: message.conversationId.toString(),
            messageId: message._id.toString(),
            userId: userId.toString(),
            emoji,
            added: true,
        });

        return payload;
    }

    static async removeReaction(userId, messageId) {
        assertValidId(messageId);
        const message = await Message.findById(messageId);
        if (!message) throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');

        const before = message.reactions.length;
        message.reactions = message.reactions.filter(
            (r) => refId(r.userId).toString() !== userId.toString()
        );
        const removed = message.reactions.length < before;
        if (removed) await message.save();

        if (removed) {
            broadcast.messageReaction({
                conversationId: message.conversationId.toString(),
                messageId: message._id.toString(),
                userId: userId.toString(),
                emoji: null,
                added: false,
            });
        }

        return { removed };
    }

    // -----------------------------------------------------------------------
    // Star / Pin
    // -----------------------------------------------------------------------

    static async star(userId, messageId) {
        assertValidId(messageId);
        const message = await Message.findById(messageId);
        if (!message) throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');
        if (message.deletedForEveryone) {
            throw new BadRequestError('Cannot star a deleted message', 'MESSAGE_DELETED');
        }

        const already = (message.starredBy || []).some(
            (id) => refId(id).toString() === userId.toString()
        );
        if (!already) {
            message.starredBy.push(userId);
            await message.save();
        }
        return { starred: true, alreadyStarred: already };
    }

    static async unstar(userId, messageId) {
        assertValidId(messageId);
        const message = await Message.findById(messageId);
        if (!message) throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');

        const before = message.starredBy.length;
        message.starredBy = message.starredBy.filter(
            (id) => refId(id).toString() !== userId.toString()
        );
        const removed = message.starredBy.length < before;
        if (removed) await message.save();
        return { unstarred: removed };
    }

    static async pin(userId, messageId) {
        assertValidId(messageId);
        const message = await Message.findById(messageId);
        if (!message) throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');
        if (message.deletedForEveryone) {
            throw new BadRequestError('Cannot pin a deleted message', 'MESSAGE_DELETED');
        }

        const conv = await Conversation.findById(message.conversationId);
        if (!conv || !conv.isParticipant(userId)) {
            throw new ForbiddenError('You are not a participant', 'NOT_PARTICIPANT');
        }
        if (
            conv.type === CONVERSATION_TYPE.GROUP &&
            !conv.isAdmin(userId) &&
            refId(message.senderId).toString() !== userId.toString()
        ) {
            throw new ForbiddenError('Only admins or the sender can pin', 'NOT_ALLOWED');
        }

        if (!message.isPinned) {
            message.isPinned = true;
            message.pinnedBy = userId;
            message.pinnedAt = new Date();
            await message.save();
        }
        if (!conv.pinnedMessages.some((id) => id.toString() === message._id.toString())) {
            conv.pinnedMessages.push(message._id);
            await conv.save();
        }
        return { pinned: true };
    }

    static async unpin(userId, messageId) {
        assertValidId(messageId);
        const message = await Message.findById(messageId);
        if (!message) throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');

        const conv = await Conversation.findById(message.conversationId);
        if (!conv || !conv.isParticipant(userId)) {
            throw new ForbiddenError('You are not a participant', 'NOT_PARTICIPANT');
        }
        if (
            conv.type === CONVERSATION_TYPE.GROUP &&
            !conv.isAdmin(userId) &&
            refId(message.senderId).toString() !== userId.toString()
        ) {
            throw new ForbiddenError('Only admins or the sender can unpin', 'NOT_ALLOWED');
        }

        if (message.isPinned) {
            message.isPinned = false;
            message.pinnedBy = null;
            message.pinnedAt = null;
            await message.save();
        }
        conv.pinnedMessages = conv.pinnedMessages.filter(
            (id) => id.toString() !== message._id.toString()
        );
        await conv.save();
        return { unpinned: true };
    }

    // -----------------------------------------------------------------------
    // Read receipt (single)
    // -----------------------------------------------------------------------

    static async markRead(userId, messageId) {
        assertValidId(messageId);
        const message = await Message.findById(messageId);
        if (!message) throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');

        const conv = await Conversation.findById(message.conversationId).select('participants');
        if (!conv || !conv.isParticipant(userId)) {
            throw new ForbiddenError('You are not a participant', 'NOT_PARTICIPANT');
        }

        const already = (message.readBy || []).some(
            (r) => refId(r.userId).toString() === userId.toString()
        );
        if (!already) {
            message.readBy.push({ userId, readAt: new Date() });
            await message.save();
        }

        broadcast.messageRead({
            conversationId: message.conversationId.toString(),
            userId: userId.toString(),
            upToMessageId: message._id.toString(),
            readAt: new Date(),
        });

        return { read: true, alreadyRead: already };
    }

    // -----------------------------------------------------------------------
    // Forward
    // -----------------------------------------------------------------------

    static async forward(userId, { messageId, conversationId }) {
        assertValidId(messageId);
        assertValidId(conversationId, 'Conversation');

        const source = await Message.findById(messageId);
        if (!source) throw new NotFoundError('Message not found', 'MESSAGE_NOT_FOUND');
        if (source.deletedForEveryone) {
            throw new BadRequestError('Cannot forward a deleted message', 'MESSAGE_DELETED');
        }

        const sourceConv = await Conversation.findById(source.conversationId).select('participants');
        if (!sourceConv || !sourceConv.isParticipant(userId)) {
            throw new ForbiddenError('You are not a participant', 'NOT_PARTICIPANT');
        }

        const targetConv = await ConversationService.requireParticipant(userId, conversationId);

        if (targetConv.type === CONVERSATION_TYPE.PRIVATE) {
            const recipientId = targetConv.otherParticipant(userId);
            if (recipientId) {
                const blocked = await UserService.isMutuallyBlocked(userId, recipientId);
                if (blocked) {
                    throw new ForbiddenError('Cannot message this user', 'USER_BLOCKED');
                }
            }
        }

        const forwarded = await Message.create({
            conversationId: targetConv._id,
            senderId: userId,
            content: source.content,
            type: source.type,
            attachments: source.attachments,
            forwardedFrom: source._id,
            deliveredTo: [{ userId, deliveredAt: new Date() }],
            readBy: [{ userId, readAt: new Date() }],
        });

        await targetConv.updateLastMessage({
            messageId: forwarded._id,
            content: buildPreview(forwarded),
            senderId: userId,
            type: forwarded.type,
            createdAt: forwarded.createdAt,
        });

        await ConversationService.incrementUnread(targetConv._id, userId);

        // Fire-and-forget notification for the forwarded message
        (async () => {
            try {
                const sender = await User.findById(userId).select('name username').lean();
                const hydrated = await Conversation.findById(targetConv._id);
                if (!hydrated) return;
                await NotificationService.notifyNewMessage(
                    hydrated,
                    forwarded,
                    sender?.name || 'Someone'
                );
            } catch (err) {
                logger.error(`Forward notification failed: ${err.message}`);
            }
        })();

        await forwarded.populate('senderId', 'name username avatar status lastSeen settings');
        const serialized = serializeMessage(forwarded, userId);

        // Real-time broadcast
        broadcast.newMessage({
            conversationId: targetConv._id.toString(),
            participantIds: activeParticipantIds(targetConv),
            message: serialized,
            senderId: userId.toString(),
        });

        return serialized;
    }

    // -----------------------------------------------------------------------
    // Search
    // -----------------------------------------------------------------------

    static async search(
        viewerId,
        { q, conversationId, senderId, from, to, hasAttachment, limit = 20, before }
    ) {
        const l = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);

        let conversationIds;
        if (conversationId) {
            assertValidId(conversationId, 'Conversation');
            await ConversationService.requireParticipant(viewerId, conversationId);
            conversationIds = [new mongoose.Types.ObjectId(conversationId)];
        } else {
            const convs = await Conversation.find({ 'participants.userId': viewerId })
                .select('_id')
                .lean();
            conversationIds = convs.map((c) => c._id);
            if (conversationIds.length === 0) {
                return { items: [], meta: { limit: l, hasMore: false, nextCursor: null } };
            }
        }

        const filter = {
            conversationId: { $in: conversationIds },
            deletedForEveryone: { $ne: true },
            deletedFor: { $ne: viewerId },
        };

        if (q && q.trim().length > 0) {
            filter.$text = { $search: q.trim() };
        }

        if (senderId) {
            assertValidId(senderId, 'Sender');
            filter.senderId = new mongoose.Types.ObjectId(senderId);
        }

        if (from || to) {
            filter.createdAt = {};
            if (from) filter.createdAt.$gte = new Date(from);
            if (to) filter.createdAt.$lte = new Date(to);
        }

        if (hasAttachment === true) {
            filter['attachments.0'] = { $exists: true };
        }

        if (before) {
            const d = new Date(before);
            if (!isNaN(d.getTime())) {
                filter.createdAt = { ...(filter.createdAt || {}), $lt: d };
            }
        }

        let query = Message.find(filter);

        if (filter.$text) {
            query = query
                .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
                .select({ score: { $meta: 'textScore' } });
        } else {
            query = query.sort({ createdAt: -1 });
        }

        const docs = await query
            .limit(l)
            .populate('senderId', 'name username avatar status lastSeen settings')
            .populate({
                path: 'replyTo',
                select: 'content type senderId deletedForEveryone',
                populate: { path: 'senderId', select: 'name username avatar' },
            });

        const items = docs.map((m) => serializeMessage(m, viewerId));
        const hasMore = docs.length === l;
        const nextCursor = hasMore ? docs[docs.length - 1].createdAt.toISOString() : null;

        return { items, meta: { limit: l, hasMore, nextCursor } };
    }
}

module.exports = { MessageService, serializeMessage };