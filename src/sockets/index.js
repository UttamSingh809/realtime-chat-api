/**
 * Socket.io bootstrap.
 *
 * - Attaches auth middleware
 * - Registers event handlers
 * - Wires up presence lifecycle
 * - Exposes `broadcast` module for services to emit
 */

'use strict';

const { Server } = require('socket.io');
const logger = require('../config/logger');
const { socketAuth } = require('./auth');
const {
    addSocket,
    removeSocket,
    getContactIds,
    onlineUserIds,
} = require('./presence');
const broadcast = require('./broadcast');

const { registerUserHandlers } = require('./events/user');
const { registerConversationHandlers } = require('./events/conversation');
const { registerTypingHandlers } = require('./events/typing');
const { registerMessageHandlers } = require('./events/message');

let io = null;

/**
 * Initialize Socket.io on the given HTTP server.
 * @param {import('http').Server} httpServer
 * @returns {Promise<import('socket.io').Server>}
 */
async function initSocket(httpServer) {
    io = new Server(httpServer, {
        cors: {
            origin: (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim()),
            credentials: true,
            methods: ['GET', 'POST'],
        },
        pingTimeout: 60000,
        pingInterval: 25000,
        transports: ['websocket', 'polling'],
        maxHttpBufferSize: 1e6,
    });

    // Attach Redis adapter if Redis is available
    try {
        const { isRedisReady, getPublisher, getSubscriber } = require('../config/redis');
        if (isRedisReady()) {
            const { createAdapter } = require('@socket.io/redis-adapter');
            const pubClient = await getPublisher();
            const subClient = await getSubscriber();
            if (pubClient && subClient) {
                io.adapter(createAdapter(pubClient, subClient));
                logger.info('Socket.io Redis adapter attached');
            }
        } else {
            logger.warn('Socket.io running without Redis adapter (single instance only)');
        }
    } catch (err) {
        logger.warn(`Socket.io Redis adapter not attached: ${err.message}`);
    }

    // Auth middleware
    io.use(socketAuth);

    // Per-connection setup
    io.on('connection', async (socket) => {
        const me = socket.data.user;
        logger.info(`Socket connected: ${socket.id} user=${me.id}`);

        // Join personal room (multi-device)
        socket.join(`user:${me.id}`);
        socket.join('online');

        // Register event handlers
        registerUserHandlers(io, socket);
        registerConversationHandlers(io, socket);
        registerTypingHandlers(io, socket);
        registerMessageHandlers(io, socket);

        // Presence: mark online, broadcast if user just came online
        try {
            const justCameOnline = await addSocket(me.id, socket.id);
            broadcast.userConnected(me.id, socket.id);

            if (justCameOnline) {
                const contactIds = await getContactIds(me.id);
                broadcast.userStatus(contactIds, {
                    userId: me.id,
                    status: 'online',
                    lastSeen: new Date(),
                });
                broadcast.onlineUsers(contactIds, onlineUserIds());
            }
        } catch (err) {
            logger.error(`Presence on-connect error: ${err.message}`);
        }

        // Disconnect
        socket.on('disconnect', async (reason) => {
            logger.info(`Socket disconnected: ${socket.id} reason=${reason}`);
            try {
                const wentOffline = await removeSocket(me.id, socket.id);
                if (wentOffline) {
                    const contactIds = await getContactIds(me.id);
                    broadcast.userStatus(contactIds, {
                        userId: me.id,
                        status: 'offline',
                        lastSeen: new Date(),
                    });
                    broadcast.onlineUsers(contactIds, onlineUserIds());
                }
            } catch (err) {
                logger.error(`Presence on-disconnect error: ${err.message}`);
            }
        });
    });

    // Give the broadcast module a reference to io
    broadcast.setIO(io);

    logger.info('Socket.io server initialized');
    return io;
}

function getIO() {
    if (!io) throw new Error('Socket.io not initialized. Call initSocket() first.');
    return io;
}

function closeSocket() {
    if (io) {
        io.close();
        io = null;
        broadcast.setIO(null);
    }
}

module.exports = { initSocket, getIO, closeSocket, broadcast };