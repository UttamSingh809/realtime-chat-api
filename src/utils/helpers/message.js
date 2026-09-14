/**
 * Message-related helpers.
 */

'use strict';

/**
 * Extract the underlying ObjectId from a field that may be populated.
 * Works for `senderId`, `replyTo.senderId`, `forwardedFrom.senderId`, etc.
 *
 * @param {Object|ObjectId} value — either a raw ObjectId or a populated doc
 * @returns {ObjectId|null}
 */
function refId(value) {
    if (!value) return null;
    if (value._id) return value._id;
    return value;
}

/**
 * A message is "visible" to a user if it hasn't been deleted-for-everyone
 * and the user isn't in the deletedFor list.
 */
function isVisibleTo(message, userId) {
    if (!message) return false;
    if (message.deletedForEveryone) return false;
    if (!userId) return true;
    const idStr = userId.toString();
    return !(message.deletedFor || []).some(
        (id) => refId(id).toString() === idStr
    );
}

/**
 * Validate a reaction emoji.
 * Allows up to 8 grapheme-ish characters. Very permissive but blocks
 * HTML/script injection because reactions are stored, not rendered as HTML.
 */
const EMOJI_REGEX = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\uFE0F\u{1F3FB}-\u{1F3FF}]{1,8}$/u;

function isValidEmoji(emoji) {
    if (typeof emoji !== 'string') return false;
    if (emoji.length === 0) return false;
    if (Buffer.byteLength(emoji, 'utf8') > 64) return false;
    return EMOJI_REGEX.test(emoji);
}

/**
 * Preview text for the conversation's lastMessage denormalized field.
 */
function buildPreview(message) {
    if (message.deletedForEveryone) return 'This message was deleted';
    if (message.type === 'image') return '📷 Photo';
    if (message.type === 'file') return '📎 File';
    if (message.type === 'audio') return '🎤 Audio';
    if (message.type === 'video') return '🎬 Video';
    return (message.content || '').substring(0, 200);
}

module.exports = {
    refId,
    isVisibleTo,
    isValidEmoji,
    buildPreview,
};