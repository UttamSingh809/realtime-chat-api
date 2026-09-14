/**
 * Integration tests for conversation endpoints.
 */

'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { Conversation } = require('../../src/models');

const API = '/api';

let counter = 0;
function uniq(p = 'c') {
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
    };
}

const authed = (req, token) => req.set('Authorization', `Bearer ${token}`);

describe('Conversation API', () => {
    // -----------------------------------------------------------------------
    // Create private
    // -----------------------------------------------------------------------
    describe('POST /api/conversations (private)', () => {
        it('creates a private conversation between two users', async () => {
            const a = await registerUser();
            const b = await registerUser();

            const res = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'private', recipientId: b.user.id });

            expect(res.status).toBe(201);
            expect(res.body.data.conversation.type).toBe('private');
            expect(res.body.data.conversation.participants).toHaveLength(2);
            expect(res.body.data.conversation.myFlags.unreadCount).toBe(0);
        });

        it('is idempotent — returns existing DM', async () => {
            const a = await registerUser();
            const b = await registerUser();

            const first = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'private', recipientId: b.user.id });
            const second = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'private', recipientId: b.user.id });

            expect(second.status).toBe(201);
            expect(second.body.data.conversation.id).toBe(first.body.data.conversation.id);
        });

        it('rejects self-conversation', async () => {
            const a = await registerUser();
            const res = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'private', recipientId: a.user.id });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('SELF_CONVERSATION');
        });

        it('rejects when either party has blocked the other', async () => {
            const a = await registerUser();
            const b = await registerUser();
            await authed(request(app).post(`${API}/users/${b.user.id}/block`), a.token);

            const res = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'private', recipientId: b.user.id });
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('USER_BLOCKED');
        });

        it('rejects nonexistent recipient', async () => {
            const a = await registerUser();
            const res = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'private', recipientId: '000000000000000000000000' });
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('RECIPIENT_NOT_FOUND');
        });
    });

    // -----------------------------------------------------------------------
    // Create group
    // -----------------------------------------------------------------------
    describe('POST /api/conversations (group)', () => {
        it('creates a group with creator as owner', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const c = await registerUser();

            const res = await authed(request(app).post(`${API}/conversations`), a.token).send({
                type: 'group',
                name: 'Team Chat',
                description: 'Project X',
                participants: [b.user.id, c.user.id],
            });

            expect(res.status).toBe(201);
            expect(res.body.data.conversation.type).toBe('group');
            expect(res.body.data.conversation.group.name).toBe('Team Chat');
            expect(res.body.data.conversation.participants).toHaveLength(3);

            const owner = res.body.data.conversation.participants.find(
                (p) => p.role === 'owner'
            );
            expect(owner.user.id).toBe(a.user.id);
        });

        it('rejects group without name', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const res = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'group', participants: [b.user.id] });
            expect(res.status).toBe(422);
        });

        it('rejects group with nonexistent participant', async () => {
            const a = await registerUser();
            const res = await authed(request(app).post(`${API}/conversations`), a.token).send({
                type: 'group',
                name: 'X',
                participants: ['000000000000000000000000'],
            });
            expect(res.status).toBe(404);
        });

        it('deduplicates participants and drops self from the list', async () => {
            const a = await registerUser();
            const b = await registerUser();

            const res = await authed(request(app).post(`${API}/conversations`), a.token).send({
                type: 'group',
                name: 'Dedup Test',
                participants: [b.user.id, b.user.id, a.user.id],
            });

            expect(res.status).toBe(201);
            expect(res.body.data.conversation.participants).toHaveLength(2);
        });
    });

    // -----------------------------------------------------------------------
    // List / Get
    // -----------------------------------------------------------------------
    describe('GET /api/conversations', () => {
        it('lists conversations for the user', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const c = await registerUser();

            await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'private', recipientId: b.user.id });
            await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'group', name: 'G', participants: [c.user.id] });

            const res = await authed(request(app).get(`${API}/conversations`), a.token);
            expect(res.status).toBe(200);
            expect(res.body.data.items.length).toBe(2);
            expect(res.body.data.items[0].myFlags).toBeDefined();
        });

        it('does not include other users conversations', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const c = await registerUser();

            await authed(request(app).post(`${API}/conversations`), b.token)
                .send({ type: 'private', recipientId: c.user.id });

            const res = await authed(request(app).get(`${API}/conversations`), a.token);
            expect(res.status).toBe(200);
            expect(res.body.data.items.length).toBe(0);
        });

        it('filters by archived flag', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const c = await registerUser();

            const dm1 = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'private', recipientId: b.user.id });
            await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'private', recipientId: c.user.id });

            await authed(
                request(app).put(`${API}/conversations/${dm1.body.data.conversation.id}/archive`),
                a.token
            ).send({ archived: true });

            const active = await authed(request(app).get(`${API}/conversations`), a.token);
            const archived = await authed(
                request(app).get(`${API}/conversations?archived=true`),
                a.token
            );

            expect(active.body.data.items).toHaveLength(1);
            expect(archived.body.data.items).toHaveLength(1);
        });
    });

    describe('GET /api/conversations/:id', () => {
        it('returns a conversation for a participant', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const create = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'private', recipientId: b.user.id });
            const id = create.body.data.conversation.id;

            const res = await authed(request(app).get(`${API}/conversations/${id}`), a.token);
            expect(res.status).toBe(200);
            expect(res.body.data.conversation.id).toBe(id);
        });

        it('forbids non-participant', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const c = await registerUser();
            const create = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'private', recipientId: b.user.id });
            const id = create.body.data.conversation.id;

            const res = await authed(request(app).get(`${API}/conversations/${id}`), c.token);
            expect(res.status).toBe(403);
        });

        it('404s for invalid ObjectId', async () => {
            const a = await registerUser();
            const res = await authed(request(app).get(`${API}/conversations/not-an-id`), a.token);
            expect(res.status).toBe(400);
        });
    });

    // -----------------------------------------------------------------------
    // Update group
    // -----------------------------------------------------------------------
    describe('PUT /api/conversations/:id', () => {
        it('owner can update group info', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const create = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'group', name: 'Old Name', participants: [b.user.id] });
            const id = create.body.data.conversation.id;

            const res = await authed(request(app).put(`${API}/conversations/${id}`), a.token)
                .send({ name: 'New Name', description: 'Updated' });
            expect(res.status).toBe(200);
            expect(res.body.data.conversation.group.name).toBe('New Name');
            expect(res.body.data.conversation.group.description).toBe('Updated');
        });

        it('non-admin member cannot update group info', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const create = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'group', name: 'X', participants: [b.user.id] });
            const id = create.body.data.conversation.id;

            const res = await authed(request(app).put(`${API}/conversations/${id}`), b.token)
                .send({ name: 'Hacked' });
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('NOT_ADMIN');
        });

        it('rejects update on private conversation', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const create = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'private', recipientId: b.user.id });
            const id = create.body.data.conversation.id;

            const res = await authed(request(app).put(`${API}/conversations/${id}`), a.token)
                .send({ name: 'Nope' });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('NOT_A_GROUP');
        });
    });

    // -----------------------------------------------------------------------
    // Members
    // -----------------------------------------------------------------------
    describe('Members', () => {
        it('admin can add a member', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const c = await registerUser();
            const create = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'group', name: 'G', participants: [b.user.id] });
            const id = create.body.data.conversation.id;

            const res = await authed(request(app).post(`${API}/conversations/${id}/members`), a.token)
                .send({ userId: c.user.id });
            expect(res.status).toBe(200);
            expect(res.body.data.conversation.participants).toHaveLength(3);
        });

        it('cannot add the same user twice', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const create = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'group', name: 'G', participants: [b.user.id] });
            const id = create.body.data.conversation.id;

            const res = await authed(request(app).post(`${API}/conversations/${id}/members`), a.token)
                .send({ userId: b.user.id });
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('ALREADY_PARTICIPANT');
        });

        it('admin can remove a member', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const c = await registerUser();
            const create = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'group', name: 'G', participants: [b.user.id, c.user.id] });
            const id = create.body.data.conversation.id;

            const res = await authed(
                request(app).delete(`${API}/conversations/${id}/members/${b.user.id}`),
                a.token
            );
            expect(res.status).toBe(200);
            const remaining = res.body.data.conversation.participants.map((p) => p.user.id);
            expect(remaining).not.toContain(b.user.id);
        });

        it('cannot remove the owner', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const create = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'group', name: 'G', participants: [b.user.id] });
            const id = create.body.data.conversation.id;

            // Promote b to admin so they can attempt to remove a (owner)
            await authed(
                request(app).put(`${API}/conversations/${id}/members/${b.user.id}/role`),
                a.token
            ).send({ role: 'admin' });

            const res = await authed(
                request(app).delete(`${API}/conversations/${id}/members/${a.user.id}`),
                b.token
            );
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('CANNOT_REMOVE_OWNER');
        });

        it('owner can promote a member to admin', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const create = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'group', name: 'G', participants: [b.user.id] });
            const id = create.body.data.conversation.id;

            const res = await authed(
                request(app).put(`${API}/conversations/${id}/members/${b.user.id}/role`),
                a.token
            ).send({ role: 'admin' });
            expect(res.status).toBe(200);
            const promoted = res.body.data.conversation.participants.find(
                (p) => p.user.id === b.user.id
            );
            expect(promoted.role).toBe('admin');
        });
    });

    // -----------------------------------------------------------------------
    // Leave
    // -----------------------------------------------------------------------
    describe('DELETE /api/conversations/:id (leave)', () => {
        it('member can leave a group', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const create = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'group', name: 'G', participants: [b.user.id] });
            const id = create.body.data.conversation.id;

            const res = await authed(request(app).delete(`${API}/conversations/${id}`), b.token);
            expect(res.status).toBe(200);
            expect(res.body.data.left).toBe(true);

            // Get as b → 404 (deleted-for-me behaves as not found)
            const get = await authed(request(app).get(`${API}/conversations/${id}`), b.token);
            expect(get.status).toBe(404);
        });

        it('owner leaving transfers ownership to another member', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const create = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'group', name: 'G', participants: [b.user.id] });
            const id = create.body.data.conversation.id;

            await authed(request(app).delete(`${API}/conversations/${id}`), a.token);

            // b should now be owner
            const get = await authed(request(app).get(`${API}/conversations/${id}`), b.token);
            const owner = get.body.data.conversation.participants.find((p) => p.role === 'owner');
            expect(owner.user.id).toBe(b.user.id);
        });
    });

    // -----------------------------------------------------------------------
    // Per-user flags
    // -----------------------------------------------------------------------
    describe('Per-user flags', () => {
        it('pins a conversation for me only', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const create = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'private', recipientId: b.user.id });
            const id = create.body.data.conversation.id;

            await authed(request(app).put(`${API}/conversations/${id}/pin`), a.token)
                .send({ pinned: true });

            const aView = await authed(request(app).get(`${API}/conversations/${id}`), a.token);
            const bView = await authed(request(app).get(`${API}/conversations/${id}`), b.token);

            expect(aView.body.data.conversation.myFlags.pinned).toBe(true);
            expect(bView.body.data.conversation.myFlags.pinned).toBe(false);
        });

        it('mutes a conversation', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const create = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'private', recipientId: b.user.id });
            const id = create.body.data.conversation.id;

            const res = await authed(request(app).put(`${API}/conversations/${id}/mute`), a.token)
                .send({ muted: true, mutedUntil: new Date(Date.now() + 3600_000).toISOString() });
            expect(res.status).toBe(200);
            expect(res.body.data.conversation.myFlags.muted).toBe(true);
            expect(res.body.data.conversation.myFlags.mutedUntil).toBeDefined();
        });

        it('archives a conversation', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const create = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'private', recipientId: b.user.id });
            const id = create.body.data.conversation.id;

            const res = await authed(request(app).put(`${API}/conversations/${id}/archive`), a.token)
                .send({ archived: true });
            expect(res.status).toBe(200);
            expect(res.body.data.conversation.myFlags.archived).toBe(true);
        });

        it('marks a conversation as read', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const create = await authed(request(app).post(`${API}/conversations`), a.token)
                .send({ type: 'private', recipientId: b.user.id });
            const id = create.body.data.conversation.id;

            // Manually set unread count for testing
            await Conversation.updateOne(
                { _id: id, 'participants.userId': a.user.id },
                { $set: { 'participants.$.unreadCount': 5 } }
            );

            const res = await authed(request(app).post(`${API}/conversations/${id}/read`), a.token)
                .send({});
            expect(res.status).toBe(200);
            expect(res.body.data.unreadCount).toBe(0);
        });
    });
});