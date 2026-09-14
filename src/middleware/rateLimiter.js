/**
 * Rate limiting middleware.
 *
 * - `generalLimiter`  — applied to all /api routes
 * - `authLimiter`     — applied to auth-sensitive endpoints (login/register/reset)
 *
 * If Redis is available, uses `rate-limit-redis` for distributed counters;
 * otherwise falls back to in-memory (fine for single instance).
 */

'use strict';

const rateLimit = require('express-rate-limit');
const { getRedis } = require('../config/redis');
const logger = require('../config/logger');

/**
 * Optionally attach a Redis store to a limiter.
 * express-rate-limit v7 requires a store object with `increment`, etc.
 */
function buildStore(prefix) {
    const client = getRedis();
    if (!client) return undefined; // in-memory

    try {
        const RedisStore = require('rate-limit-redis');
        return new RedisStore({
            sendCommand: (...args) => client.call(...args),
            prefix: `rl:${prefix}:`,
        });
    } catch (err) {
        logger.warn(`Failed to attach Redis store to rate limiter: ${err.message}`);
        return undefined;
    }
}

const commonOptions = {
    standardHeaders: true,  // RateLimit-* headers
    legacyHeaders: false,   // disable X-RateLimit-*
    handler: (req, res) => {
        res.status(429).json({
            success: false,
            message: 'Too many requests, please try again later',
            code: 'TOO_MANY_REQUESTS',
        });
    },
};

const isDev = process.env.NODE_ENV === 'development';

const generalLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    max: isDev ? 10000 : parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    store: isDev ? undefined : buildStore('general'),
    skip: isDev ? () => false : undefined,
    ...commonOptions,
});

const authLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    max: isDev ? 1000 : parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10', 10),
    skipSuccessfulRequests: !isDev,
    store: isDev ? undefined : buildStore('auth'),
    ...commonOptions,
});

module.exports = { generalLimiter, authLimiter };