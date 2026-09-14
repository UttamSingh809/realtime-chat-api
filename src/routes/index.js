/**
 * Main router aggregator.
 */

'use strict';

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { getRedis, isRedisEnabled, isRedisReady } = require('../config/redis');

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Liveness / readiness probe
 *     description: Returns 200 when the API is up and critical dependencies are reachable, 503 otherwise.
 *     security: []
 *     responses:
 *       200:
 *         description: Healthy
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               status: ok
 *               uptime: 123.45
 *               version: 1.0.0
 *               dependencies:
 *                 mongo: { status: ok, latencyMs: 3 }
 *                 redis: { status: ok, latencyMs: 1 }
 *       503:
 *         description: Unhealthy
 */
router.get('/health', async (req, res) => {
    const checks = {
        mongo: { status: 'unknown' },
        redis: { status: 'disabled' },
    };

    // Mongo check
    try {
        const start = Date.now();
        const state = mongoose.connection.readyState;
        if (state === 1) {
            await mongoose.connection.db.admin().ping();
            checks.mongo = { status: 'ok', latencyMs: Date.now() - start };
        } else {
            checks.mongo = { status: 'down', state };
        }
    } catch (err) {
        checks.mongo = { status: 'down', error: err.message };
    }

    // Redis check (optional)
    if (isRedisEnabled()) {
        if (isRedisReady()) {
            try {
                const client = getRedis();
                const start = Date.now();
                await client.ping();
                checks.redis = { status: 'ok', latencyMs: Date.now() - start };
            } catch (err) {
                checks.redis = { status: 'down', error: err.message };
            }
        } else {
            checks.redis = { status: 'down' };
        }
    }

    const critical = ['mongo']; // redis is not critical for readiness here
    const healthy = critical.every((k) => checks[k].status === 'ok');

    res.status(healthy ? 200 : 503).json({
        success: healthy,
        status: healthy ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: require('../../package.json').version,
        environment: process.env.NODE_ENV || 'development',
        dependencies: checks,
    });
});

// Sub-routers
router.use('/auth', require('./auth.routes'));
router.use('/users', require('./user.routes'));
router.use('/conversations', require('./conversation.routes'));
router.use('/messages', require('./message.routes'));
router.use('/files', require('./file.routes'));
router.use('/notifications', require('./notification.routes'));

module.exports = router;