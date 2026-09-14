/**
 * Integration tests for message endpoints.
 */

'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { Message, Conversation } = require('../../src/models');

const API = '/api';

let counter = 0;
function uniq(p = 'm') {
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
    return { user: res.body.data.user, token: res.body.data.accessToken };
}

const authed = (req, token) => req.set('Authorization', `Bearer ${token}`);

async function createDM(a, b) {
    const res = await authed(request(app).post(`${API}/conversations`), a.token)
        .send({ type: 'private', recipientId: b.user.id });
    return res.body.data.conversation.id;
}

async function createGroup(owner, members, name = 'Group') {
    const res = await authed(request(app).post(`${API}/conversations`), owner.token)
        .send({ type: 'group', name, participants: members.map((m) => m.user.id) });
    return res.body.data.conversation.id;
}

describe('Message API', () => {
    // ---------------------------------------------------------------------
    // POST /messages
    // ---------------------------------------------------------------------
    describe('POST /api/messages', () => {
        it('sends a text message', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            const res = await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'Hello there' });

            expect(res.status).toBe(201);
            expect(res.body.data.message.content).toBe('Hello there');
            expect(res.body.data.message.type).toBe('text');
            expect(res.body.data.message.sender.id).toBe(a.user.id);
        });

        it('rejects empty message (no content, no attachments)', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            const res = await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId });
            expect(res.status).toBe(422);
        });

        it('rejects non-participant sender', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const c = await registerUser();
            const convId = await createDM(a, b);

            const res = await authed(request(app).post(`${API}/messages`), c.token)
                .send({ conversationId: convId, content: 'Intruder' });
            expect(res.status).toBe(403);
        });

        it('rejects send when either party has blocked the other', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            await authed(request(app).post(`${API}/users/${b.user.id}/block`), a.token);

            const res = await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'Blocked' });
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('USER_BLOCKED');
        });

        it('updates the conversation lastMessage', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'Latest' });

            const conv = await Conversation.findById(convId);
            expect(conv.lastMessage.content).toBe('Latest');
            expect(conv.lastMessage.senderId.toString()).toBe(a.user.id);
        });

        it('increments unread for other participants only', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'Ping' });

            const conv = await Conversation.findById(convId);
            const aEntry = conv.getParticipant(a.user.id);
            const bEntry = conv.getParticipant(b.user.id);
            expect(aEntry.unreadCount).toBe(0);
            expect(bEntry.unreadCount).toBe(1);
        });

        it('supports reply-to', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            const first = await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'Original' });
            const parentId = first.body.data.message.id;

            const reply = await authed(request(app).post(`${API}/messages`), b.token)
                .send({ conversationId: convId, content: 'Reply', replyTo: parentId });

            expect(reply.status).toBe(201);
            expect(reply.body.data.message.replyTo.id).toBe(parentId);
            expect(reply.body.data.message.replyTo.content).toBe('Original');
        });

        it('rejects reply to a message in another conversation', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const c = await registerUser();

            const conv1 = await createDM(a, b);
            const conv2 = await createDM(a, c);

            const first = await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: conv1, content: 'Here' });

            const res = await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: conv2, content: 'Wrong', replyTo: first.body.data.message.id });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVALID_REPLY');
        });
    });

    // ---------------------------------------------------------------------
    // GET /messages/:conversationId
    // ---------------------------------------------------------------------
    describe('GET /api/messages/:conversationId', () => {
        it('returns history newest-first with cursor', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            for (let i = 0; i < 5; i++) {
                await authed(request(app).post(`${API}/messages`), a.token)
                    .send({ conversationId: convId, content: `Message ${i}` });
            }

            const res = await authed(
                request(app).get(`${API}/messages/${convId}?limit=3`),
                a.token
            );
            expect(res.status).toBe(200);
            expect(res.body.data.items).toHaveLength(3);
            expect(res.body.data.meta.hasMore).toBe(true);
            expect(res.body.data.meta.nextCursor).toBeDefined();

            // Fetch older with cursor
            const cursor = res.body.data.meta.nextCursor;
            const older = await authed(
                request(app).get(`${API}/messages/${convId}?limit=3&before=${encodeURIComponent(cursor)}`),
                a.token
            );
            expect(older.body.data.items).toHaveLength(2);
        });

        it('hides messages deleted for the viewer', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            const m1 = await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'One' });
            await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'Two' });

            await authed(
                request(app).delete(`${API}/messages/${m1.body.data.message.id}?for=me`),
                b.token
            );

            const res = await authed(request(app).get(`${API}/messages/${convId}`), b.token);
            const contents = res.body.data.items.map((m) => m.content);
            expect(contents).not.toContain('One');
            expect(contents).toContain('Two');
        });

        it('rejects non-participant', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const c = await registerUser();
            const convId = await createDM(a, b);

            const res = await authed(request(app).get(`${API}/messages/${convId}`), c.token);
            expect(res.status).toBe(403);
        });
    });

    // ---------------------------------------------------------------------
    // Edit
    // ---------------------------------------------------------------------
    describe('PUT /api/messages/:id', () => {
        it('sender can edit a text message', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            const m = await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'v1' });

            const res = await authed(
                request(app).put(`${API}/messages/${m.body.data.message.id}`),
                a.token
            ).send({ content: 'v2' });

            expect(res.status).toBe(200);
            expect(res.body.data.message.content).toBe('v2');
            expect(res.body.data.message.isEdited).toBe(true);
        });

        it('non-sender cannot edit', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            const m = await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'v1' });

            const res = await authed(
                request(app).put(`${API}/messages/${m.body.data.message.id}`),
                b.token
            ).send({ content: 'hijack' });
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('NOT_SENDER');
        });
    });

    // ---------------------------------------------------------------------
    // Delete
    // ---------------------------------------------------------------------
    describe('DELETE /api/messages/:id', () => {
        it('delete-for-me hides from only that user', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            const m = await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'secret' });
            const id = m.body.data.message.id;

            await authed(request(app).delete(`${API}/messages/${id}?for=me`), b.token);

            const asB = await authed(request(app).get(`${API}/messages/message/${id}`), b.token);
            const asA = await authed(request(app).get(`${API}/messages/message/${id}`), a.token);
            expect(asB.status).toBe(404);
            expect(asA.status).toBe(200);
        });

        it('sender can delete-for-everyone (content blanked)', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            const m = await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'to delete' });
            const id = m.body.data.message.id;

            const res = await authed(
                request(app).delete(`${API}/messages/${id}?for=everyone`),
                a.token
            );
            expect(res.status).toBe(200);
            expect(res.body.data.deleted).toBe('everyone');

            const asB = await authed(request(app).get(`${API}/messages/${convId}`), b.token);
            const found = asB.body.data.items.find((x) => x.id === id);
            expect(found).toBeUndefined(); // filtered out
        });

        it('non-sender non-admin cannot delete-for-everyone', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            const m = await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'x' });

            const res = await authed(
                request(app).delete(`${API}/messages/${m.body.data.message.id}?for=everyone`),
                b.token
            );
            expect(res.status).toBe(403);
        });
    });

    // ---------------------------------------------------------------------
    // Reactions
    // ---------------------------------------------------------------------
    describe('Reactions', () => {
        it('adds and toggles a reaction (one per user)', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            const m = await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'react to me' });
            const id = m.body.data.message.id;

            let res = await authed(request(app).post(`${API}/messages/${id}/reaction`), b.token)
                .send({ emoji: '❤️' });
            expect(res.status).toBe(200);

            // Replace with a different emoji
            await authed(request(app).post(`${API}/messages/${id}/reaction`), b.token)
                .send({ emoji: '👍' });

            // Fetch and confirm single reaction, not two
            const got = await authed(request(app).get(`${API}/messages/message/${id}`), a.token);
            expect(Object.keys(got.body.data.message.reactions)).toHaveLength(1);
            expect(got.body.data.message.reactions['👍'].count).toBe(1);
        });

        it('rejects invalid emoji', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            const m = await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'x' });

            const res = await authed(
                request(app).post(`${API}/messages/${m.body.data.message.id}/reaction`),
                b.token
            ).send({ emoji: 'not an emoji' });
            expect(res.status).toBe(400);
        });

        it('removes my reaction', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            const m = await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'x' });
            const id = m.body.data.message.id;

            await authed(request(app).post(`${API}/messages/${id}/reaction`), b.token)
                .send({ emoji: '😀' });

            const res = await authed(
                request(app).delete(`${API}/messages/${id}/reaction`),
                b.token
            );
            expect(res.status).toBe(200);
            expect(res.body.data.removed).toBe(true);
        });
    });

    // ---------------------------------------------------------------------
    // Star
    // ---------------------------------------------------------------------
    describe('Star / Pin', () => {
        it('stars a message', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            const m = await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'star me' });
            const id = m.body.data.message.id;

            await authed(request(app).post(`${API}/messages/${id}/star`), b.token);
            const got = await authed(request(app).get(`${API}/messages/message/${id}`), b.token);
            expect(got.body.data.message.isStarred).toBe(true);
        });

        it('pins a message in group by owner', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createGroup(a, [b], 'Pin Test');

            const m = await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'pin me' });
            const id = m.body.data.message.id;

            const res = await authed(request(app).post(`${API}/messages/${id}/pin`), a.token);
            expect(res.status).toBe(200);
            expect(res.body.data.pinned).toBe(true);
        });
    });

    // ---------------------------------------------------------------------
    // Read receipt
    // ---------------------------------------------------------------------
    describe('POST /messages/:id/read', () => {
        it('marks a message as read by the recipient', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            const m = await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'read me' });
            const id = m.body.data.message.id;

            const res = await authed(request(app).post(`${API}/messages/${id}/read`), b.token);
            expect(res.status).toBe(200);
            expect(res.body.data.read).toBe(true);
        });
    });

    // ---------------------------------------------------------------------
    // Forward
    // ---------------------------------------------------------------------
    describe('POST /messages/forward', () => {
        it('forwards a message to another conversation', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const c = await registerUser();
            const conv1 = await createDM(a, b);
            const conv2 = await createDM(a, c);

            const orig = await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: conv1, content: 'forward me' });
            const id = orig.body.data.message.id;

            const res = await authed(request(app).post(`${API}/messages/forward`), a.token)
                .send({ messageId: id, conversationId: conv2 });
            expect(res.status).toBe(201);
            expect(res.body.data.message.content).toBe('forward me');
            expect(res.body.data.message.forwardedFrom).toBe(id);
        });
    });

    // ---------------------------------------------------------------------
    // Search
    // ---------------------------------------------------------------------
    describe('GET /messages/search', () => {
        it('finds messages by content', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const convId = await createDM(a, b);

            const marker = uniq('needle');
            await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: `Hello ${marker}` });
            await authed(request(app).post(`${API}/messages`), a.token)
                .send({ conversationId: convId, content: 'Something else' });

            const res = await authed(
                request(app).get(`${API}/messages/search?q=${marker}`),
                a.token
            );
            expect(res.status).toBe(200);
            expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
            expect(res.body.data.items[0].content).toContain(marker);
        });

        it('only searches within my conversations', async () => {
            const a = await registerUser();
            const b = await registerUser();
            const c = await registerUser();
            const convOther = await createDM(b, c);

            const marker = uniq('privateword');
            await authed(request(app).post(`${API}/messages`), b.token)
                .send({ conversationId: convOther, content: `Hidden ${marker}` });

            const res = await authed(
                request(app).get(`${API}/messages/search?q=${marker}`),
                a.token
            );
            expect(res.body.data.items).toHaveLength(0);
        });
    });
});