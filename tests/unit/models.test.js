/**
 * Unit tests for Mongoose models: validation, methods, statics, indexes.
 */

'use strict';

const {
    User,
    RefreshToken,
    Conversation,
    Message,
    Notification,
} = require('../../src/models');

// ---------------------------------------------------------------------------
// Fixture helpers (keeps usernames/emails unique across tests)
// ---------------------------------------------------------------------------

let userCounter = 0;
function uniqueSuffix() {
    userCounter += 1;
    return `${Date.now().toString(36)}${userCounter}`;
}

async function createUser(overrides = {}) {
    const suffix = uniqueSuffix();
    return User.create({
        name: overrides.name || 'Test User',
        username: overrides.username || `user_${suffix}`,
        email: overrides.email || `user_${suffix}@example.com`,
        password: overrides.password || 'Password123!',
        ...overrides,
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Models', () => {
    describe('User', () => {
        it('hashes password on save', async () => {
            const user = await createUser({
                name: 'Alice',
                username: 'alice',
                email: 'alice@example.com',
            });

            // Default query should not include password
            const found = await User.findById(user._id);
            expect(found.password).toBeUndefined();

            // Explicit select +password should include it
            const withPw = await User.findById(user._id).select('+password');
            expect(withPw.password).toBeDefined();
            expect(withPw.password).not.toBe('Password123!');

            // comparePassword should succeed
            const ok = await withPw.comparePassword('Password123!');
            expect(ok).toBe(true);

            const bad = await withPw.comparePassword('wrong');
            expect(bad).toBe(false);
        });

        it('rejects duplicate emails', async () => {
            await createUser({
                name: 'Dup A',
                username: 'dupa',
                email: 'dup@example.com',
            });

            await expect(
                createUser({
                    name: 'Dup B',
                    username: 'dupb',
                    email: 'dup@example.com', // same email
                })
            ).rejects.toThrow();
        });

        it('soft-deletes and anonymizes', async () => {
            const user = await createUser({
                name: 'Ghost',
                username: 'ghostuser',
                email: 'ghost@example.com',
            });

            await user.softDelete();

            // Fetch including deleted (pre-find hook hides them by default)
            const found = await User.findById(user._id)
                .select('+isDeleted +deletedAt')
                .setOptions({ includeDeleted: true });

            expect(found).toBeDefined();
            expect(found.isDeleted).toBe(true);
            expect(found.name).toBe('Deleted User');
            expect(found.email).toMatch(/^deleted_.+@deleted\.local$/);
            expect(found.username).toMatch(/^deleted_.+$/);
            expect(found.username.length).toBeLessThanOrEqual(30); // schema maxlength
        });

        it('adds and removes sockets, updates status', async () => {
            const user = await createUser({
                name: 'Socket User',
                username: 'sockuser',
                email: 'sock@example.com',
            });

            await user.addSocket('s1');
            await user.addSocket('s2');
            expect(user.status).toBe('online');
            expect(user.socketIds).toHaveLength(2);

            await user.removeSocket('s1');
            expect(user.status).toBe('online');
            await user.removeSocket('s2');
            expect(user.status).toBe('offline');
        });
    });

    describe('Conversation', () => {
        let userA, userB, userC;

        beforeEach(async () => {
            userA = await createUser({ name: 'Alice A', username: 'alicea', email: 'alicea@x.com' });
            userB = await createUser({ name: 'Bob B', username: 'bobb', email: 'bobb@x.com' });
            userC = await createUser({ name: 'Carol C', username: 'carolc', email: 'carolc@x.com' });
        });

        it('creates a private conversation with canonical privateKey', async () => {
            const conv = await Conversation.create({
                type: 'private',
                participants: [{ userId: userA._id }, { userId: userB._id }],
                createdBy: userA._id,
            });

            const [small, big] = [userA._id.toString(), userB._id.toString()].sort();
            expect(conv.privateKey).toBe(`${small}:${big}`);

            // Duplicate DM should fail (unique sparse index on privateKey)
            await expect(
                Conversation.create({
                    type: 'private',
                    participants: [{ userId: userB._id }, { userId: userA._id }],
                    createdBy: userB._id,
                })
            ).rejects.toThrow();
        });

        it('rejects group without name', async () => {
            await expect(
                Conversation.create({
                    type: 'group',
                    participants: [{ userId: userA._id }, { userId: userB._id }],
                    createdBy: userA._id,
                    // group.name missing
                })
            ).rejects.toThrow(/Group conversations require a name/);
        });

        it('rejects private with wrong participant count', async () => {
            await expect(
                Conversation.create({
                    type: 'private',
                    participants: [{ userId: userA._id }],
                    createdBy: userA._id,
                })
            ).rejects.toThrow(/exactly 2 participants/);
        });

        it('isParticipant works', async () => {
            const conv = await Conversation.create({
                type: 'private',
                participants: [{ userId: userA._id }, { userId: userB._id }],
                createdBy: userA._id,
            });

            expect(conv.isParticipant(userA._id)).toBe(true);
            expect(conv.isParticipant(userB._id)).toBe(true);
            expect(conv.isParticipant(userC._id)).toBe(false);
        });
    });

    describe('Message', () => {
        let conv, userA, userB;

        beforeEach(async () => {
            userA = await createUser({ name: 'Msg Alice', username: 'msgalice', email: 'msga@x.com' });
            userB = await createUser({ name: 'Msg Bob', username: 'msgbob', email: 'msgb@x.com' });

            conv = await Conversation.create({
                type: 'private',
                participants: [{ userId: userA._id }, { userId: userB._id }],
                createdBy: userA._id,
            });
        });

        it('creates a message and toggles reactions', async () => {
            const msg = await Message.create({
                conversationId: conv._id,
                senderId: userA._id,
                content: 'Hello',
                type: 'text',
            });

            let res = msg.toggleReaction(userB._id, '❤️');
            await msg.save();
            expect(res.added).toBe(true);
            expect(msg.reactions).toHaveLength(1);

            res = msg.toggleReaction(userB._id, '❤️');
            await msg.save();
            expect(res.added).toBe(false);
            expect(msg.reactions).toHaveLength(0);
        });

        it('marks as read idempotently', async () => {
            const msg = await Message.create({
                conversationId: conv._id,
                senderId: userA._id,
                content: 'Hi',
            });

            await msg.markAsRead(userB._id);
            await msg.markAsRead(userB._id);

            expect(msg.readBy).toHaveLength(1);
        });

        it('soft-deletes for everyone and hides from queries', async () => {
            const msg = await Message.create({
                conversationId: conv._id,
                senderId: userA._id,
                content: 'Secret',
            });

            await msg.softDeleteForEveryone();

            const found = await Message.findById(msg._id);
            expect(found).toBeNull(); // filtered by pre-find hook

            const includeDeleted = await Message.findById(msg._id).setOptions({ includeDeleted: true });
            expect(includeDeleted.deletedForEveryone).toBe(true);
        });

        it('edits content only by sender', async () => {
            const msg = await Message.create({
                conversationId: conv._id,
                senderId: userA._id,
                content: 'v1',
            });

            await msg.editContent('v2', userA._id);
            expect(msg.content).toBe('v2');
            expect(msg.isEdited).toBe(true);

            expect(() => msg.editContent('v3', userB._id)).toThrow(/sender/);        
        });
    });

    describe('RefreshToken', () => {
        it('revokes and reports active status', async () => {
            const user = await createUser({
                name: 'RT User',
                username: 'rtuser',
                email: 'rt@x.com',
            });

            const rt = await RefreshToken.create({
                token: 'tok-1',
                userId: user._id,
                expiresAt: new Date(Date.now() + 1000 * 60 * 60),
            });

            expect(rt.isActive()).toBe(true);

            await rt.revoke('tok-2');

            expect(rt.isActive()).toBe(false);
            expect(rt.replacedByToken).toBe('tok-2');
        });
    });

    describe('Notification', () => {
        it('marks as read and counts unread', async () => {
            const user = await createUser({
                name: 'Notif User',
                username: 'notifuser',
                email: 'nn@x.com',
            });

            await Notification.create({
                userId: user._id,
                type: 'message',
                title: 'Hi',
                body: 'x',
            });
            await Notification.create({
                userId: user._id,
                type: 'message',
                title: 'Hi2',
                body: 'y',
            });

            expect(await Notification.unreadCount(user._id)).toBe(2);
            await Notification.markAllRead(user._id);
            expect(await Notification.unreadCount(user._id)).toBe(0);
        });
    });
});