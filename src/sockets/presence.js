/**
 * Presence tracking.
 *
 * - socketIds are stored on the User document (multi-tab support).
 * - We use an in-process map for fast lookups of "who's online right now".
 * - Broadcasts user:status to the user's contacts.
 */

'use strict';

const { User, Conversation } = require('../models');
const logger = require('../config/logger');

/**
 * In-memory presence cache: userId -> Set<socketId>
 * NOTE: single-instance only. For multi-instance, use Redis.
 */
const onlineSockets = new Map();

function isOnline(userId) {
    const set = onlineSockets.get(String(userId));
    return !!set && set.size > 0;
}

function onlineUserIds() {
    return Array.from(onlineSockets.keys(). map(String));
}

/**
 * Add a socket for a user. Returns true if the user just came online
 * (was previously offline), false if they were already online from another tab.
 */
async function addSocket(userId, socketId) {
    const key = String(userId);
    let set = onlineSockets.get(key);
    const wasOffline = !set || set.size === 0;

    if (!set) {
        set = new Set();
        onlineSockets.set(key, set);
    }
    set.add(socketId);

    // Persist to DB for cross-restart accuracy / external queries
    try {
        await User.updateOne(
            { _id: userId },
            {
                $addToSet: { socketIds: socketId },
                $set: { status: 'online', lastSeen: new Date() },
            }
        );
    } catch (err) {
        logger.error(`Presence addSocket DB error: ${err.message}`);
    }

    return wasOffline;
}

/**
 * Remove a socket. Returns true if the user just went fully offline.
 */
async function removeSocket(userId, socketId) {
    const key = String(userId);
    const set = onlineSockets.get(key);
    if (set) {
        set.delete(socketId);
        if (set.size === 0) onlineSockets.delete(key);
    }

    // The in-memory map is the source of truth for "is this user still online".
    // If any other socket exists for this user, they're still online.
    const stillOnline = onlineSockets.has(key);

    let becameOffline = false;
    try {
        const user = await User.findById(userId);
        if (!user) return false;

        // Always resync the DB array to match reality
        user.socketIds = (user.socketIds || []).filter((id) => id !== socketId);

        if (!stillOnline) {
            // No in-memory sockets → definitely offline
            user.status = 'offline';
            user.lastSeen = new Date();
            user.socketIds = []; // cleanup any stragglers
            becameOffline = true;
        } else if (user.status === 'offline') {
            // We still have sockets but status says offline → correct it
            user.status = 'online';
        }

        await user.save();
    } catch (err) {
        logger.error(`Presence removeSocket DB error: ${err.message}`);
    }

    return becameOffline;
}

/**
 * Set a user's status manually (away, busy, online).
 */
async function setStatus(userId, status, statusMessage) {
    const user = await User.findById(userId);
    if (!user) throw new Error('USER_NOT_FOUND');

    user.status = status;
    if (statusMessage !== undefined) user.statusMessage = statusMessage;
    user.lastSeen = new Date();
    await user.save();

    return {
        userId: user._id.toString(),
        status: user.status,
        statusMessage: user.statusMessage,
        lastSeen: user.lastSeen,
    };
}

/**
 * Fetch the set of "contacts" — distinct user IDs across all conversations
 * this user participates in. Used for presence fan-out.
 */
async function getContactIds(userId) {
    const convs = await Conversation.find({ 'participants.userId': userId })
        .select('participants.userId')
        .lean();

    const ids = new Set();
    for (const c of convs) {
        for (const p of c.participants || []) {
            const pid = p.userId?._id ? p.userId._id : p.userId;
            if (pid && pid.toString() !== String(userId)) {
                ids.add(pid.toString());
            }
        }
    }
    return Array.from(ids);
}

/**
 * Get the IDs of all users who are currently online.
 */
function allOnlineUserIds() {
    return Array.from(onlineSockets.keys());
}

module.exports = {
    isOnline,
    onlineUserIds,
    allOnlineUserIds,
    addSocket,
    removeSocket,
    setStatus,
    getContactIds,
    _onlineSockets: onlineSockets, // for tests
};