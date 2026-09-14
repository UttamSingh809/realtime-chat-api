/**
 * Redis client using ioredis.
 * Supports graceful degradation: if Redis is unavailable,
 * the app continues running without caching / pub-sub.
 */

'use strict';

const Redis = require('ioredis');
const logger = require('./logger');

let client = null;
let subscriber = null;
let publisher = null;
let isReady = false;

const redisEnabled = process.env.REDIS_ENABLED === 'true';

/**
 * Create a Redis client with retry strategy.
 */
function createClient(name) {
    const client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        lazyConnect: true,
        retryStrategy(times) {
            const delay = Math.min(times * 100, 3000);
            logger.warn(`Redis (${name}) retry attempt #${times} in ${delay}ms`);
            return delay;
        },
    });

    client.on('connect', () => logger.info(`Redis (${name}) connecting...`));
    client.on('ready', () => logger.info(`Redis (${name}) ready`));
    client.on('error', (err) => logger.error(`Redis (${name}) error: ${err.message}`));
    client.on('close', () => logger.warn(`Redis (${name}) connection closed`));

    return client;
}

/**
 * Initialize Redis connection(s).
 */
async function connectRedis() {
    if (!redisEnabled) {
        logger.warn('Redis is disabled (REDIS_ENABLED=false). Skipping connection.');
        return null;
    }

    try {
        client = createClient('main');
        await client.connect();
        isReady = true;
        logger.info('Redis main client connected');
        return client;
    } catch (err) {
        logger.error(`Redis connection failed: ${err.message}. Continuing without Redis.`);
        isReady = false;
        return null;
    }
}

/**
 * Get the main Redis client (or null if not connected).
 */
function getRedis() {
    return isReady ? client : null;
}

/**
 * Create a dedicated subscriber client (required for Pub/Sub).
 */
async function getSubscriber() {
    if (!redisEnabled) return null;
    if (subscriber) return subscriber;
    subscriber = createClient('subscriber');
    await subscriber.connect();
    return subscriber;
}

/**
 * Create a dedicated publisher client.
 */
async function getPublisher() {
    if (!redisEnabled) return null;
    if (publisher) return publisher;
    publisher = createClient('publisher');
    await publisher.connect();
    return publisher;
}

/**
 * Gracefully close all Redis connections.
 */
async function disconnectRedis() {
    const close = async (c, name) => {
        if (c) {
            try {
                await c.quit();
                logger.info(`Redis (${name}) disconnected`);
            } catch (err) {
                logger.error(`Error closing Redis (${name}): ${err.message}`);
            }
        }
    };
    await close(client, 'main');
    await close(subscriber, 'subscriber');
    await close(publisher, 'publisher');
    isReady = false;
}

module.exports = {
    connectRedis,
    disconnectRedis,
    getRedis,
    getSubscriber,
    getPublisher,
    isRedisReady: () => isReady,
    isRedisEnabled: () => redisEnabled,
};