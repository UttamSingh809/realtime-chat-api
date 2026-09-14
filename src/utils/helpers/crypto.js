/**
 * Cryptographic helpers: secure random tokens, SHA-256 hashing.
 */

'use strict';

const crypto = require('crypto');

/**
 * Generate a URL-safe random token.
 * @param {number} bytes - entropy in bytes (default 32 = 256 bits)
 * @returns {string} hex string
 */
function randomToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Deterministic SHA-256 hash of a string.
 * Used to hash reset/verification tokens before storing in DB.
 * @param {string} value
 * @returns {string} hex hash
 */
function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Timing-safe comparison of two strings.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeCompare(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { randomToken, sha256, safeCompare };