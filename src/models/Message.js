/**
 * Message model.
 *
 * Indexes:
 *   - conversationId + createdAt (history pagination)
 *   - senderId + createdAt (search by sender)
 *   - text index on content (search)
 *   - starredBy (starred messages view)
 */

'use strict';

const mongoose = require('mongoose');
const { baseSchemaOptions } = require('../utils/helpers/schemaHelpers');
const { MESSAGE_TYPE } = require('../config/constants');

const { Schema } = mongoose;

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const AttachmentSchema = new Schema(
    {
        url: { type: String, required: true },
        publicId: { type: String, default: null },
        type: {
            type: String,
            enum: ['image', 'file', 'audio', 'video'],
            required: true,
        },
        mimeType: { type: String, default: null },
        size: { type: Number, default: 0 },
        name: { type: String, default: null },
        thumbnail: { type: String, default: null },
        width: { type: Number, default: null },
        height: { type: Number, default: null },
        duration: { type: Number, default: null }, // seconds, for audio/video
    },
    { _id: false }
);

const ReactionSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        emoji: { type: String, required: true, maxlength: 16 },
        createdAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const ReadReceiptSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        readAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const DeliveredReceiptSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        deliveredAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

// ---------------------------------------------------------------------------
// Main schema
// ---------------------------------------------------------------------------

const MessageSchema = new Schema(
    {
        conversationId: {
            type: Schema.Types.ObjectId,
            ref: 'Conversation',
            required: true,
            index: true,
        },
        senderId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        content: {
            type: String,
            default: '',
            maxlength: [10000, 'Message content cannot exceed 10,000 characters'],
            trim: true,
        },
        type: {
            type: String,
            enum: Object.values(MESSAGE_TYPE),
            default: MESSAGE_TYPE.TEXT,
        },
        attachments: { type: [AttachmentSchema], default: [] },

        // Threading
        replyTo: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
        forwardedFrom: { type: Schema.Types.ObjectId, ref: 'Message', default: null },

        // Reactions
        reactions: { type: [ReactionSchema], default: [] },

        // Delivery/read tracking
        readBy: { type: [ReadReceiptSchema], default: [] },
        deliveredTo: { type: [DeliveredReceiptSchema], default: [] },

        // Edit tracking
        isEdited: { type: Boolean, default: false },
        editedAt: { type: Date, default: null },
        originalContent: { type: String, default: null, select: false },

        // Delete tracking
        isDeleted: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null },
        deletedForEveryone: { type: Boolean, default: false },
        deletedFor: [{ type: Schema.Types.ObjectId, ref: 'User' }],

        // Bookmark / pin
        starredBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
        isPinned: { type: Boolean, default: false },
        pinnedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        pinnedAt: { type: Date, default: null },

        // System messages (user joined/left, group renamed, etc.)
        isSystemMessage: { type: Boolean, default: false },
        systemMeta: { type: Schema.Types.Mixed, default: null },

        // Mentions (for notification fan-out)
        mentions: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    },
    baseSchemaOptions
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// Conversation history (main query)
MessageSchema.index(
    { conversationId: 1, createdAt: -1 },
    { name: 'msg_conv_created' }
);

// Search by sender within a conversation
MessageSchema.index(
    { conversationId: 1, senderId: 1, createdAt: -1 },
    { name: 'msg_conv_sender_created' }
);

// Full-text search
MessageSchema.index(
    { content: 'text' },
    { name: 'msg_content_text', weights: { content: 10 } }
);

// Starred messages
MessageSchema.index({ starredBy: 1, createdAt: -1 }, { name: 'msg_starred' });

// Pinned messages
MessageSchema.index(
    { conversationId: 1, isPinned: 1 },
    { name: 'msg_pinned', partialFilterExpression: { isPinned: true } }
);

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Exclude messages deleted-for-everyone and messages deleted for the requesting user.
// Callers can bypass via `.setOptions({ includeDeleted: true })`.
// NOTE: No global pre-find filter here. Deleted-for-everyone messages must
// be returned as tombstones so the UI can render "This message was deleted"
// persistently. Filtering is done explicitly in the service layer where
// needed (e.g., search).

// ---------------------------------------------------------------------------
// Virtuals
// ---------------------------------------------------------------------------

MessageSchema.virtual('reactionSummary').get(function () {
    const counts = {};
    for (const r of this.reactions) {
        counts[r.emoji] = (counts[r.emoji] || 0) + 1;
    }
    return counts;
});

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

MessageSchema.methods.isDeletedFor = function (userId) {
    if (this.deletedForEveryone) return true;
    const idStr = userId.toString();
    return this.deletedFor.some((id) => id.toString() === idStr);
};

MessageSchema.methods.markAsRead = function (userId) {
    const idStr = userId.toString();
    if (!this.readBy.some((r) => r.userId.toString() === idStr)) {
        this.readBy.push({ userId, readAt: new Date() });
    }
    return this.save();
};

MessageSchema.methods.markAsDelivered = function (userId) {
    const idStr = userId.toString();
    if (!this.deliveredTo.some((d) => d.userId.toString() === idStr)) {
        this.deliveredTo.push({ userId, deliveredAt: new Date() });
    }
    return this.save();
};

MessageSchema.methods.editContent = function (newContent, editorId) {
    if (this.senderId.toString() !== editorId.toString()) {
        throw new Error('Only the sender can edit this message');
    }
    if (this.isDeleted || this.deletedForEveryone) {
        throw new Error('Cannot edit a deleted message');
    }
    if (!this.originalContent) {
        this.originalContent = this.content;
    }
    this.content = newContent;
    this.isEdited = true;
    this.editedAt = new Date();
    return this.save();
};

MessageSchema.methods.softDeleteForEveryone = function () {
    this.isDeleted = true;
    this.deletedForEveryone = true;
    this.deletedAt = new Date();
    this.content = '';
    this.attachments = [];
    this.reactions = [];
    return this.save();
};

MessageSchema.methods.softDeleteForUser = function (userId) {
    const idStr = userId.toString();
    if (!this.deletedFor.some((id) => id.toString() === idStr)) {
        this.deletedFor.push(userId);
    }
    return this.save();
};

MessageSchema.methods.toggleReaction = function (userId, emoji) {
    const idStr = userId.toString();
    const existingIndex = this.reactions.findIndex(
        (r) => r.userId.toString() === idStr && r.emoji === emoji
    );
    if (existingIndex >= 0) {
        this.reactions.splice(existingIndex, 1);
        return { added: false, emoji };
    }
    this.reactions.push({ userId, emoji, createdAt: new Date() });
    return { added: true, emoji };
};

// ---------------------------------------------------------------------------
// Statics
// ---------------------------------------------------------------------------

/**
 * Paginated history with cursor-based pagination (createdAt desc).
 * @param {ObjectId} conversationId
 * @param {Object} opts { limit, before, after, userId }
 */
MessageSchema.statics.getHistory = function (conversationId, { limit = 30, before = null, after = null, userId = null } = {}) {
    const query = { conversationId };

    if (before) query.createdAt = { ...(query.createdAt || {}), $lt: before };
    if (after) query.createdAt = { ...(query.createdAt || {}), $gt: after };

    // Exclude messages deleted-for-this-user
    if (userId) {
        query.deletedFor = { $ne: userId };
    }

    return this.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('senderId', 'name username avatar')
        .populate({
            path: 'replyTo',
            select: 'content senderId type attachments',
            populate: { path: 'senderId', select: 'name username avatar' },
        })
        .lean();
};

/**
 * Bulk mark as read for a user.
 */
MessageSchema.statics.bulkMarkAsRead = function (conversationId, userId, upToMessageId = null) {
    const query = {
        conversationId,
        'readBy.userId': { $ne: userId },
        senderId: { $ne: userId },
    };
    if (upToMessageId) {
        query._id = { $lte: upToMessageId };
    }
    return this.updateMany(
        query,
        { $push: { readBy: { userId, readAt: new Date() } } }
    );
};

module.exports = mongoose.model('Message', MessageSchema);