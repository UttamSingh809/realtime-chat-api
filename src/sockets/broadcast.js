/**
 * Outbound broadcast helpers.
 *
 * All outbound emits go through here so we can:
 *   - Lazily fetch the io instance (avoiding circular deps)
 *   - Centralize event names
 *   - Instrument easily in the future
 */

'use strict';

const logger = require('../config/logger');
const { SOCKET_EVENTS } = require('../config/constants');

let ioRef = null;

function setIO(io) {
    ioRef = io;
}

function getIO() {
    return ioRef;
}

/**
 * Emit an event to all sockets belonging to specific users.
 * @param {string|string[]} userIds
 * @param {string} event
 * @param {any} payload
 */
function emitToUser(userIds, event, payload) {
    if (!ioRef) return;
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    for (const id of ids) {
        const str = String(id);
        ioRef.to(`user:${str}`).emit(event, payload);
    }
}

/**
 * Emit an event to all sockets in a conversation room.
 * @param {string} conversationId
 * @param {string} event
 * @param {any} payload
 * @param {string} [exceptUserId] — exclude this user's sockets
 */
function emitToConversation(conversationId, event, payload, exceptUserId = null) {
    if (!ioRef) return;
    let target = ioRef.to(`conversation:${conversationId}`);
    if (exceptUserId) {
        target = target.except(`user:${exceptUserId}`);
    }
    target.emit(event, payload);
}

/**
 * Emit to every connected socket (use sparingly).
 */
function emitToAll(event, payload) {
    if (!ioRef) return;
    ioRef.emit(event, payload);
}

// ---------------------------------------------------------------------------
// Typed helpers for common events
// ---------------------------------------------------------------------------

const broadcast = {
    setIO,
    getIO,

    userConnected: (userId, socketId) => {
        emitToUser(userId, 'connected', { userId, socketId });
    },

    userStatus: (userIds, { userId, status, lastSeen, statusMessage }) => {
        const logger = require('../config/logger');
        logger.debug(
            `[broadcast.userStatus] emitting to ${userIds.length} user(s) — user=${userId} status=${status}`
        );
        emitToUser(userIds, SOCKET_EVENTS.USER_STATUS_CHANGED || 'user:status', {
            userId: String(userId),
            status,
            lastSeen,
            statusMessage,
        });
    },

    onlineUsers: (userIds, onlineIds) => {
        emitToUser(userIds, SOCKET_EVENTS.ONLINE_USERS || 'online:users', {
            userIds: onlineIds,
        });
    },

    newMessage: ({ conversationId, participantIds, message, senderId }) => {
        const payload = { message, conversationId };
        emitToConversation(conversationId, 'message:new', payload);
        // Also push to user rooms so participants not currently in the room get it
        if (Array.isArray(participantIds)) {
            for (const uid of participantIds) {
                if (uid === senderId) continue;
                emitToUser(uid, 'message:new', payload);
            }
        }
    },

    messageEdited: ({ conversationId, message }) => {
        emitToConversation(conversationId, 'message:edited', { message });
    },

    messageDeleted: ({ conversationId, messageId, deletedForEveryone, actorId }) => {
        emitToConversation(conversationId, 'message:deleted', {
            conversationId,
            messageId,
            deletedForEveryone,
            actorId,
        });
    },

    messageReaction: ({ conversationId, messageId, userId, emoji, added }) => {
        emitToConversation(conversationId, 'message:reaction', {
            conversationId,
            messageId,
            userId,
            emoji,
            added,
        });
    },

    messageRead: ({ conversationId, userId, upToMessageId, readAt }) => {
        emitToConversation(conversationId, 'message:read', {
            conversationId,
            userId,
            upToMessageId,
            readAt,
        });
    },

    typingStart: ({ conversationId, userId }) => {
        emitToConversation(
            conversationId,
            'typing:start',
            { conversationId, userId },
            userId // exclude the typist
        );
    },

    typingStop: ({ conversationId, userId }) => {
        emitToConversation(
            conversationId,
            'typing:stop',
            { conversationId, userId },
            userId
        );
    },

    conversationNew: ({ participantIds, conversation }) => {
        emitToUser(participantIds, 'conversation:new', { conversation });
    },

    conversationUpdated: ({ participantIds, conversationId, changes }) => {
        emitToUser(participantIds, 'conversation:updated', { conversationId, changes });
    },

    notificationNew: ({ userId, notification }) => {
        emitToUser(userId, 'notification:new', { notification });
    },
};

module.exports = broadcast;