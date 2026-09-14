/**
 * Authentication & authorization middleware.
 *
 * `requireAuth` — verifies Bearer access token, loads user, attaches req.user.
 * `requireRole('admin')` — role check (must be chained after requireAuth).
 * `optionalAuth` — attaches req.user if a valid token is present, else no-op.
 */

'use strict';

const { verifyAccessToken } = require('../utils/helpers/jwt');
const { UnauthorizedError, ForbiddenError } = require('../utils/exceptions');
const { User } = require('../models');

/**
 * Extract Bearer token from Authorization header or `accessToken` cookie.
 */
function extractToken(req) {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
        return header.slice(7).trim();
    }
    if (req.cookies && req.cookies.accessToken) {
        return req.cookies.accessToken;
    }
    return null;
}

/**
 * Core loader: verify JWT → load user → attach to req.
 */
async function loadUserFromToken(req, token, { required = true } = {}) {
    if (!token) {
        if (required) throw new UnauthorizedError('Authentication required', 'NO_TOKEN');
        return null;
    }

    const payload = verifyAccessToken(token);

    const user = await User.findById(payload.sub).select(
        '+isDeleted +deletedAt'
    );

    if (!user) throw new UnauthorizedError('User not found', 'USER_NOT_FOUND');
    if (user.isDeleted) throw new UnauthorizedError('Account has been deleted', 'ACCOUNT_DELETED');

    // Password changed after token was issued? → invalidate
    if (user.passwordChangedAfter(payload.iat)) {
        throw new UnauthorizedError('Token invalidated by password change', 'TOKEN_INVALIDATED');
    }

    return {
        id: user._id.toString(),
        role: user.role,
        status: user.status,
        iat: payload.iat,
    };
}

const requireAuth = async (req, res, next) => {
    try {
        const token = extractToken(req);
        const user = await loadUserFromToken(req, token, { required: true });
        req.user = user;
        next();
    } catch (err) {
        next(err);
    }
};

const optionalAuth = async (req, res, next) => {
    try {
        const token = extractToken(req);
        if (!token) return next();
        const user = await loadUserFromToken(req, token, { required: false });
        if (user) req.user = user;
        next();
    } catch {
        // Invalid token on an optional route → just skip auth
        next();
    }
};

/**
 * Role checker. Must be used after requireAuth.
 * @param {...string} roles
 */
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) return next(new UnauthorizedError('Authentication required'));
        if (!roles.includes(req.user.role)) {
            return next(new ForbiddenError('Insufficient permissions', 'ROLE_FORBIDDEN'));
        }
        next();
    };
}

module.exports = { requireAuth, optionalAuth, requireRole };