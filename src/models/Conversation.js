/**
 * Conversation model.
 *
 * Handles both private (1:1) and group conversations.
 * Participants are embedded (bounded, always needed with conversation).
 *
 * Indexes:
 *   - participants.userId + updatedAt: list conversations sorted by activity
 *   - type + participants.userId: filter by type
 *   - private key (sorted participant pair): enforce uniqueness of DMs
 */

'use strict';

const mongoose = require('mongoose');
const { baseSchemaOptions } = require('../utils/helpers/schemaHelpers');
const { CONVERSATION_TYPE, PARTICIPANT_ROLE } = require('../config/constants');

const { Schema } = mongoose;

const { participantId } = require('../utils/helpers/conversation');

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const ParticipantSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        role: {
            type: String,
            enum: Object.values(PARTICIPANT_ROLE),
            default: PARTICIPANT_ROLE.MEMBER,
        },
        joinedAt: { type: Date, default: Date.now },
        muted: { type: Boolean, default: false },
        mutedUntil: { type: Date, default: null },
        pinned: { type: Boolean, default: false },
        archived: { type: Boolean, default: false },
        deleted: { type: Boolean, default: false }, // "delete for me"
        deletedAt: { type: Date, default: null },
        lastReadAt: { type: Date, default: Date.now },
        lastReadMessageId: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
        unreadCount: { type: Number, default: 0, min: 0 },
        leftAt: { type: Date, default: null },
    },
    { _id: false }
);

const LastMessageSchema = new Schema(
    {
        messageId: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
        content: { type: String, default: '' },
        senderId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        type: { type: String, default: 'text' },
        createdAt: { type: Date, default: null },
    },
    { _id: false }
);

const GroupInfoSchema = new Schema(
    {
        name: {
            type: String,
            trim: true,
            maxlength: [100, 'Group name cannot exceed 100 characters'],
            default: null,
        },
        description: {
            type: String,
            trim: true,
            maxlength: [500, 'Description cannot exceed 500 characters'],
            default: '',
        },
        avatar: {
            url: { type: String, default: null },
            publicId: { type: String, default: null },
        },
    },
    { _id: false }
);

// ---------------------------------------------------------------------------
// Main schema
// ---------------------------------------------------------------------------

const ConversationSchema = new Schema(
    {
        type: {
            type: String,
            enum: Object.values(CONVERSATION_TYPE),
            required: true,
            index: true,
        },
        // For private conversations: sorted "userA:userB" string with lexicographically smaller ID first.
        // Enforces single DM per user pair.
        privateKey: {
            type: String,
            unique: true,
            sparse: true, // only indexed when set (i.e., private only)
        },
        group: { type: GroupInfoSchema, default: null },
        participants: {
            type: [ParticipantSchema],
            required: true,
            validate: {
                validator: (v) => Array.isArray(v) && v.length >= 2,
                message: 'A conversation requires at least 2 participants',
            },
        },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        lastMessage: { type: LastMessageSchema, default: () => ({}) },

        // Group-specific: pinned messages
        pinnedMessages: [{ type: Schema.Types.ObjectId, ref: 'Message' }],

        // System meta
        isActive: { type: Boolean, default: true },
    },
    baseSchemaOptions
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// List conversations for a user, sorted by recent activity
ConversationSchema.index(
    { 'participants.userId': 1, updatedAt: -1 },
    { name: 'conv_by_participant_updated' }
);

// Filter by type for a user
ConversationSchema.index(
    { type: 1, 'participants.userId': 1 },
    { name: 'conv_type_participant' }
);

// Group names (for search)
ConversationSchema.index(
    { 'group.name': 'text', 'group.description': 'text' },
    { name: 'conv_group_text', sparse: true }
);

// ---------------------------------------------------------------------------
// Virtuals
// ---------------------------------------------------------------------------

ConversationSchema.virtual('isGroup').get(function () {
    return this.type === CONVERSATION_TYPE.GROUP;
});

// ---------------------------------------------------------------------------
// Pre-validate: enforce private key uniqueness + participant ordering
// ---------------------------------------------------------------------------

ConversationSchema.pre('validate', function (next) {
    if (this.type === CONVERSATION_TYPE.PRIVATE) {
        if (this.participants.length !== 2) {
            return next(new Error('Private conversations must have exactly 2 participants'));
        }
        const ids = this.participants
            .map((p) => p.userId.toString())
            .sort();
        this.privateKey = `${ids[0]}:${ids[1]}`;
        if (!this.group) this.group = null;
    } else if (this.type === CONVERSATION_TYPE.GROUP) {
        if (!this.group || !this.group.name) {
            return next(new Error('Group conversations require a name'));
        }
        this.privateKey = undefined;
    }
    next();
});

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

ConversationSchema.methods.isParticipant = function (userId) {
    if (!userId) return false;
    const idStr = userId.toString();
    return this.participants.some((p) => {
        const pid = participantId(p);
        return pid && pid.toString() === idStr && !p.leftAt;
    });
};

ConversationSchema.methods.getParticipant = function (userId) {
    const idStr = userId.toString();
    return this.participants.find((p) => {
        const pid = participantId(p);
        return pid && pid.toString() === idStr;
    });
};

ConversationSchema.methods.isAdmin = function (userId) {
    const p = this.getParticipant(userId);
    if (!p) return false;
    return p.role === PARTICIPANT_ROLE.ADMIN || p.role === PARTICIPANT_ROLE.OWNER;
};

/**
 * Get the other user's ID in a private conversation.
 */
ConversationSchema.methods.otherParticipant = function (userId) {
    if (this.type !== CONVERSATION_TYPE.PRIVATE) return null;
    const idStr = userId.toString();
    const other = this.participants.find((p) => p.userId.toString() !== idStr);
    return other ? other.userId : null;
};

/**
 * Update the last message + bump updatedAt.
 */
ConversationSchema.methods.updateLastMessage = function ({ messageId, content, senderId, type, createdAt }) {
    this.lastMessage = {
        messageId,
        content: (content || '').substring(0, 200),
        senderId,
        type,
        createdAt: createdAt || new Date(),
    };
    // touch updatedAt explicitly for the index
    this.updatedAt = new Date();
    return this.save();
};

// ---------------------------------------------------------------------------
// Statics
// ---------------------------------------------------------------------------

/**
 * Find a private conversation between exactly two users.
 */
ConversationSchema.statics.findPrivate = function (userIdA, userIdB) {
    const ids = [userIdA.toString(), userIdB.toString()].sort();
    const key = `${ids[0]}:${ids[1]}`;
    return this.findOne({ type: CONVERSATION_TYPE.PRIVATE, privateKey: key });
};

/**
 * List conversations for a user (paginated), excluding "deleted for me".
 */
ConversationSchema.statics.listForUser = function (userId, { limit = 20, skip = 0, archived = false } = {}) {
    return this.find({
        'participants.userId': userId,
        'participants.deleted': { $ne: true },
    })
        .where({
            // archived filter applies only to this user's participant entry
        })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('participants.userId', 'name username avatar status lastSeen')
        .populate('lastMessage.senderId', 'name username avatar');
};

module.exports = mongoose.model('Conversation', ConversationSchema);