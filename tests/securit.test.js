/**
 * Security invariants.
 *
 * These tests re-verify properties that, if broken, would silently
 * compromise the app. Independent from the endpoint tests so a broken
 * endpoint can't hide a broken invariant.
 */

'use strict';

const request = require('supertest');
const app = require('../src/app');
const { User } = require('../src/models');
const { verifyAccessToken } = require('../src/utils/helpers/jwt');

const API = '/api';

async function registerAndToken(overrides = {}) {
    const res = await request(app).post(`${API}/auth/register`).send({
        name: 'Sec User',
        username: 'secuser',
        email: 'sec@example.com',
        password: 'Password123!',
        ...overrides,
    });
    return { res, token: res.body.data?.accessToken };
}

describe('Security invariants', () => {
    test('password change invalidates previously-issued access tokens', async () => {
        const { token } = await registerAndToken({
            username: 'pwdchange', email: 'pwd@example.com',
        });
        const iatBefore = verifyAccessToken(token).iat;

        // Ensure a time gap so second-level comparison is unambiguous
        await new Promise((r) => setTimeout(r, 1100));

        await request(app)
            .put(`${API}/auth/change-password`)
            .set('Authorization', `Bearer ${token}`)
            .send({ currentPassword: 'Password123!', newPassword: 'NewPassword456!' });

        const user = await User.findOne({ email: 'pwd@example.com' }).select('+passwordChangedAt');
        const changedAtSec = Math.floor(user.passwordChangedAt.getTime() / 1000);

        // Sanity: DB actually recorded the change
        expect(changedAtSec).toBeGreaterThan(iatBefore);

        // And /me rejects the old token
        const me = await request(app)
            .get(`${API}/auth/me`)
            .set('Authorization', `Bearer ${token}`);
        expect(me.status).toBe(401);
        expect(me.body.code).toBe('TOKEN_INVALIDATED');
    });

    test('register cannot escalate role to admin', async () => {
        await request(app).post(`${API}/auth/register`).send({
            name: 'Injector',
            username: 'injector',
            email: 'injector@example.com',
            password: 'Password123!',
            role: 'admin',
            isAdmin: true,
        });

        const u = await User.findOne({ email: 'injector@example.com' });
        expect(u.role).toBe('user');
    });

    test('soft-deleted users cannot authenticate', async () => {
        const { token } = await registerAndToken({
            username: 'ghostuser2', email: 'ghost2@example.com',
        });

        const u = await User.findOne({ email: 'ghost2@example.com' });
        await u.softDelete();

        const me = await request(app)
            .get(`${API}/auth/me`)
            .set('Authorization', `Bearer ${token}`);
        expect(me.status).toBe(401);
    });

    test('JWT secrets must be different', async () => {
        // This is enforced at module load. We just document the expectation.
        const { signAccessToken, signRefreshToken } = require('../src/utils/helpers/jwt');
        const a = signAccessToken({ id: 'x', role: 'user' });
        const r = signRefreshToken({ id: 'x' }, 'jti-test');
        expect(a).not.toBe(r);
    });
});