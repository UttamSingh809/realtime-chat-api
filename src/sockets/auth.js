/**
 * Socket.io handshake auth middleware.
 * Verifies JWT from `socket.handshake.auth.token`.
 */

'use strict';

const { verifyAccessToken } = require('../utils/helpers/jwt');
const { User } = require('../models');
const logger = require('../config/logger');

/**
 * @param {import('socket.io').Socket} socket
 * @param {(err?: Error) => void} next
 */
async function socketAuth(socket, next) {
    try {
        const token =
            socket.handshake.auth?.token ||
            socket.handshake.headers?.authorization?.replace(/^Bearer\s+/, '');

        if (!token) {
            return next(new Error('NO_TOKEN'));
        }

        let payload;
        try {
            payload = verifyAccessToken(token);
        } catch (err) {
            return next(new Error(err.code || 'INVALID_TOKEN'));
        }

        const user = await User.findById(payload.sub).select(
            '+isDeleted +deletedAt name username role status'
        );
        if (!user) return next(new Error('USER_NOT_FOUND'));
        if (user.isDeleted) return next(new Error('ACCOUNT_DELETED'));
        if (user.passwordChangedAfter(payload.iat)) {
            return next(new Error('TOKEN_INVALIDATED'));
        }

        // Attach the authenticated principal
        socket.data.user = {
            id: user._id.toString(),
            name: user.name,
            username: user.username,
            role: user.role,
            status: user.status,
        };

        next();
    } catch (err) {
        logger.error(`Socket auth error: ${err.message}`);
        next(new Error('AUTH_FAILED'));
    }
}

module.exports = { socketAuth };