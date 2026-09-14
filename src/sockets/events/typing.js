/**
 * Typing indicator handlers.
 *
 * Uses a per-socket timer to auto-stop after TYPING_TIMEOUT_MS.
 * Single-instance only — for multi-instance, use Redis keyspace notifications.
 */

'use strict';

const { SOCKET_EVENTS } = require('../../config/constants');
const { Conversation } = require('../../models');
const { participantId } = require('../../utils/helpers/conversation');
const broadcast = require('../broadcast');
const logger = require('../../config/logger');

const TYPING_TIMEOUT_MS = parseInt(process.env.TYPING_TIMEOUT_MS || '5000', 10);

// socket.id -> Map<conversationId, TimeoutHandle>
const typingTimers = new Map();

async function assertParticipant(conversationId, userId) {
    const conv = await Conversation.findById(conversationId).select('participants');
    if (!conv) return false;
    return conv.participants.some(
        (p) => participantId(p).toString() === userId && !p.leftAt
    );
}

function clearTimer(socketId, conversationId) {
    const socketTimers = typingTimers.get(socketId);
    if (!socketTimers) return;
    const handle = socketTimers.get(conversationId);
    if (handle) {
        clearTimeout(handle);
        socketTimers.delete(conversationId);
    }
    if (socketTimers.size === 0) typingTimers.delete(socketId);
}

function setTimer(socketId, conversationId, fn) {
    clearTimer(socketId, conversationId);
    let socketTimers = typingTimers.get(socketId);
    if (!socketTimers) {
        socketTimers = new Map();
        typingTimers.set(socketId, socketTimers);
    }
    const handle = setTimeout(fn, TYPING_TIMEOUT_MS);
    socketTimers.set(conversationId, handle);
}

function registerTypingHandlers(io, socket) {
    const me = socket.data.user;

    socket.on(
        SOCKET_EVENTS.TYPING_START || 'typing:start',
        async (payload = {}, ack) => {
            try {
                const { conversationId } = payload;
                if (!conversationId) return;

                if (!(await assertParticipant(conversationId, me.id))) {
                    return;
                }

                broadcast.typingStart({ conversationId, userId: me.id });

                // Auto-stop after timeout
                setTimer(socket.id, conversationId, () => {
                    broadcast.typingStop({ conversationId, userId: me.id });
                });

                if (typeof ack === 'function') ack({ data: { ok: true } });
            } catch (err) {
                logger.error(`typing:start failed: ${err.message}`);
            }
        }
    );

    socket.on(
        SOCKET_EVENTS.TYPING_STOP || 'typing:stop',
        async (payload = {}, ack) => {
            try {
                const { conversationId } = payload;
                if (!conversationId) return;

                clearTimer(socket.id, conversationId);
                broadcast.typingStop({ conversationId, userId: me.id });
                if (typeof ack === 'function') ack({ data: { ok: true } });
            } catch (err) {
                logger.error(`typing:stop failed: ${err.message}`);
            }
        }
    );

    socket.on('disconnect', () => {
        // Clean up any pending typing timers for this socket
        const socketTimers = typingTimers.get(socket.id);
        if (socketTimers) {
            for (const handle of socketTimers.values()) clearTimeout(handle);
            typingTimers.delete(socket.id);
        }
    });
}

module.exports = { registerTypingHandlers };