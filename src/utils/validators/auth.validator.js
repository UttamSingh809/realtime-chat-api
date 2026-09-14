/**
 * Joi schemas for auth routes.
 * Rules are intentionally strict to reject malformed input early.
 */

'use strict';

const Joi = require('joi');
const { validatePasswordStrength } = require('../helpers/password');

// Reusable field definitions
const email = Joi.string().email({ tlds: { allow: false } }).lowercase().trim().max(160).required();
const password = Joi.string()
    .min(8)
    .max(128)
    .custom((value, helpers) => {
        const result = validatePasswordStrength(value);
        if (!result.ok) return helpers.message(result.reason);
        return value;
    })
    .required();
const username = Joi.string()
    .lowercase()
    .trim()
    .min(3)
    .max(30)
    .pattern(/^[a-z0-9_.]+$/)
    .required()
    .messages({
        'string.pattern.base': 'Username may only contain lowercase letters, numbers, "_" and "."',
    });
const name = Joi.string().trim().min(2).max(80).required();

// ---------------------------------------------------------------------------
// Route schemas
// ---------------------------------------------------------------------------

const registerSchema = Joi.object({
    name,
    username,
    email,
    password,
});

const loginSchema = Joi.object({
    // Accept either email or username for login
    email: Joi.string().email({ tlds: { allow: false } }).lowercase().trim().empty('').optional(),
    username: Joi.string().lowercase().trim().empty('').optional(),
    password: Joi.string().max(128).required(),
})
    .or('email', 'username')
    .messages({
        'object.missing': 'Either email or username is required',
    });

const refreshSchema = Joi.object({
    refreshToken: Joi.string().min(20).optional(),
});

const logoutSchema = Joi.object({
    refreshToken: Joi.string().min(20).optional(),
});

const forgotPasswordSchema = Joi.object({
    email,
});

const resetPasswordSchema = Joi.object({
    token: Joi.string().min(32).required(),
    password,
});

const changePasswordSchema = Joi.object({
    currentPassword: Joi.string().max(128).required(),
    newPassword: password,
});

module.exports = {
    registerSchema,
    loginSchema,
    refreshSchema,
    logoutSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    changePasswordSchema,
};