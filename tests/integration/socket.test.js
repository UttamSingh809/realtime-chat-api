/**
 * Integration tests for Socket.io real-time layer.
 * Uses socket.io-client to connect and assert on events.
 */

'use strict';

const http = require('http');
const request = require('supertest');
const { io: ioClient } = require('socket.io-client');

const app = require('../../src/app');
const { initSocket, closeSocket } = require('../../src/sockets');

const API = '/api';

let httpServer;
let serverPort;

let counter = 0;
function uniq(p = 's') {
    counter += 1;
    return `${p}${Date.now().toString(36)}${counter}`;
}

async function registerUser() {
    const username = uniq('sk');
    const res = await request(app).post(`${API}/auth/register`).send({
        name: 'Socket User',
        username,
        email: `${username}@example.com`,
        password: 'Password123!',
    });
    return { user: res.body.data.user, token: res.body.data.accessToken };
}

function connectSocket(token, opts = {}) {
    const url = `http://localhost:${serverPort}`;
    const socket = ioClient(url, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
        ...opts,
    });
    return socket;
}

function waitFor(socket, event, timeout = 3000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Timeout waiting for "${event}"`)),
            timeout
        );
        socket.once(event, (payload) => {
            clearTimeout(timer);
            resolve(payload);
        });
    });
}

function waitForConnect(socket, timeout = 3000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('Timeout waiting for connect')),
            timeout
        );
        socket.once('connect', () => {
            clearTimeout(timer);
            resolve();
        });
        socket.once('connect_error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

describe('Socket.io', () => {
    beforeAll(async () => {
        httpServer = http.createServer(app);
        await initSocket(httpServer);
        await new Promise((resolve) => {
            httpServer.listen(0, () => {
                serverPort = httpServer.address().port;
                resolve();
            });
        });
    });

    afterAll(async () => {
        closeSocket();
        await new Promise((resolve) => httpServer.close(resolve));
    });

    // -------------------------------------------------------------------------
    describe('Authentication', () => {
        it('rejects connection without token', async () => {
            const socket = ioClient(`http://localhost:${serverPort}`, {
                transports: ['websocket'],
                reconnection: false,
            });
            await expect(waitForConnect(socket)).rejects.toBeTruthy();
            socket.close();
        });

        it('rejects connection with invalid token', async () => {
            const socket = connectSocket('not-a-real-token');
            await expect(waitForConnect(socket)).rejects.toBeTruthy();
            socket.close();
        });

        it('accepts connection with valid token', async () => {
            const { token } = await registerUser();
            const socket = connectSocket(token);
            await waitForConnect(socket);
            expect(socket.connected).toBe(true);
            socket.close();
        });
    });

    // -------------------------------------------------------------------------
    describe('Ping / pong', () => {
        it('responds to ping', async () => {
            const { token } = await registerUser();
            const socket = connectSocket(token);
            await waitForConnect(socket);

            const response = await new Promise((resolve) => {
                socket.emit('ping', (ack) => resolve(ack));
            });
            expect(response.pong).toBe(true);

            socket.close();
        });
    });

    // -------------------------------------------------------------------------
    describe('Presence', () => {
        it('sets user online on connect and offline on disconnect', async () => {
            const { user, token } = await registerUser();
            const socket = connectSocket(token);
            await waitForConnect(socket);

            // Verify DB status
            const { User } = require('../../src/models');
            const stored = await User.findById(user.id);
            expect(stored.status).toBe('online');

            socket.close();
            // Give the server a moment to process disconnect
            await new Promise((r) => setTimeout(r, 200));

            const stored2 = await User.findById(user.id);
            expect(stored2.status).toBe('offline');
        });
    });

    // -------------------------------------------------------------------------
    describe('Conversation rooms', () => {
        it('joins a conversation and receives message:new', async () => {
            const a = await registerUser();
            const b = await registerUser();

            const convRes = await request(app)
                .post(`${API}/conversations`)
                .set('Authorization', `Bearer ${a.token}`)
                .send({ type: 'private', recipientId: b.user.id });
            const convId = convRes.body.data.conversation.id;

            const sockB = connectSocket(b.token);
            await waitForConnect(sockB);

            // Join room
            await new Promise((resolve) =>
                sockB.emit('conversation:join', { conversationId: convId }, resolve)
            );

            // Listen for the new message
            const msgPromise = waitFor(sockB, 'message:new');

            // Send via REST (from user A)
            await request(app)
                .post(`${API}/messages`)
                .set('Authorization', `Bearer ${a.token}`)
                .send({ conversationId: convId, content: 'Hello via REST' });

            const payload = await msgPromise;
            expect(payload.conversationId).toBe(convId);
            expect(payload.message.content).toBe('Hello via REST');

            sockB.close();
        });
    });

    // -------------------------------------------------------------------------
    describe('Typing indicators', () => {
        it('broadcasts typing:start to other participants only', async () => {
            const a = await registerUser();
            const b = await registerUser();

            const convRes = await request(app)
                .post(`${API}/conversations`)
                .set('Authorization', `Bearer ${a.token}`)
                .send({ type: 'private', recipientId: b.user.id });
            const convId = convRes.body.data.conversation.id;

            const sockA = connectSocket(a.token);
            const sockB = connectSocket(b.token);
            await waitForConnect(sockA);
            await waitForConnect(sockB);

            await new Promise((r) =>
                sockA.emit('conversation:join', { conversationId: convId }, r)
            );
            await new Promise((r) =>
                sockB.emit('conversation:join', { conversationId: convId }, r)
            );

            const received = waitFor(sockB, 'typing:start');
            sockA.emit('typing:start', { conversationId: convId });

            const payload = await received;
            expect(payload.userId).toBe(a.user.id);
            expect(payload.conversationId).toBe(convId);

            sockA.close();
            sockB.close();
        });
    });

    // -------------------------------------------------------------------------
    describe('Read receipts', () => {
        it('broadcasts message:read', async () => {
            const a = await registerUser();
            const b = await registerUser();

            const convRes = await request(app)
                .post(`${API}/conversations`)
                .set('Authorization', `Bearer ${a.token}`)
                .send({ type: 'private', recipientId: b.user.id });
            const convId = convRes.body.data.conversation.id;

            const sockA = connectSocket(a.token);
            await waitForConnect(sockA);
            await new Promise((r) =>
                sockA.emit('conversation:join', { conversationId: convId }, r)
            );

            const received = waitFor(sockA, 'message:read');
            const sockB = connectSocket(b.token);
            await waitForConnect(sockB);
            sockB.emit('message:read', { conversationId: convId });

            const payload = await received;
            expect(payload.userId).toBe(b.user.id);

            sockA.close();
            sockB.close();
        });
    });
});