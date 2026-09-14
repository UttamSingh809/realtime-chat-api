/**
 * Joi schemas for message routes.
 */

'use strict';

const Joi = require('joi');
const { MESSAGE_TYPE } = require('../../config/constants');

const objectId = Joi.string().regex(/^[a-f0-9]{24}$/i).message('Invalid ID');

const attachmentSchema = Joi.object({
    // Allow either absolute URIs (cloudinary) OR relative paths (local storage).
    // Local storage returns paths like "/static/uploads/...", which are not
    // "valid URIs" per Joi's strict interpretation, but they're valid for us.
    url: Joi.string()
        .required()
        .custom((value, helpers) => {
            if (/^https?:\/\//i.test(value)) return value;      // absolute URL
            if (/^\/[^\s]*$/.test(value)) return value;         // relative path
            return helpers.error('string.uri');
        }, 'URL or path validation'),

    publicId: Joi.string().allow(null, '').max(200),
    type: Joi.string().valid('image', 'file', 'audio', 'video').required(),
    mimeType: Joi.string().allow(null, '').max(150),
    size: Joi.number().min(0).default(0),
    name: Joi.string().allow(null, '').max(255),

    thumbnail: Joi.string()
        .allow(null, '')
        .custom((value, helpers) => {
            if (!value) return value;
            if (/^https?:\/\//i.test(value)) return value;
            if (/^\/[^\s]*$/.test(value)) return value;
            return helpers.error('string.uri');
        }, 'URL or path validation'),

    width: Joi.number().min(0).allow(null),
    height: Joi.number().min(0).allow(null),
    duration: Joi.number().min(0).allow(null),
});

const sendMessageSchema = Joi.object({
    conversationId: objectId.required(),
    content: Joi.string().trim().max(10000).allow('').default(''),
    type: Joi.string()
        .valid(
            MESSAGE_TYPE.TEXT,
            MESSAGE_TYPE.IMAGE,
            MESSAGE_TYPE.FILE,
            MESSAGE_TYPE.AUDIO,
            MESSAGE_TYPE.VIDEO
        )
        .default(MESSAGE_TYPE.TEXT),
    attachments: Joi.array().items(attachmentSchema).max(10).default([]),
    replyTo: objectId.allow(null),
    mentions: Joi.array().items(objectId).max(50).default([]),
}).custom((value, helpers) => {
    // Require at least one of: non-empty content, or at least one attachment.
    const hasContent =
        typeof value.content === 'string' && value.content.trim().length > 0;
    const hasAttachments =
        Array.isArray(value.attachments) && value.attachments.length > 0;
    if (!hasContent && !hasAttachments) {
        return helpers.error('any.custom', {
            message: 'A message must have content or attachments',
        });
    }
    return value;
}, 'message content/attachment requirement');

const editMessageSchema = Joi.object({
    content: Joi.string().trim().min(1).max(10000).required(),
});

const deleteMessageQuerySchema = Joi.object({
    for: Joi.string().valid('me', 'everyone').default('me'),
});

const historySchema = Joi.object({
    limit: Joi.number().integer().min(1).max(100),
    before: Joi.string().allow('', null), // ISO date
    after: Joi.string().allow('', null),
});

const reactionSchema = Joi.object({
    emoji: Joi.string().min(1).max(64).required(),
});

const forwardSchema = Joi.object({
    messageId: objectId.required(),
    conversationId: objectId.required(),
});

const searchMessagesSchema = Joi.object({
    q: Joi.string().trim().min(1).max(200).required(),
    conversationId: objectId.optional(),
    senderId: objectId.optional(),
    from: Joi.date().iso().optional(),
    to: Joi.date().iso().optional(),
    hasAttachment: Joi.boolean().optional(),
    limit: Joi.number().integer().min(1).max(50),
    before: Joi.string().allow('', null),
});

module.exports = {
    sendMessageSchema,
    editMessageSchema,
    deleteMessageQuerySchema,
    historySchema,
    reactionSchema,
    forwardSchema,
    searchMessagesSchema,
};