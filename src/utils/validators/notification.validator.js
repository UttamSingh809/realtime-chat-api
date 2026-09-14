/**
 * Joi schemas for notification routes.
 */

'use strict';

const Joi = require('joi');

const objectId = Joi.string().regex(/^[a-f0-9]{24}$/i).message('Invalid ID');

const listNotificationsSchema = Joi.object({
    unreadOnly: Joi.boolean().default(false),
    category: Joi.string().valid('chat', 'social', 'system', 'security'),
    limit: Joi.number().integer().min(1).max(100),
    before: Joi.string().allow('', null), // ISO date cursor
});

module.exports = { listNotificationsSchema };