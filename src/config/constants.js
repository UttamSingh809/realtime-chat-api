/**
 * Application-wide constants.
 * Centralized to avoid magic strings/numbers across the codebase.
 */

'use strict';

module.exports = {
    // HTTP status codes
    HTTP_STATUS: {
        OK: 200,
        CREATED: 201,
        NO_CONTENT: 204,
        BAD_REQUEST: 400,
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        CONFLICT: 409,
        UNPROCESSABLE: 422,
        TOO_MANY_REQUESTS: 429,
        INTERNAL_ERROR: 500,
        SERVICE_UNAVAILABLE: 503,
    },

    // User roles
    USER_ROLES: {
        USER: 'user',
        ADMIN: 'admin',
    },

    // User presence status
    USER_STATUS: {
        ONLINE: 'online',
        OFFLINE: 'offline',
        AWAY: 'away',
        BUSY: 'busy',
    },

    // Conversation types
    CONVERSATION_TYPE: {
        PRIVATE: 'private',
        GROUP: 'group',
    },

    // Participant roles within a conversation
    PARTICIPANT_ROLE: {
        MEMBER: 'member',
        ADMIN: 'admin',
        OWNER: 'owner',
    },

    // Message types
    MESSAGE_TYPE: {
        TEXT: 'text',
        IMAGE: 'image',
        FILE: 'file',
        AUDIO: 'audio',
        VIDEO: 'video',
        SYSTEM: 'system',
    },

    // Message delivery states
    MESSAGE_STATUS: {
        SENT: 'sent',
        DELIVERED: 'delivered',
        READ: 'read',
    },

    // Notification types
    NOTIFICATION_TYPE: {
        MESSAGE: 'message',
        MENTION: 'mention',
        REACTION: 'reaction',
        SYSTEM: 'system',
        FRIEND_REQUEST: 'friend_request',
    },

    // Socket.io event names (Client -> Server)
    SOCKET_EVENTS: {
        // Client -> Server
        USER_CONNECT: 'user:connect',
        USER_DISCONNECT: 'user:disconnect',
        USER_STATUS: 'user:status',
        CONVERSATION_JOIN: 'conversation:join',
        CONVERSATION_LEAVE: 'conversation:leave',
        MESSAGE_SEND: 'message:send',
        MESSAGE_EDIT: 'message:edit',
        MESSAGE_DELETE: 'message:delete',
        MESSAGE_READ: 'message:read',
        MESSAGE_REACTION: 'message:reaction',
        TYPING_START: 'typing:start',
        TYPING_STOP: 'typing:stop',
        NOTIFICATION_READ: 'notification:read',

        // Server -> Client
        USER_CONNECTED: 'user:connected',
        USER_STATUS_CHANGED: 'user:status:changed',
        MESSAGE_NEW: 'message:new',
        MESSAGE_EDITED: 'message:edited',
        MESSAGE_DELETED: 'message:deleted',
        MESSAGE_READ_RECEIPT: 'message:read',
        MESSAGE_REACTION_UPDATED: 'message:reaction',
        TYPING_STARTED: 'typing:start',
        TYPING_STOPPED: 'typing:stop',
        CONVERSATION_NEW: 'conversation:new',
        CONVERSATION_UPDATED: 'conversation:updated',
        CONVERSATION_MEMBER_ADDED: 'conversation:member:added',
        CONVERSATION_MEMBER_REMOVED: 'conversation:member:removed',
        NOTIFICATION_NEW: 'notification:new',
        ONLINE_USERS: 'online:users',
        ERROR: 'error',
    },

    // File upload
    ALLOWED_EXTENSIONS: [
        // images
        '.jpg', '.jpeg', '.png', '.gif', '.webp',
        // docs
        '.pdf', '.doc', '.docx', '.txt',
        // audio
        '.mp3', '.wav', '.ogg',
        // video
        '.mp4', '.webm', '.mov',
    ],

    MIME_TO_ATTACHMENT_TYPE: {
        'image/jpeg': 'image',
        'image/png': 'image',
        'image/gif': 'image',
        'image/webp': 'image',
        'application/pdf': 'file',
        'application/msword': 'file',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'file',
        'text/plain': 'file',
        'audio/mpeg': 'audio',
        'audio/wav': 'audio',
        'audio/ogg': 'audio',
        'video/mp4': 'video',
        'video/webm': 'video',
        'video/quicktime': 'video',
    },

    ALLOWED_MIME_TYPES: [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
        'audio/mpeg',
        'audio/wav',
        'audio/ogg',
        'video/mp4',
        'video/webm',
        'video/quicktime',
    ],
    ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    ALLOWED_DOCUMENT_TYPES: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
    ],
    ALLOWED_AUDIO_TYPES: ['audio/mpeg', 'audio/wav', 'audio/ogg'],
    ALLOWED_VIDEO_TYPES: ['video/mp4', 'video/webm', 'video/quicktime'],

    // Pagination
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 20,
    MAX_LIMIT: 100,

    // Cache TTL (seconds)
    CACHE_TTL: {
        SHORT: 60,
        MEDIUM: 300,
        LONG: 3600,
    },
};