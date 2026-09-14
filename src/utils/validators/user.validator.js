/**
 * Joi schemas for user routes.
 */

'use strict';

const Joi = require('joi');
const { USER_STATUS } = require('../../config/constants');

const avatarSchema = Joi.object({
    url: Joi.string().uri().allow(null, '').max(2000),
    publicId: Joi.string().allow(null, '').max(200),
});

const updateProfileSchema = Joi.object({
    name: Joi.string().trim().min(2).max(80),
    bio: Joi.string().trim().max(200).allow(''),
    phone: Joi.string().trim().max(30).allow(null, ''),
    statusMessage: Joi.string().trim().max(100).allow(''),
    avatar: avatarSchema,
}).min(1); // require at least one field to update

const updateSettingsSchema = Joi.object({
    notifications: Joi.object({
        messages: Joi.boolean(),
        mentions: Joi.boolean(),
        reactions: Joi.boolean(),
        sound: Joi.boolean(),
        email: Joi.boolean(),
        push: Joi.boolean(),
    }).min(1),
    privacy: Joi.object({
        showLastSeen: Joi.boolean(),
        showOnlineStatus: Joi.boolean(),
        readReceipts: Joi.boolean(),
        allowMessagesFrom: Joi.string().valid('everyone', 'contacts', 'nobody'),
    }).min(1),
    theme: Joi.string().valid('light', 'dark', 'system'),
    language: Joi.string().min(2).max(10),
}).min(1);

const updateStatusSchema = Joi.object({
    status: Joi.string()
        .valid(USER_STATUS.ONLINE, USER_STATUS.AWAY, USER_STATUS.BUSY, USER_STATUS.OFFLINE)
        .required(),
    statusMessage: Joi.string().trim().max(100).allow(''),
});

const searchUsersSchema = Joi.object({
    q: Joi.string().trim().max(80).allow(''),
    limit: Joi.number().integer().min(1).max(100),
    page: Joi.number().integer().min(1),
});

module.exports = {
    updateProfileSchema,
    updateSettingsSchema,
    updateStatusSchema,
    searchUsersSchema,
};