/**
 * Conversation-related helpers.
 */

'use strict';

/**
 * Extract the underlying ObjectId from a participant's `userId`, which may be
 * either a raw ObjectId or a populated User document.
 *
 * This is required because `.populate('participants.userId', ...)` replaces
 * the ObjectId with a full User document, and `.toString()` on that returns
 * "[object Object]" instead of the hex id.
 *
 * @param {Object} participant
 * @returns {import('mongoose').Types.ObjectId|null}
 */
function participantId(participant) {
    if (!participant || !participant.userId) return null;
    // Populated? Then userId is a doc and _id lives inside it.
    return participant.userId._id ? participant.userId._id : participant.userId;
}

module.exports = { participantId };