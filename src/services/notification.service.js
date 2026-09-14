/**
 * NotificationService — create, list, read, delete.
 *
 * Design notes:
 *   - Creation must NEVER break the calling operation.
 *     Callers should `.catch()` on the returned promise.
 *   - Deduplication: an unread notification of the same type+conversation
 *     within the last 60s is UPDATED rather than duplicated.
 *   - Preference checks use a single user fetch to avoid N queries.
 */

'use strict';

const mongoose = require('mongoose');
const { Notification, User, Conversation } = require('../models');
const {
    BadRequestError,
    NotFoundError,
    ForbiddenError,
} = require('../utils/exceptions');
const logger = require('../config/logger');
const { broadcast } = require('../sockets');
const { NOTIFICATION_TYPE, CONVERSATION_TYPE } = require('../config/constants');
const { refId } = require('../utils/helpers/message');

const DEDUP_WINDOW_MS = 60 * 1000; // 60 seconds

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidId(id) {
    return mongoose.Types.ObjectId.isValid(id);
}

function assertValidId(id, label = 'Notification') {
    if (!isValidId(id)) throw new BadRequestError(`Invalid ${label} ID`, 'INVALID_ID');
}

/**
 * Standard notification serializer.
 */
function serializeNotification(n) {
    if (!n) return null;
    return {
        id: n._id.toString(),
        type: n.type,
        category: n.category,
        title: n.title,
        body: n.body,
        data: n.data || {},
        isRead: !!n.isRead,
        readAt: n.readAt || null,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
    };
}

/**
 * Fetch recipients with their notification preferences in one query.
 * Returns only those who should receive the given category.
 */
async function fetchOptedInRecipients(userIds, category, prefKey) {
    if (userIds.length === 0) return [];
    const users = await User.find({ _id: { $in: userIds } })
        .select('settings.notifications')
        .lean();

    return users
        .filter((u) => {
            const prefs = u.settings?.notifications || {};
            // Explicit false only disables; undefined defaults to enabled
            return prefs[prefKey] !== false;
        })
        .map((u) => u._id);
}

/**
 * Deduplicate: if an unread notification of same type + conversation exists
 * within DEDUP_WINDOW_MS, return its id. Otherwise null.
 */
async function findDuplicate({ userId, type, conversationId }) {
    const since = new Date(Date.now() - DEDUP_WINDOW_MS);
    return Notification.findOne({
        userId,
        type,
        isRead: false,
        'data.conversationId': conversationId,
        createdAt: { $gte: since },
    });
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class NotificationService {
    // -----------------------------------------------------------------------
    // Direct create (for a single user)
    // -----------------------------------------------------------------------

    /**
     * Create (or dedupe-update) a single notification.
     * @returns {Promise<Document|null>}
     */
    static async create({ userId, type, title, body, data = {}, category = 'chat', skipDedup = false }) {
        if (!isValidId(userId)) throw new BadRequestError('Invalid userId', 'INVALID_ID');

        // Dedup only for message-type notifications with a conversationId
        if (!skipDedup && data.conversationId && (type === NOTIFICATION_TYPE.MESSAGE || type === NOTIFICATION_TYPE.MENTION)) {
            const dup = await findDuplicate({ userId, type, conversationId: data.conversationId });
            if (dup) {
                dup.title = title;
                dup.body = body;
                dup.data = { ...dup.data, ...data };
                dup.isRead = false;
                dup.readAt = null;
                await dup.save();
                return dup;
            }
        }

        const n = await Notification.create({
            userId,
            type,
            category,
            title,
            body,
            data,
        });
        // Real-time push
        broadcast.notificationNew({
            userId,
            notification: serializeNotification(n),
        });
        return n;
    }

    /**
     * Batch create for many users. Skips users whose preferences say no.
     * Uses insertMany for efficiency; caller must catch.
     */
    static async createMany(items, { category = 'chat', prefKey = 'messages' } = {}) {
        if (!Array.isArray(items) || items.length === 0) return [];

        const recipientIds = Array.from(
            new Set(items.map((i) => i.userId.toString()))
        ).map((id) => new mongoose.Types.ObjectId(id));

        const optedIn = await fetchOptedInRecipients(recipientIds, category, prefKey);
        const optedInSet = new Set(optedIn.map((id) => id.toString()));

        const toInsert = items
            .filter((i) => optedInSet.has(i.userId.toString()))
            .map((i) => ({
                userId: i.userId,
                type: i.type,
                category: i.category || category,
                title: i.title,
                body: i.body || '',
                data: i.data || {},
                isRead: false,
            }));

        if (toInsert.length === 0) return [];

        try {
            const docs = await Notification.insertMany(toInsert, { ordered: false });
            return docs;
        } catch (err) {
            // Partial write may have occurred; log and continue
            logger.error(`Notification insertMany failed: ${err.message}`);
            return [];
        }
    }

    // -----------------------------------------------------------------------
    // Event-specific builders (called by other services)
    // -----------------------------------------------------------------------

    /**
     * Fan out notifications for a new message.
     *
     * @param {Document} conversation
     * @param {Document} message
     * @param {string} senderName — used for title
     */
    static async notifyNewMessage(conversation, message, senderName) {
        // Skip if conversation is muted for everyone? Not our concern; per-participant.
        const senderId = refId(message.senderId).toString();
        const now = Date.now();

        // Compute recipients: active, not sender, not deleted, not muted
        const recipients = conversation.participants
            .filter((p) => {
                const pid = p.userId._id ? p.userId._id : p.userId;
                if (pid.toString() === senderId) return false;
                if (p.leftAt) return false;
                if (p.deleted) return false;
                if (p.muted) {
                    // Respect mutedUntil if set
                    if (!p.mutedUntil || new Date(p.mutedUntil).getTime() > now) return false;
                }
                return true;
            })
            .map((p) => (p.userId._id ? p.userId._id : p.userId));

        if (recipients.length === 0) return [];

        const isGroup = conversation.type === CONVERSATION_TYPE.GROUP;
        const groupName = conversation.group?.name || 'Group';
        const preview = (message.content || '').substring(0, 140) || '📎 Attachment';

        const items = recipients.map((userId) => {
            const isMentioned =
                message.mentions?.some((m) => m.toString() === userId.toString()) || false;

            return {
                userId,
                type: isMentioned ? NOTIFICATION_TYPE.MENTION : NOTIFICATION_TYPE.MESSAGE,
                category: 'chat',
                title: isMentioned
                    ? `${senderName} mentioned you in ${isGroup ? groupName : 'a chat'}`
                    : isGroup
                        ? `${senderName} in ${groupName}`
                        : `${senderName}`,
                body: preview,
                data: {
                    conversationId: conversation._id,
                    messageId: message._id,
                    senderId: refId(message.senderId),
                },
            };
        });

        return this.createMany(items, { category: 'chat', prefKey: 'messages' });
    }

    /**
     * Notify the original sender that someone reacted to their message.
     */
    static async notifyReaction(message, reactionUserId, reactionUserName, emoji) {
        const senderId = message.senderId._id
            ? message.senderId._id
            : message.senderId;

        // Don't notify self-reactions
        if (senderId.toString() === reactionUserId.toString()) return null;

        return this.create({
            userId: senderId,
            type: NOTIFICATION_TYPE.REACTION,
            category: 'social',
            title: `${reactionUserName} reacted ${emoji}`,
            body: (message.content || '').substring(0, 140) || '📎 Attachment',
            data: {
                conversationId: message.conversationId,
                messageId: message._id,
                senderId: reactionUserId,
                emoji,
            },
        });
    }

    /**
     * Notify a user about a system action (added to group, promoted, etc.)
     */
    static async notifySystem(userId, title, body, data = {}) {
        return this.create({
            userId,
            type: NOTIFICATION_TYPE.SYSTEM,
            category: 'system',
            title,
            body,
            data,
        });
    }

    // -----------------------------------------------------------------------
    // Read/list
    // -----------------------------------------------------------------------

    static async list(userId, { unreadOnly = false, category, limit = 20, before } = {}) {
        const l = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

        const filter = { userId };
        if (unreadOnly) filter.isRead = false;
        if (category) filter.category = category;
        if (before) {
            const d = new Date(before);
            if (!isNaN(d.getTime())) filter.createdAt = { $lt: d };
        }

        const items = await Notification.find(filter)
            .sort({ createdAt: -1 })
            .limit(l + 1); // fetch one extra to know if there's more

        const hasMore = items.length > l;
        const pageItems = hasMore ? items.slice(0, l) : items;
        const nextCursor = hasMore
            ? pageItems[pageItems.length - 1].createdAt.toISOString()
            : null;

        return {
            items: pageItems.map(serializeNotification),
            meta: { limit: l, hasMore, nextCursor },
        };
    }

    static async unreadCount(userId) {
        const count = await Notification.countDocuments({ userId, isRead: false });
        return { unreadCount: count };
    }

    static async markRead(userId, notificationId) {
        assertValidId(notificationId);
        const n = await Notification.findById(notificationId);
        if (!n) throw new NotFoundError('Notification not found', 'NOTIFICATION_NOT_FOUND');
        if (n.userId.toString() !== userId.toString()) {
            throw new ForbiddenError('Not your notification', 'NOT_OWNER');
        }
        if (!n.isRead) {
            n.isRead = true;
            n.readAt = new Date();
            await n.save();
        }
        return serializeNotification(n);
    }

    static async markAllRead(userId) {
        const result = await Notification.markAllRead(userId);
        return { modifiedCount: result.modifiedCount || 0 };
    }

    static async remove(userId, notificationId) {
        assertValidId(notificationId);
        const n = await Notification.findById(notificationId);
        if (!n) throw new NotFoundError('Notification not found', 'NOTIFICATION_NOT_FOUND');
        if (n.userId.toString() !== userId.toString()) {
            throw new ForbiddenError('Not your notification', 'NOT_OWNER');
        }
        await n.deleteOne();
        return { deleted: true };
    }

    static async clearAll(userId) {
        const result = await Notification.deleteMany({ userId });
        return { deletedCount: result.deletedCount || 0 };
    }
}

module.exports = { NotificationService, serializeNotification };