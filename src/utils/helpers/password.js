/**
 * Password helpers: strength validation + a wrapper around bcrypt for
 * use outside the User model (e.g., change-password flow).
 */

'use strict';

const bcrypt = require('bcryptjs');

const MIN_LENGTH = 8;
const MAX_LENGTH = 128; // avoid DoS on huge inputs

/**
 * Rule set for a "strong enough" password.
 * Uses a scoring approach: 4 categories (lower, upper, digit, symbol) + length.
 */
function validatePasswordStrength(password) {
    if (typeof password !== 'string') {
        return { ok: false, reason: 'Password must be a string' };
    }
    if (password.length < MIN_LENGTH) {
        return { ok: false, reason: `Password must be at least ${MIN_LENGTH} characters` };
    }
    if (password.length > MAX_LENGTH) {
        return { ok: false, reason: `Password cannot exceed ${MAX_LENGTH} characters` };
    }

    const hasLower = /[a-z]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasDigit = /\d/.test(password);
    const hasSymbol = /[^A-Za-z0-9]/.test(password);

    const categories = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
    if (categories < 3) {
        return {
            ok: false,
            reason: 'Password must contain at least 3 of: lowercase, uppercase, digit, symbol',
        };
    }

    return { ok: true };
}

/**
 * Hash a plaintext password with bcrypt.
 */
async function hashPassword(plain) {
    const rounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);
    const salt = await bcrypt.genSalt(rounds);
    return bcrypt.hash(plain, salt);
}

/**
 * Compare plaintext with a bcrypt hash.
 */
function comparePassword(plain, hash) {
    return bcrypt.compare(plain, hash);
}

module.exports = {
    validatePasswordStrength,
    hashPassword,
    comparePassword,
    MIN_LENGTH,
    MAX_LENGTH,
};