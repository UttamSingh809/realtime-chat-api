/**
 * User-related socket event handlers:
 *   - connection bootstrap
 *   - presence set
 *   - ping/pong
 */

'use strict';

const { SOCKET_EVENTS } = require('../../config/constants');
const { setStatus, getContactIds } = require('../presence');
const broadcast = require('../broadcast');
const logger = require('../../config/logger');

function registerUserHandlers(io, socket) {
    const me = socket.data.user;

    // -------------------------------------------------------------------------
    // Ping / pong — health check
    // -------------------------------------------------------------------------
    socket.on('ping', (ack) => {
        if (typeof ack === 'function') ack({ pong: true, ts: Date.now() });
        else socket.emit('pong', { ts: Date.now() });
    });

    // -------------------------------------------------------------------------
    // Manually set status (away / busy / online)
    // -------------------------------------------------------------------------
    socket.on(SOCKET_EVENTS.USER_STATUS || 'user:status', async (payload = {}, ack) => {
        try {
            const { status, statusMessage } = payload;
            const allowed = ['online', 'away', 'busy', 'offline'];
            if (!allowed.includes(status)) {
                const err = { code: 'INVALID_STATUS', message: 'Invalid status value' };
                if (typeof ack === 'function') ack({ error: err });
                socket.emit('error', err);
                return;
            }

            const updated = await setStatus(me.id, status, statusMessage);

            // Fan out to contacts
            const contactIds = await getContactIds(me.id);
            broadcast.userStatus(contactIds, updated);

            if (typeof ack === 'function') ack({ data: updated });
        } catch (err) {
            logger.error(`user:status failed: ${err.message}`);
            const errPayload = { code: 'STATUS_UPDATE_FAILED', message: err.message };
            if (typeof ack === 'function') ack({ error: errPayload });
            socket.emit('error', errPayload);
        }
    });
}

module.exports = { registerUserHandlers };