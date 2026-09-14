/**
 * Smoke tests — verify every config module exports the expected shape.
 *
 * These are FAST and should be the first line of defense against
 * "file got emptied" or "module silently exports {}" bugs.
 *
 * If any of these fail, assume the rest of the suite is unreliable.
 */

'use strict';

describe('Smoke: config modules export expected shapes', () => {
    test('logger exports info/warn/error/debug + stream', () => {
        const logger = require('../src/config/logger');
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.error).toBe('function');
        expect(typeof logger.debug).toBe('function');
        expect(logger.stream).toBeDefined();
        expect(typeof logger.stream.write).toBe('function');
    });

    test('constants exports required enums', () => {
        const c = require('../src/config/constants');
        expect(c.HTTP_STATUS).toBeDefined();
        expect(c.USER_STATUS.ONLINE).toBe('online');
        expect(c.CONVERSATION_TYPE.PRIVATE).toBe('private');
        expect(c.MESSAGE_TYPE.TEXT).toBe('text');
        expect(c.SOCKET_EVENTS).toBeDefined();
        expect(c.SOCKET_EVENTS.MESSAGE_SEND).toBeDefined();
    });

    test('database exports connectDatabase/disconnectDatabase/mongoose', () => {
        const db = require('../src/config/database');
        expect(typeof db.connectDatabase).toBe('function');
        expect(typeof db.disconnectDatabase).toBe('function');
        expect(db.mongoose).toBeDefined();
    });

    test('redis exports connect/disconnect/getters', () => {
        const r = require('../src/config/redis');
        expect(typeof r.connectRedis).toBe('function');
        expect(typeof r.disconnectRedis).toBe('function');
        expect(typeof r.getRedis).toBe('function');
        expect(typeof r.getSubscriber).toBe('function');
        expect(typeof r.getPublisher).toBe('function');
        expect(typeof r.isRedisReady).toBe('function');
    });

    test('jwt helpers export signing/verifying functions', () => {
        const j = require('../src/utils/helpers/jwt');
        expect(typeof j.signAccessToken).toBe('function');
        expect(typeof j.signRefreshToken).toBe('function');
        expect(typeof j.verifyAccessToken).toBe('function');
        expect(typeof j.verifyRefreshToken).toBe('function');
        expect(typeof j.refreshTokenExpiryDate).toBe('function');
    });

    test('password helpers export hash/compare/validate', () => {
        const p = require('../src/utils/helpers/password');
        expect(typeof p.hashPassword).toBe('function');
        expect(typeof p.comparePassword).toBe('function');
        expect(typeof p.validatePasswordStrength).toBe('function');
    });

    test('exceptions export all AppError subclasses', () => {
        const e = require('../src/utils/exceptions');
        expect(typeof e.AppError).toBe('function');
        expect(typeof e.BadRequestError).toBe('function');
        expect(typeof e.UnauthorizedError).toBe('function');
        expect(typeof e.ForbiddenError).toBe('function');
        expect(typeof e.NotFoundError).toBe('function');
        expect(typeof e.ConflictError).toBe('function');
        expect(typeof e.ValidationError).toBe('function');
        expect(typeof e.TooManyRequestsError).toBe('function');
    });

    test('app exports an express application', () => {
        const app = require('../src/app');
        expect(typeof app).toBe('function'); // Express app is a function
        expect(typeof app.use).toBe('function');
    });

    test('models barrel exports all models', () => {
        const m = require('../src/models');
        expect(m.User).toBeDefined();
        expect(m.Conversation).toBeDefined();
        expect(m.Message).toBeDefined();
        expect(m.Notification).toBeDefined();
        expect(m.RefreshToken).toBeDefined();
    });
});