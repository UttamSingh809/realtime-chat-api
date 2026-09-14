/**
 * Integration tests for user endpoints.
 */

'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { User } = require('../../src/models');

const API = '/api';

let counter = 0;
function uniq(p = 'u') {
    counter += 1;
    return `${p}${Date.now().toString(36)}${counter}`;
}

async function registerUser(overrides = {}) {
    const username = overrides.username || uniq('user');
    const email = overrides.email || `${username}@example.com`;
    const res = await request(app).post(`${API}/auth/register`).send({
        name: 'Test User',
        username,
        email,
        password: 'Password123!',
        ...overrides,
    });
    return {
        user: res.body.data.user,
        token: res.body.data.accessToken,
        refreshToken: res.body.data.refreshToken,
        res,
    };
}

const authed = (req, token) => req.set('Authorization', `Bearer ${token}`);

describe('User API', () => {
    // ---------------------------------------------------------------------
    // GET /users/me
    // ---------------------------------------------------------------------
    describe('GET /api/users/me', () => {
        it('returns full self profile', async () => {
            const { token, user } = await registerUser();
            const res = await authed(request(app).get(`${API}/users/me`), token);
            expect(res.status).toBe(200);
            expect(res.body.data.user.id).toBe(user.id);
            expect(res.body.data.user.email).toBe(user.email);
            expect(res.body.data.user).not.toHaveProperty('password');
            expect(res.body.data.user.settings).toBeDefined();
        });

        it('rejects unauthenticated', async () => {
            const res = await request(app).get(`${API}/users/me`);
            expect(res.status).toBe(401);
        });
    });

    // ---------------------------------------------------------------------
    // PUT /users/me
    // ---------------------------------------------------------------------
    describe('PUT /api/users/me', () => {
        it('updates name / bio / statusMessage', async () => {
            const { token } = await registerUser();
            const res = await authed(request(app).put(`${API}/users/me`), token)
                .send({ name: 'New Name', bio: 'Hello there', statusMessage: 'Working' });

            expect(res.status).toBe(200);
            expect(res.body.data.user.name).toBe('New Name');
            expect(res.body.data.user.bio).toBe('Hello there');
            expect(res.body.data.user.statusMessage).toBe('Working');
        });

        it('rejects empty payload (min 1 field)', async () => {
            const { token } = await registerUser();
            const res = await authed(request(app).put(`${API}/users/me`), token).send({});
            expect(res.status).toBe(422);
        });

        it('rejects name below min length', async () => {
            const { token } = await registerUser();
            const res = await authed(request(app).put(`${API}/users/me`), token)
                .send({ name: 'X' });
            expect(res.status).toBe(422);
        });

        it('cannot escalate role via profile update (whitelist)', async () => {
            const { token, user } = await registerUser();
            await authed(request(app).put(`${API}/users/me`), token)
                .send({ name: 'Sneaky', role: 'admin' });

            const stored = await User.findById(user.id);
            expect(stored.role).toBe('user');
        });
    });

    // ---------------------------------------------------------------------
    // PUT /users/me/settings
    // ---------------------------------------------------------------------
    describe('PUT /api/users/me/settings', () => {
        it('merges notification prefs without clobbering others', async () => {
            const { token, user } = await registerUser();
            const res = await authed(request(app).put(`${API}/users/me/settings`), token)
                .send({ notifications: { sound: false } });

            expect(res.status).toBe(200);
            const stored = await User.findById(user.id);
            expect(stored.settings.notifications.sound).toBe(false);
            // Untouched defaults remain
            expect(stored.settings.notifications.messages).toBe(true);
        });

        it('updates privacy.allowMessagesFrom', async () => {
            const { token, user } = await registerUser();
            await authed(request(app).put(`${API}/users/me/settings`), token)
                .send({ privacy: { allowMessagesFrom: 'nobody' } });

            const stored = await User.findById(user.id);
            expect(stored.settings.privacy.allowMessagesFrom).toBe('nobody');
        });

        it('rejects invalid enum value', async () => {
            const { token } = await registerUser();
            const res = await authed(request(app).put(`${API}/users/me/settings`), token)
                .send({ theme: 'neon' });
            expect(res.status).toBe(422);
        });
    });

    // ---------------------------------------------------------------------
    // PUT /users/me/status
    // ---------------------------------------------------------------------
    describe('PUT /api/users/me/status', () => {
        it('sets status to away', async () => {
            const { token } = await registerUser();
            const res = await authed(request(app).put(`${API}/users/me/status`), token)
                .send({ status: 'away', statusMessage: 'brb' });
            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('away');
            expect(res.body.data.statusMessage).toBe('brb');
        });

        it('rejects invalid status', async () => {
            const { token } = await registerUser();
            const res = await authed(request(app).put(`${API}/users/me/status`), token)
                .send({ status: 'vibing' });
            expect(res.status).toBe(422);
        });
    });

    // ---------------------------------------------------------------------
    // GET /users  (search)
    // ---------------------------------------------------------------------
    describe('GET /api/users', () => {
        it('finds users by partial username', async () => {
            const suffix = uniq('search');
            await registerUser({ username: `alice_${suffix}`, name: 'Alice Smith' });
            await registerUser({ username: `bob_${suffix}`, name: 'Bob Jones' });
            const { token } = await registerUser({ username: `viewer_${suffix}` });

            const res = await authed(request(app).get(`${API}/users?q=alice`), token);
            expect(res.status).toBe(200);
            expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
            expect(res.body.data.items.some((u) => u.username.startsWith('alice_'))).toBe(true);
        });

        it('excludes self from results', async () => {
            const { token, user } = await registerUser({ username: uniq('self') });
            const res = await authed(request(app).get(`${API}/users?q=self`), token);
            const ids = res.body.data.items.map((u) => u.id);
            expect(ids).not.toContain(user.id);
        });

        it('excludes blocked users', async () => {
            const suffix = uniq('blk');
            const a = await registerUser({ username: `blocker_${suffix}` });
            const b = await registerUser({ username: `blocked_${suffix}` });

            await authed(request(app).post(`${API}/users/${b.user.id}/block`), a.token);

            const res = await authed(request(app).get(`${API}/users?q=blocked_`), a.token);
            const ids = res.body.data.items.map((u) => u.id);
            expect(ids).not.toContain(b.user.id);
        });

        it('paginates with limit/page', async () => {
            const suffix = uniq('page');
            for (let i = 0; i < 5; i++) {
                await registerUser({ username: `pg_${suffix}_${i}`, name: `Paged User ${i}` });
            }
            const { token } = await registerUser({ username: `pgviewer_${suffix}` });

            const page1 = await authed(request(app).get(`${API}/users?q=pg&limit=2&page=1`), token);
            const page2 = await authed(request(app).get(`${API}/users?q=pg&limit=2&page=2`), token);

            expect(page1.body.data.items.length).toBeLessThanOrEqual(2);
            expect(page2.body.data.meta.page).toBe(2);
        });
    });

    // ---------------------------------------------------------------------
    // GET /users/online
    // ---------------------------------------------------------------------
    describe('GET /api/users/online', () => {
        it('returns users with an online-ish status', async () => {
            const { token } = await registerUser();
            const res = await authed(request(app).get(`${API}/users/online`), token);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data.users)).toBe(true);
        });
    });

    // ---------------------------------------------------------------------
    // GET /users/:id
    // ---------------------------------------------------------------------
    describe('GET /api/users/:id', () => {
        it('returns public profile of another user', async () => {
            const a = await registerUser();
            const b = await registerUser();

            const res = await authed(request(app).get(`${API}/users/${b.user.id}`), a.token);
            expect(res.status).toBe(200);
            expect(res.body.data.user.username).toBe(b.user.username);
            // No sensitive fields leaked
            expect(res.body.data.user).not.toHaveProperty('email');
            expect(res.body.data.user).not.toHaveProperty('settings');
            expect(res.body.data.user).not.toHaveProperty('role');
        });

        it('404s for invalid ObjectId', async () => {
            const { token } = await registerUser();
            const res = await authed(request(app).get(`${API}/users/not-an-id`), token);
            expect(res.status).toBe(400);
        });

        it('404s for nonexistent user', async () => {
            const { token } = await registerUser();
            const fakeId = '000000000000000000000000';
            const res = await authed(request(app).get(`${API}/users/${fakeId}`), token);
            expect(res.status).toBe(404);
        });
    });

    // ---------------------------------------------------------------------
    // Block
    // ---------------------------------------------------------------------
    describe('Block endpoints', () => {
        it('blocks a user', async () => {
            const a = await registerUser();
            const b = await registerUser();

            const res = await authed(request(app).post(`${API}/users/${b.user.id}/block`), a.token);
            expect(res.status).toBe(200);
            expect(res.body.data.blocked).toBe(true);

            const stored = await User.findById(a.user.id);
            expect(stored.blockedUsers.map((id) => id.toString())).toContain(b.user.id);
        });

        it('cannot block self', async () => {
            const a = await registerUser();
            const res = await authed(request(app).post(`${API}/users/${a.user.id}/block`), a.token);
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('CANNOT_BLOCK_SELF');
        });

        it('block is idempotent', async () => {
            const a = await registerUser();
            const b = await registerUser();

            await authed(request(app).post(`${API}/users/${b.user.id}/block`), a.token);
            const second = await authed(request(app).post(`${API}/users/${b.user.id}/block`), a.token);
            expect(second.status).toBe(200);
            expect(second.body.data.alreadyBlocked).toBe(true);
        });

        it('lists blocked users', async () => {
            const a = await registerUser();
            const b = await registerUser();
            await authed(request(app).post(`${API}/users/${b.user.id}/block`), a.token);

            const res = await authed(request(app).get(`${API}/users/blocked`), a.token);
            expect(res.status).toBe(200);
            expect(res.body.data.users.map((u) => u.id)).toContain(b.user.id);
        });

        it('unblocks a user', async () => {
            const a = await registerUser();
            const b = await registerUser();
            await authed(request(app).post(`${API}/users/${b.user.id}/block`), a.token);
            const res = await authed(request(app).delete(`${API}/users/${b.user.id}/block`), a.token);
            expect(res.status).toBe(200);
            expect(res.body.data.unblocked).toBe(true);
        });

        it('blocked user cannot be fetched via GET /:id', async () => {
            const a = await registerUser();
            const b = await registerUser();
            await authed(request(app).post(`${API}/users/${b.user.id}/block`), a.token);

            const res = await authed(request(app).get(`${API}/users/${b.user.id}`), a.token);
            expect(res.status).toBe(404);
        });
    });

    // ---------------------------------------------------------------------
    // Mute
    // ---------------------------------------------------------------------
    describe('Mute endpoints', () => {
        it('mutes a user', async () => {
            const a = await registerUser();
            const b = await registerUser();

            const res = await authed(request(app).post(`${API}/users/${b.user.id}/mute`), a.token);
            expect(res.status).toBe(200);
            expect(res.body.data.muted).toBe(true);
        });

        it('unmutes a user', async () => {
            const a = await registerUser();
            const b = await registerUser();
            await authed(request(app).post(`${API}/users/${b.user.id}/mute`), a.token);

            const res = await authed(request(app).delete(`${API}/users/${b.user.id}/mute`), a.token);
            expect(res.status).toBe(200);
            expect(res.body.data.unmuted).toBe(true);
        });

        it('lists muted users', async () => {
            const a = await registerUser();
            const b = await registerUser();
            await authed(request(app).post(`${API}/users/${b.user.id}/mute`), a.token);

            const res = await authed(request(app).get(`${API}/users/muted`), a.token);
            expect(res.body.data.users.map((u) => u.id)).toContain(b.user.id);
        });
    });
});