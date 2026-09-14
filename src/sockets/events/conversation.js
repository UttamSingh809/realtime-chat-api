/**
 * Conversation room handlers: join / leave.
 */

'use strict';

const { SOCKET_EVENTS } = require('../../config/constants');
const { Conversation } = require('../../models');
const { participantId } = require('../../utils/helpers/conversation');
const logger = require('../../config/logger');

function registerConversationHandlers(io, socket) {
    const me = socket.data.user;

    // -------------------------------------------------------------------------
    // Join a conversation room
    // -------------------------------------------------------------------------
    socket.on(
        SOCKET_EVENTS.CONVERSATION_JOIN || 'conversation:join',
        async (payload = {}, ack) => {
            try {
                const { conversationId } = payload;
                if (!conversationId) {
                    const err = { code: 'MISSING_CONVERSATION_ID', message: 'conversationId required' };
                    if (typeof ack === 'function') ack({ error: err });
                    return;
                }

                const conv = await Conversation.findById(conversationId).select('participants');
                if (!conv) {
                    const err = { code: 'CONVERSATION_NOT_FOUND', message: 'Not found' };
                    if (typeof ack === 'function') ack({ error: err });
                    return;
                }

                const meP = conv.participants.find(
                    (p) => participantId(p).toString() === me.id && !p.leftAt
                );
                if (!meP) {
                    const err = { code: 'NOT_PARTICIPANT', message: 'You are not a participant' };
                    if (typeof ack === 'function') ack({ error: err });
                    return;
                }

                socket.join(`conversation:${conversationId}`);
                logger.debug(`Socket ${socket.id} joined conversation:${conversationId}`);

                if (typeof ack === 'function') {
                    ack({
                        data: {
                            conversationId,
                            lastReadAt: meP.lastReadAt,
                            lastReadMessageId: meP.lastReadMessageId || null,
                            unreadCount: meP.unreadCount || 0,
                        },
                    });
                }
            } catch (err) {
                logger.error(`conversation:join failed: ${err.message}`);
                const errPayload = { code: 'JOIN_FAILED', message: err.message };
                if (typeof ack === 'function') ack({ error: errPayload });
            }
        }
    );

    // -------------------------------------------------------------------------
    // Leave a conversation room
    // -------------------------------------------------------------------------
    socket.on(
        SOCKET_EVENTS.CONVERSATION_LEAVE || 'conversation:leave',
        (payload = {}, ack) => {
            const { conversationId } = payload;
            if (conversationId) {
                socket.leave(`conversation:${conversationId}`);
            }
            if (typeof ack === 'function') ack({ data: { left: true } });
        }
    );
}

module.exports = { registerConversationHandlers };