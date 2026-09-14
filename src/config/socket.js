/**
 * Socket.io server configuration.
 * - JWT auth middleware placeholder (implemented in Step 9)
 * - Redis adapter for horizontal scaling
 * - CORS configuration
 */

'use strict';

const { Server } = require('socket.io');
const logger = require('./logger');
const { getSubscriber, getPublisher, isRedisReady } = require('./redis');

let io = null;

/**
 * Initialize Socket.io server.
 * @param {import('http').Server} httpServer
 * @returns {import('socket.io').Server}
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

    // Lazy-require the Redis adapter so a missing/broken adapter
    // doesn't crash the app.
    try {
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
        logger.error(`Failed to attach Socket.io Redis adapter: ${err.message}`);
    }

    logger.info('Socket.io server initialized');
    return io;
}

function getIO() {
    if (!io) throw new Error('Socket.io not initialized. Call initSocket() first.');
    return io;
}

module.exports = { initSocket, getIO };