/**
 * Integration tests for authentication endpoints.
 * Uses supertest against the Express app + in-memory Mongo.
 */

'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { User, RefreshToken } = require('../../src/models');

const API = '/api';

// Helper: create a user via API and return tokens
async function registerUser(overrides = {}) {
    const payload = {
        name: 'Test User',
        username: 'testuser',
        email: 'test@example.com',
        password: 'Password123!',
        ...overrides,
    };
    const res = await request(app).post(`${API}/auth/register`).send(payload);
    return { res, payload };
}

describe('Auth API', () => {
    // -------------------------------------------------------------------------
    // Registration
    // -------------------------------------------------------------------------
    describe('POST /api/auth/register', () => {
        it('creates a user and returns tokens', async () => {
            const { res, payload } = await registerUser();

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.user.email).toBe(payload.email);
            expect(res.body.data.user).not.toHaveProperty('password');
            expect(res.body.data.accessToken).toEqual(expect.any(String));
            expect(res.body.data.refreshToken).toEqual(expect.any(String));

            // Password must be hashed in DB
            const stored = await User.findOne({ email: payload.email }).select('+password');
            expect(stored.password).toBeDefined();
            expect(stored.password).not.toBe(payload.password);
        });

        it('rejects duplicate email', async () => {
            await registerUser({ username: 'user1', email: 'dup@example.com' });
            const { res } = await registerUser({ username: 'user2', email: 'dup@example.com' });

            expect(res.status).toBe(409);
            expect(res.body.code).toBe('EMAIL_TAKEN');
        });

        it('rejects duplicate username', async () => {
            await registerUser({ username: 'sameuser', email: 'a@example.com' });
            const { res } = await registerUser({ username: 'sameuser', email: 'b@example.com' });

            expect(res.status).toBe(409);
            expect(res.body.code).toBe('USERNAME_TAKEN');
        });

        it('rejects weak password', async () => {
            const { res } = await registerUser({ password: 'short' });

            expect(res.status).toBe(422);
            expect(res.body.code).toBe('VALIDATION_ERROR');
        });

        it('rejects invalid email', async () => {
            const { res } = await registerUser({ email: 'not-an-email' });

            expect(res.status).toBe(422);
        });

        it('ignores unknown fields (stripUnknown)', async () => {
            const { res } = await registerUser({ role: 'admin', isAdmin: true });

            expect(res.status).toBe(201);
            const user = await User.findOne({ email: res.body.data.user.email });
            expect(user.role).toBe('user'); // role injection blocked
        });
    });

    // -------------------------------------------------------------------------
    // Login
    // -------------------------------------------------------------------------
    describe('POST /api/auth/login', () => {
        beforeEach(async () => {
            await registerUser({ username: 'loginuser', email: 'login@example.com' });
        });

        it('logs in with email + password', async () => {
            const res = await request(app)
                .post(`${API}/auth/login`)
                .send({ email: 'login@example.com', password: 'Password123!' });

            expect(res.status).toBe(200);
            expect(res.body.data.accessToken).toEqual(expect.any(String));
        });

        it('logs in with username + password', async () => {
            const res = await request(app)
                .post(`${API}/auth/login`)
                .send({ username: 'loginuser', password: 'Password123!' });

            expect(res.status).toBe(200);
        });

        it('rejects wrong password', async () => {
            const res = await request(app)
                .post(`${API}/auth/login`)
                .send({ email: 'login@example.com', password: 'WrongPass123!' });

            expect(res.status).toBe(401);
            expect(res.body.code).toBe('INVALID_CREDENTIALS');
        });

        it('rejects unknown user with same generic error (no enumeration)', async () => {
            const res = await request(app)
                .post(`${API}/auth/login`)
                .send({ email: 'ghost@example.com', password: 'Password123!' });

            expect(res.status).toBe(401);
            expect(res.body.code).toBe('INVALID_CREDENTIALS');
        });

        it('locks account after 5 failed attempts', async () => {
            for (let i = 0; i < 5; i++) {
                await request(app)
                    .post(`${API}/auth/login`)
                    .send({ email: 'login@example.com', password: 'WrongPass123!' });
            }

            const res = await request(app)
                .post(`${API}/auth/login`)
                .send({ email: 'login@example.com', password: 'Password123!' });

            expect(res.status).toBe(401);
            expect(res.body.code).toBe('ACCOUNT_LOCKED');
        });
    });

    // -------------------------------------------------------------------------
    // Refresh + rotation
    // -------------------------------------------------------------------------
    describe('POST /api/auth/refresh', () => {
        let tokens;

        beforeEach(async () => {
            const { res } = await registerUser({ username: 'refreshuser', email: 'refresh@example.com' });
            tokens = res.body.data;
        });

        it('returns new access token for valid refresh token', async () => {
            const res = await request(app)
                .post(`${API}/auth/refresh`)
                .send({ refreshToken: tokens.refreshToken });

            expect(res.status).toBe(200);
            expect(res.body.data.accessToken).toEqual(expect.any(String));
            expect(res.body.data.refreshToken).not.toBe(tokens.refreshToken); // rotated
        });

        it('detects reuse of revoked token and revokes all', async () => {
            // First refresh rotates the token
            await request(app)
                .post(`${API}/auth/refresh`)
                .send({ refreshToken: tokens.refreshToken });

            // Reuse the (now revoked) original token
            const res = await request(app)
                .post(`${API}/auth/refresh`)
                .send({ refreshToken: tokens.refreshToken });

            expect(res.status).toBe(401);
            expect(res.body.code).toBe('REFRESH_REUSE');

            // All tokens should be revoked
            const user = await User.findOne({ email: 'refresh@example.com' });
            const active = await RefreshToken.countDocuments({ userId: user._id, revoked: false });
            expect(active).toBe(0);
        });

        it('rejects malformed refresh token', async () => {
            const res = await request(app)
                .post(`${API}/auth/refresh`)
                .send({ refreshToken: 'not-a-real-token-but-long-enough-to-pass-validation' });

            expect(res.status).toBe(401);
        });
    });

    // -------------------------------------------------------------------------
    // GET /me
    // -------------------------------------------------------------------------
    describe('GET /api/auth/me', () => {
        let accessToken;

        beforeEach(async () => {
            const { res } = await registerUser({ username: 'meuser', email: 'me@example.com' });
            accessToken = res.body.data.accessToken;
        });

        it('returns current user with valid token', async () => {
            const res = await request(app)
                .get(`${API}/auth/me`)
                .set('Authorization', `Bearer ${accessToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.user.email).toBe('me@example.com');
        });

        it('rejects without token', async () => {
            const res = await request(app).get(`${API}/auth/me`);
            expect(res.status).toBe(401);
        });

        it('rejects invalid token', async () => {
            const res = await request(app)
                .get(`${API}/auth/me`)
                .set('Authorization', 'Bearer garbage');

            expect(res.status).toBe(401);
        });

        it('rejects token issued before password change', async () => {
            // JWT `iat` has 1-second granularity. Ensure the password change lands
            // in a strictly later second than the token issuance, otherwise the
            // comparison `passwordChangedAt > iat` correctly returns false.
            await new Promise((r) => setTimeout(r, 1100));

            await request(app)
                .put(`${API}/auth/change-password`)
                .set('Authorization', `Bearer ${accessToken}`)
                .send({ currentPassword: 'Password123!', newPassword: 'NewPassword456!' });

            const res = await request(app)
                .get(`${API}/auth/me`)
                .set('Authorization', `Bearer ${accessToken}`);

            expect(res.status).toBe(401);
            expect(res.body.code).toBe('TOKEN_INVALIDATED');
        });
    });

    // -------------------------------------------------------------------------
    // Password reset flow
    // -------------------------------------------------------------------------
    describe('Password reset flow', () => {
        const email = 'reset@example.com';
        let accessToken;

        beforeEach(async () => {
            const { res } = await registerUser({ username: 'resetuser', email });
            accessToken = res.body.data.accessToken;
        });

        it('forgot-password stores a hashed token (raw sent via email only)', async () => {
            const { sendPasswordResetEmail } = require('../../src/services/email.service');

            const res = await request(app)
                .post(`${API}/auth/forgot-password`)
                .send({ email });

            expect(res.status).toBe(200);
            expect(sendPasswordResetEmail).toHaveBeenCalled();

            const user = await User.findOne({ email }).select('+resetPasswordToken +resetPasswordExpires');
            expect(user.resetPasswordToken).toBeDefined();
            expect(user.resetPasswordToken).toHaveLength(64); // sha256 hex
            expect(user.resetPasswordExpires).toBeInstanceOf(Date);
        });

        it('reset-password rejects invalid token', async () => {
            const res = await request(app)
                .post(`${API}/auth/reset-password`)
                .send({ token: 'a'.repeat(64), password: 'NewPassword456!' });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('RESET_TOKEN_INVALID');
        });

        it('reset-password succeeds with a valid token', async () => {
            // Manually inject a known token to avoid parsing emails
            const { randomToken, sha256 } = require('../../src/utils/helpers/crypto');
            const raw = randomToken(32);
            await User.updateOne(
                { email },
                {
                    resetPasswordToken: sha256(raw),
                    resetPasswordExpires: new Date(Date.now() + 10 * 60 * 1000),
                }
            );

            const res = await request(app)
                .post(`${API}/auth/reset-password`)
                .send({ token: raw, password: 'NewPassword456!' });

            expect(res.status).toBe(200);

            // Old password no longer works
            const loginOld = await request(app)
                .post(`${API}/auth/login`)
                .send({ email, password: 'Password123!' });
            expect(loginOld.status).toBe(401);

            // New password works
            const loginNew = await request(app)
                .post(`${API}/auth/login`)
                .send({ email, password: 'NewPassword456!' });
            expect(loginNew.status).toBe(200);
        });
    });

    // -------------------------------------------------------------------------
    // Logout
    // -------------------------------------------------------------------------
    describe('POST /api/auth/logout', () => {
        let tokens;

        beforeEach(async () => {
            const { res } = await registerUser({ username: 'logoutuser', email: 'logout@example.com' });
            tokens = res.body.data;
        });

        it('revokes the refresh token', async () => {
            const res = await request(app)
                .post(`${API}/auth/logout`)
                .send({ refreshToken: tokens.refreshToken });

            expect(res.status).toBe(200);

            // Refresh should now fail
            const refresh = await request(app)
                .post(`${API}/auth/refresh`)
                .send({ refreshToken: tokens.refreshToken });

            // It might be REFRESH_REUSE (revoked token) or REFRESH_NOT_FOUND
            expect(refresh.status).toBe(401);
        });
    });
});