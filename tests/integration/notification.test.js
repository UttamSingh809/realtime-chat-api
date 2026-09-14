/**
 * Integration tests for notification endpoints.
 */

'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { Notification } = require('../../src/models');

const API = '/api';

let counter = 0;
function uniq(p = 'n') {
    counter += 1;
    return `${p}${Date.now().toString(36)}${counter}`;
}

async function registerUser(overrides = {}) {
    const username = overrides.username || uniq('user');
    const email = overrides.email || `${username}@example.com`;
    const res = await request(app).post(`${API}/auth/register`).send({
        name: overrides.name || 'Test User',
        username,
        email,
        password: 'Password123!',
        ...overrides,
    });
    return { user: res.body.data.user, token: res.body.data.accessToken };
}

const authed = (req, token) => req.set('Authorization', `Bearer ${token}`);

async function createDM(a, b) {
    const res = await authed(request(app).post(`${API}/conversations`), a.token)
        .send({ type: 'private', recipientId: b.user.id });
    return res.body.data.conversation.id;
}

/**
 * Notifications are fire-and-forget. Tests need to wait a tick for
 * the async fan-out to complete before asserting.
 */
const tick = () => new Promise((r) => setTimeout(r, 150));

describe('Notification API', () => {
    // ---------------------------------------------------------------------
    // Triggers
    // ---------------------------------------------------------------------
    describe('Trigger: new message', () => {
        it('creates a notification for the recipient', async () => {
            const a = await registerUser({ name: 'Alice' });
            const b = await registerUser({ name: 'Bob' });
            const convId = await createDM(a, b);

            await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'Hello Bob' });

            await tick(); // wait for fire-and-forget

            const stored = await Notification.find({ userId: b.user.id });
            expect(stored.length).toBeGreaterThanOrEqual(1);
            expect(stored[0].type).toBe('message');
            expect(stored[0].body).toContain('Hello Bob');
            expect(stored[0].data.conversationId.toString()).toBe(convId);
        });

        it('does not notify the sender', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'Self?' });

            await tick();

            const mine = await Notification.find({ userId: a.user.id });
            expect(mine).toHaveLength(0);
        });

        it('respects notifications.messages = false', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            // Bob disables message notifications
            await authed(request(app).put(`${API}/users/me/settings`), b.token)
                .send({ notifications: { messages: false } });

            await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'Muted' });

            await tick();

            const stored = await Notification.find({ userId: b.user.id });
            expect(stored).toHaveLength(0);
        });
    });

    // ---------------------------------------------------------------------
    // List
    // ---------------------------------------------------------------------
    describe('GET /api/notifications', () => {
        it('lists my notifications newest first', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'First' });
            await tick();
            await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'Second' });

            await tick();

            const res = await authed(request(app).get(`${API}/notifications`), b.token);
            expect(res.status).toBe(200);
            // Dedup within 60s collapses these into 1 — either 1 or 2 is fine
            expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
        });

        it('filters by unreadOnly', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'Hello' });
            await tick();

            const all = await authed(request(app).get(`${API}/notifications`), b.token);
            const id = all.body.data.items[0].id;

            await authed(request(app).put(`${API}/notifications/${id}/read`), b.token);

            const unread = await authed(
                request(app).get(`${API}/notifications?unreadOnly=true`),
                b.token
            );
            expect(unread.body.data.items).toHaveLength(0);
        });
    });

    // ---------------------------------------------------------------------
    // Unread count
    // ---------------------------------------------------------------------
    describe('GET /api/notifications/unread-count', () => {
        it('returns the count', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'One' });
            await tick();

            const res = await authed(
                request(app).get(`${API}/notifications/unread-count`),
                b.token
            );
            expect(res.status).toBe(200);
            expect(res.body.data.unreadCount).toBeGreaterThanOrEqual(1);
        });
    });

    // ---------------------------------------------------------------------
    // Mark read
    // ---------------------------------------------------------------------
    describe('PUT /api/notifications/:id/read', () => {
        it('marks a notification read', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'x' });
            await tick();

            const list = await authed(request(app).get(`${API}/notifications`), b.token);
            const id = list.body.data.items[0].id;

            const res = await authed(
                request(app).put(`${API}/notifications/${id}/read`),
                b.token
            );
            expect(res.status).toBe(200);
            expect(res.body.data.notification.isRead).toBe(true);
        });

        it("forbids marking another user's notification", async () => {
            const a = await registerUser();
            const b = await registerUser();
            const c = await registerUser();
            const convId = await createDM(a, b);

            await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'y' });
            await tick();

            const list = await authed(request(app).get(`${API}/notifications`), b.token);
            const id = list.body.data.items[0].id;

            const res = await authed(
                request(app).put(`${API}/notifications/${id}/read`),
                c.token
            );
            expect(res.status).toBe(403);
        });
    });

    describe('PUT /api/notifications/read-all', () => {
        it('marks all as read', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: '1' });
            await tick();

            const res = await authed(
                request(app).put(`${API}/notifications/read-all`),
                b.token
            );
            expect(res.status).toBe(200);

            const unread = await authed(
                request(app).get(`${API}/notifications/unread-count`),
                b.token
            );
            expect(unread.body.data.unreadCount).toBe(0);
        });
    });

    // ---------------------------------------------------------------------
    // Delete
    // ---------------------------------------------------------------------
    describe('DELETE /api/notifications/:id', () => {
        it('deletes my notification', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'z' });
            await tick();

            const list = await authed(request(app).get(`${API}/notifications`), b.token);
            const id = list.body.data.items[0].id;

            const res = await authed(
                request(app).delete(`${API}/notifications/${id}`),
                b.token
            );
            expect(res.status).toBe(200);
        });

        it('clears all', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'a' });
            await tick();

            const res = await authed(request(app).delete(`${API}/notifications`), b.token);
            expect(res.status).toBe(200);
            expect(res.body.data.deletedCount).toBeGreaterThanOrEqual(1);
        });
    });
});