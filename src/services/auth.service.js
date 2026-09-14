/**
 * AuthService — all authentication business logic.
 *
 * Never touches req/res. Controllers translate HTTP ↔ service calls.
 * Throws typed errors (see utils/exceptions) which the global handler maps to HTTP.
 */

'use strict';

const crypto = require('crypto');
const { User, RefreshToken } = require('../models');
const {
    signAccessToken,
    signRefreshToken,
    verifyRefreshToken,
    refreshTokenExpiryDate,
} = require('../utils/helpers/jwt');
const { hashPassword, comparePassword } = require('../utils/helpers/password');
const { randomToken, sha256 } = require('../utils/helpers/crypto');
const {
    BadRequestError,
    UnauthorizedError,
    ConflictError,
    NotFoundError,
} = require('../utils/exceptions');
const { sendPasswordResetEmail } = require('./email.service');

// Constants for login lockout
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_TIME_MS = 15 * 60 * 1000; // 15 min

class AuthService {
    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Issue a fresh access + refresh token pair and persist the refresh token.
     */
    static async _issueTokens(user, meta = {}) {
        const accessToken = signAccessToken({ id: user._id, role: user.role });

        const jti = randomToken(16);
        const refreshToken = signRefreshToken({ id: user._id }, jti);

        await RefreshToken.create({
            token: jti, // store the JTI, not the full JWT — cheaper + safer
            userId: user._id,
            expiresAt: refreshTokenExpiryDate(),
            userAgent: meta.userAgent || null,
            ip: meta.ip || null,
            device: meta.device || null,
        });

        return { accessToken, refreshToken };
    }

    /**
     * Build a clean user object for API responses.
     */
    static _sanitizeUser(user) {
        return {
            id: user._id.toString(),
            name: user.name,
            username: user.username,
            email: user.email,
            avatar: user.avatar,
            bio: user.bio,
            role: user.role,
            status: user.status,
            isEmailVerified: user.isEmailVerified,
            createdAt: user.createdAt,
        };
    }

    // -------------------------------------------------------------------------
    // Register
    // -------------------------------------------------------------------------

    static async register({ name, username, email, password }, meta = {}) {
        // Pre-check duplicates for a friendly error (unique index is the final guard)
        const [existingEmail, existingUsername] = await Promise.all([
            User.findOne({ email: email.toLowerCase() }),
            User.findOne({ username: username.toLowerCase() }),
        ]);

        if (existingEmail) throw new ConflictError('Email is already registered', 'EMAIL_TAKEN');
        if (existingUsername) throw new ConflictError('Username is already taken', 'USERNAME_TAKEN');

        const user = await User.create({
            name,
            username: username.toLowerCase(),
            email: email.toLowerCase(),
            password, // hashed by pre-save hook
        });

        const tokens = await this._issueTokens(user, meta);

        return {
            user: this._sanitizeUser(user),
            ...tokens,
        };
    }

    // -------------------------------------------------------------------------
    // Login
    // -------------------------------------------------------------------------

    static async login({ email, username, password }, meta = {}) {
        // Load user WITH password (select:false)
        const query = email
            ? { email: email.toLowerCase() }
            : { username: username.toLowerCase() };

        const user = await User.findOne(query).select('+password +failedLoginAttempts +lockedUntil');

        // Generic message to avoid user enumeration
        if (!user) throw new UnauthorizedError('Invalid credentials', 'INVALID_CREDENTIALS');

        // Account locked?
        if (user.lockedUntil && user.lockedUntil > new Date()) {
            const secondsLeft = Math.ceil((user.lockedUntil - Date.now()) / 1000);
            throw new UnauthorizedError(
                `Account locked. Try again in ${secondsLeft}s`,
                'ACCOUNT_LOCKED'
            );
        }

        // Verify password
        const ok = await user.comparePassword(password);

        if (!ok) {
            user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
            if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
                user.lockedUntil = new Date(Date.now() + LOCK_TIME_MS);
                user.failedLoginAttempts = 0;
            }
            await user.save();
            throw new UnauthorizedError('Invalid credentials', 'INVALID_CREDENTIALS');
        }

        // Successful login → reset counters, set online
        user.failedLoginAttempts = 0;
        user.lockedUntil = null;
        user.status = 'online';
        user.lastSeen = new Date();
        await user.save();

        const tokens = await this._issueTokens(user, meta);

        return {
            user: this._sanitizeUser(user),
            ...tokens,
        };
    }

    // -------------------------------------------------------------------------
    // Refresh (rotation + reuse detection)
    // -------------------------------------------------------------------------

    static async refresh(refreshToken, meta = {}) {
        const payload = verifyRefreshToken(refreshToken); // throws UnauthorizedError
        const { sub: userId, jti } = payload;

        const stored = await RefreshToken.findOne({ token: jti, userId });

        // Case 1: JTI not found → the token was never issued or has been pruned.
        if (!stored) {
            throw new UnauthorizedError('Refresh token not recognized', 'REFRESH_NOT_FOUND');
        }

        // Case 2: already revoked → reuse attempt. Nuke all sessions for safety.
        if (stored.revoked) {
            await RefreshToken.revokeAllForUser(userId);
            throw new UnauthorizedError(
                'Refresh token reuse detected. All sessions have been revoked.',
                'REFRESH_REUSE'
            );
        }

        // Case 3: expired on DB side (JWT may still be valid if DB TTL lag)
        if (stored.expiresAt <= new Date()) {
            await stored.revoke();
            throw new UnauthorizedError('Refresh token expired', 'REFRESH_EXPIRED');
        }

        const user = await User.findById(userId);
        if (!user || user.isDeleted) {
            await stored.revoke();
            throw new UnauthorizedError('User not found', 'USER_NOT_FOUND');
        }

        // Rotate: revoke old, issue new
        const newJti = randomToken(16);
        const newRefreshToken = signRefreshToken({ id: user._id }, newJti);

        await RefreshToken.create({
            token: newJti,
            userId: user._id,
            expiresAt: refreshTokenExpiryDate(),
            userAgent: meta.userAgent || stored.userAgent,
            ip: meta.ip || stored.ip,
            device: meta.device || stored.device,
        });

        await stored.revoke(newRefreshToken);

        const accessToken = signAccessToken({ id: user._id, role: user.role });

        return {
            user: this._sanitizeUser(user),
            accessToken,
            refreshToken: newRefreshToken,
        };
    }

    // -------------------------------------------------------------------------
    // Logout
    // -------------------------------------------------------------------------

    static async logout(refreshToken) {
        // Best-effort: verify to extract jti, but don't reject on failure
        let jti;
        try {
            const payload = verifyRefreshToken(refreshToken);
            jti = payload.jti;
        } catch {
            return { revoked: false };
        }

        const stored = await RefreshToken.findOne({ token: jti });
        if (!stored || stored.revoked) return { revoked: false };

        await stored.revoke();
        return { revoked: true };
    }

    static async logoutAll(userId) {
        const result = await RefreshToken.revokeAllForUser(userId);
        return { revokedCount: result.modifiedCount || 0 };
    }

    // -------------------------------------------------------------------------
    // Password reset
    // -------------------------------------------------------------------------

    static async forgotPassword(email) {
        const user = await User.findOne({ email: email.toLowerCase() });

        // Always return success to avoid user enumeration.
        if (!user) return { sent: true };

        const rawToken = randomToken(32);
        const hashedToken = sha256(rawToken);

        user.resetPasswordToken = hashedToken;
        user.resetPasswordExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 min
        await user.save({ validateBeforeSave: false });

        const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
        const resetUrl = `${clientUrl}/reset-password?token=${rawToken}`;

        try {
            await sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl });
        } catch (err) {
            // If email fails, clear the token so the user can retry
            user.resetPasswordToken = undefined;
            user.resetPasswordExpires = undefined;
            await user.save({ validateBeforeSave: false });
            throw new BadRequestError('Failed to send reset email. Please try again.', 'EMAIL_FAILED');
        }

        return { sent: true };
    }

    static async resetPassword({ token, password }) {
        const hashedToken = sha256(token);

        const user = await User.findOne({
            resetPasswordToken: hashedToken,
            resetPasswordExpires: { $gt: new Date() },
        }).select('+resetPasswordToken +resetPasswordExpires');

        if (!user) {
            throw new BadRequestError('Invalid or expired reset token', 'RESET_TOKEN_INVALID');
        }

        user.password = password; // hashed by pre-save hook
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        // Security: invalidate all refresh tokens after password reset
        await RefreshToken.revokeAllForUser(user._id);

        return { success: true };
    }

    // -------------------------------------------------------------------------
    // Change password (authenticated)
    // -------------------------------------------------------------------------

    static async changePassword(userId, { currentPassword, newPassword }) {
        const user = await User.findById(userId).select('+password');
        if (!user) throw new NotFoundError('User not found', 'USER_NOT_FOUND');

        const ok = await user.comparePassword(currentPassword);
        if (!ok) throw new UnauthorizedError('Current password is incorrect', 'PASSWORD_MISMATCH');

        if (currentPassword === newPassword) {
            throw new BadRequestError('New password must be different', 'SAME_PASSWORD');
        }

        user.password = newPassword; // hashed by pre-save
        await user.save();

        // Invalidate existing refresh tokens (except we can't keep any without knowing jti)
        await RefreshToken.revokeAllForUser(userId);

        return { success: true };
    }

    // -------------------------------------------------------------------------
    // Current user
    // -------------------------------------------------------------------------

    static async me(userId) {
        const user = await User.findById(userId);
        if (!user) throw new NotFoundError('User not found', 'USER_NOT_FOUND');
        return this._sanitizeUser(user);
    }
}

module.exports = AuthService;