/**
 * Server entry point.
 * - Loads env vars
 * - Connects DB + Redis
 * - Starts HTTP server + Socket.io
 * - Handles graceful shutdown
 */

'use strict';

require('dotenv').config();

const http = require('http');
const app = require('./app');
const logger = require('./config/logger');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const { connectRedis, disconnectRedis } = require('./config/redis');
const { configureCloudinary } = require('./config/cloudinary');
const { initSocket, closeSocket } = require('./sockets');

const PORT = process.env.PORT || 5000;
let server;
let io;

/**
 * Bootstrap the application.
 */
async function bootstrap() {
    try {
        // Connect services
        await connectDatabase();
        await connectRedis();
        configureCloudinary();

        // Create HTTP server
        server = http.createServer(app);

        // Initialize Socket.io
        io = await initSocket(server);

        // Start listening
        server.listen(PORT, () => {
            logger.info(`🚀 Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
            logger.info(`📡 API: http://localhost:${PORT}${process.env.API_PREFIX || '/api'}`);
            logger.info(`❤️  Health: http://localhost:${PORT}${process.env.API_PREFIX || '/api'}/health`);
        });
    } catch (err) {
        logger.error(`Failed to bootstrap application: ${err.message}`, { stack: err.stack });
        process.exit(1);
    }
}

/**
 * Graceful shutdown.
 */
async function shutdown(signal) {
    logger.info(`${signal} received. Starting graceful shutdown...`);

    const timeout = setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
    }, 10000);

    try {
        try {
            closeSocket();
            logger.info('Socket.io closed');
        } catch (err) {
            logger.error(`Error closing Socket.io: ${err.message}`);
        }

        if (server) {
            await new Promise((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve()));
            });
            logger.info('HTTP server closed');
        }

        await disconnectDatabase();
        await disconnectRedis();

        clearTimeout(timeout);
        logger.info('Graceful shutdown complete');
        process.exit(0);
    } catch (err) {
        logger.error(`Error during shutdown: ${err.message}`);
        process.exit(1);
    }
}

// Signal handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Unhandled rejection / exception handlers
process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled Rejection: ${reason instanceof Error ? reason.message : reason}`);
    if (reason instanceof Error) logger.error(reason.stack);
});

process.on('uncaughtException', (err) => {
    logger.error(`Uncaught Exception: ${err.message}`, { stack: err.stack });
    shutdown('uncaughtException');
});

// Start
bootstrap();

module.exports = { server, io };