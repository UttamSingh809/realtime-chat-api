/**
 * JWT utilities: sign / verify access & refresh tokens.
 *
 * Access token payload: { sub, role }
 * Refresh token payload: { sub, jti }
 *
 * Both are signed with HS256 (symmetric). Secrets must be 32+ chars.
 */

'use strict';

const jwt = require('jsonwebtoken');
const { UnauthorizedError } = require('../exceptions');
const { randomToken } = require('./crypto');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

/**
 * Sanity check: secrets must be present and long enough.
 * Called once at module load — fail fast.
 */
(function assertSecrets() {
    const minLen = 32;
    if (!ACCESS_SECRET || ACCESS_SECRET.length < minLen) {
        throw new Error(`JWT_ACCESS_SECRET must be at least ${minLen} characters`);
    }
    if (!REFRESH_SECRET || REFRESH_SECRET.length < minLen) {
        throw new Error(`JWT_REFRESH_SECRET must be at least ${minLen} characters`);
    }
    if (ACCESS_SECRET === REFRESH_SECRET) {
        throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
    }
})();

/**
 * Sign an access token.
 * @param {{ id: string, role: string }} user
 * @returns {string}
 */
function signAccessToken(user) {
    return jwt.sign(
        { sub: user.id.toString(), role: user.role || 'user' },
        ACCESS_SECRET,
        { expiresIn: ACCESS_EXPIRES_IN, issuer: 'realtime-chat-api' }
    );
}

/**
 * Sign a refresh token.
 * @param {{ id: string }} user
 * @param {string} jti - unique token identifier (stored in DB)
 * @returns {string}
 */
function signRefreshToken(user, jti) {
    return jwt.sign(
        { sub: user.id.toString(), jti },
        REFRESH_SECRET,
        { expiresIn: REFRESH_EXPIRES_IN, issuer: 'realtime-chat-api' }
    );
}

/**
 * Verify an access token.
 * @param {string} token
 * @returns {{ sub: string, role: string, iat: number, exp: number }}
 * @throws {UnauthorizedError}
 */
function verifyAccessToken(token) {
    try {
        return jwt.verify(token, ACCESS_SECRET, { issuer: 'realtime-chat-api' });
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            throw new UnauthorizedError('Access token expired', 'TOKEN_EXPIRED');
        }
        throw new UnauthorizedError('Invalid access token', 'TOKEN_INVALID');
    }
}

/**
 * Verify a refresh token.
 * @param {string} token
 * @returns {{ sub: string, jti: string, iat: number, exp: number }}
 * @throws {UnauthorizedError}
 */
function verifyRefreshToken(token) {
    try {
        return jwt.verify(token, REFRESH_SECRET, { issuer: 'realtime-chat-api' });
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            throw new UnauthorizedError('Refresh token expired', 'REFRESH_EXPIRED');
        }
        throw new UnauthorizedError('Invalid refresh token', 'REFRESH_INVALID');
    }
}

/**
 * Extract the expiry Date for a refresh token based on its lifetime.
 * Used to store `expiresAt` on the RefreshToken document.
 * @returns {Date}
 */
function refreshTokenExpiryDate() {
    // Parse strings like "7d", "24h", "30m", "3600s"
    const match = String(REFRESH_EXPIRES_IN).match(/^(\d+)([smhd])$/);
    if (!match) {
        // fallback: 7 days
        return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const ms = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
    return new Date(Date.now() + value * ms);
}

module.exports = {
    signAccessToken,
    signRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    refreshTokenExpiryDate,
    ACCESS_EXPIRES_IN,
    REFRESH_EXPIRES_IN,
    // exported for tests / refresh flow
    _internals: { randomToken },
};