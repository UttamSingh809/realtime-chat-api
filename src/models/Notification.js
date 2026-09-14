/**
 * Notification model.
 *
 * Indexes:
 *   - userId + isRead + createdAt (unread list, sorted)
 *   - userId + createdAt (full list)
 *   - TTL on createdAt for auto-cleanup (optional, keep 30 days)
 */

'use strict';

const mongoose = require('mongoose');
const { baseSchemaOptions } = require('../utils/helpers/schemaHelpers');
const { NOTIFICATION_TYPE } = require('../config/constants');

const { Schema } = mongoose;

const NotificationSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: Object.values(NOTIFICATION_TYPE),
            required: true,
        },
        title: { type: String, required: true, maxlength: 120 },
        body: { type: String, default: '', maxlength: 500 },
        data: {
            type: Schema.Types.Mixed,
            default: {},
            // shape examples:
            //   message: { conversationId, messageId, senderId, preview }
            //   mention: { conversationId, messageId, senderId }
            //   reaction: { conversationId, messageId, senderId, emoji }
            //   system:  { code, ... }
        },
        isRead: { type: Boolean, default: false },
        readAt: { type: Date, default: null },
        // Category to allow grouping/filtering on client
        category: {
            type: String,
            enum: ['chat', 'social', 'system', 'security'],
            default: 'chat',
        },
    },
    baseSchemaOptions
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// Unread + list
NotificationSchema.index(
    { userId: 1, isRead: 1, createdAt: -1 },
    { name: 'notif_user_read_created' }
);

// TTL: auto-delete notifications older than 30 days
NotificationSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: 60 * 60 * 24 * 30, name: 'notif_ttl' }
);

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

NotificationSchema.methods.markRead = function () {
    if (!this.isRead) {
        this.isRead = true;
        this.readAt = new Date();
    }
    return this.save();
};

// ---------------------------------------------------------------------------
// Statics
// ---------------------------------------------------------------------------

NotificationSchema.statics.markAllRead = function (userId) {
    return this.updateMany(
        { userId, isRead: false },
        { $set: { isRead: true, readAt: new Date() } }
    );
};

NotificationSchema.statics.unreadCount = function (userId) {
    return this.countDocuments({ userId, isRead: false });
};

module.exports = mongoose.model('Notification', NotificationSchema);