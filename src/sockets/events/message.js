/**
 * Message-related socket event handlers.
 *   - mark read (single + bulk up to a message)
 */

'use strict';

const { SOCKET_EVENTS } = require('../../config/constants');
const { Conversation } = require('../../models');
const { participantId } = require('../../utils/helpers/conversation');
const broadcast = require('../broadcast');
const logger = require('../../config/logger');

function registerMessageHandlers(io, socket) {
    const me = socket.data.user;

    socket.on(
        SOCKET_EVENTS.MESSAGE_READ || 'message:read',
        async (payload = {}, ack) => {
            try {
                const { conversationId, upToMessageId } = payload;
                if (!conversationId) return;

                const conv = await Conversation.findById(conversationId);
                if (!conv) return;

                const meP = conv.participants.find(
                    (p) => participantId(p).toString() === me.id && !p.leftAt
                );
                if (!meP) return;

                meP.unreadCount = 0;
                meP.lastReadAt = new Date();
                if (upToMessageId) meP.lastReadMessageId = upToMessageId;
                await conv.save();

                broadcast.messageRead({
                    conversationId,
                    userId: me.id,
                    upToMessageId: upToMessageId || null,
                    readAt: meP.lastReadAt,
                });

                if (typeof ack === 'function') {
                    ack({ data: { ok: true, readAt: meP.lastReadAt } });
                }
            } catch (err) {
                logger.error(`message:read failed: ${err.message}`);
                if (typeof ack === 'function') {
                    ack({ error: { code: 'READ_FAILED', message: err.message } });
                }
            }
        }
    );
}

module.exports = { registerMessageHandlers };