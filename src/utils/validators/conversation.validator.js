/**
 * Joi schemas for conversation routes.
 */

'use strict';

const Joi = require('joi');
const { CONVERSATION_TYPE } = require('../../config/constants');

const objectId = Joi.string().regex(/^[a-f0-9]{24}$/i).message('Invalid ID');

const createConversationSchema = Joi.object({
    type: Joi.string().valid(CONVERSATION_TYPE.PRIVATE, CONVERSATION_TYPE.GROUP).required(),
    // For private: exactly one recipientId
    recipientId: objectId.when('type', {
        is: CONVERSATION_TYPE.PRIVATE,
        then: Joi.required(),
        otherwise: Joi.forbidden(),
    }),
    // For group: name + optional description + participants (must include creator)
    name: Joi.string().trim().min(1).max(100).when('type', {
        is: CONVERSATION_TYPE.GROUP,
        then: Joi.required(),
        otherwise: Joi.forbidden(),
    }),
    description: Joi.string().trim().max(500).allow('').when('type', {
        is: CONVERSATION_TYPE.GROUP,
        then: Joi.optional(),
        otherwise: Joi.forbidden(),
    }),
    participants: Joi.array()
        .items(objectId)
        .min(1)
        .max(99)
        .when('type', {
            is: CONVERSATION_TYPE.GROUP,
            then: Joi.required(),
            otherwise: Joi.forbidden(),
        })
        .messages({
            'array.min': 'A group requires at least one other participant',
            'array.max': 'A group cannot have more than 100 members',
        }),
    avatar: Joi.object({
        url: Joi.string().uri().allow(null, '').max(2000),
        publicId: Joi.string().allow(null, '').max(200),
    }).when('type', {
        is: CONVERSATION_TYPE.GROUP,
        then: Joi.optional(),
        otherwise: Joi.forbidden(),
    }),
});

const updateConversationSchema = Joi.object({
    name: Joi.string().trim().min(1).max(100),
    description: Joi.string().trim().max(500).allow(''),
    avatar: Joi.object({
        url: Joi.string().uri().allow(null, '').max(2000),
        publicId: Joi.string().allow(null, '').max(200),
    }),
}).min(1);

const addMemberSchema = Joi.object({
    userId: objectId.required(),
});

const updateRoleSchema = Joi.object({
    role: Joi.string().valid('admin', 'member').required(),
});

const listConversationsSchema = Joi.object({
    archived: Joi.boolean().default(false),
    pinned: Joi.boolean().default(false),
    limit: Joi.number().integer().min(1).max(100),
    before: Joi.string().allow('', null), // cursor: ISO date or ObjectId
});

const markReadSchema = Joi.object({
    upToMessageId: objectId.optional(),
});

const pinSchema = Joi.object({
    pinned: Joi.boolean().required(),
});

const archiveSchema = Joi.object({
    archived: Joi.boolean().required(),
});

const muteSchema = Joi.object({
    muted: Joi.boolean().required(),
    mutedUntil: Joi.date().iso().allow(null).optional(),
});

module.exports = {
    createConversationSchema,
    updateConversationSchema,
    addMemberSchema,
    updateRoleSchema,
    listConversationsSchema,
    markReadSchema,
    pinSchema,
    archiveSchema,
    muteSchema,
};