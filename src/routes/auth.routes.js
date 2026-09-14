/**
 * Auth routes.
 *
 * Chains: rateLimiter → validator → controller
 * Sensitive routes (login/register/forgot/reset) get the stricter limiter.
 */

'use strict';

const express = require('express');
const AuthController = require('../controllers/auth.controller');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const {
    registerSchema,
    loginSchema,
    refreshSchema,
    logoutSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    changePasswordSchema,
} = require('../utils/validators/auth.validator');

const router = express.Router();

// ---------------------------------------------------------------------------
// Public routes (rate-limited)
// ---------------------------------------------------------------------------

router.post('/register', authLimiter, validate(registerSchema), AuthController.register);

router.post('/login', authLimiter, validate(loginSchema), AuthController.login);

router.post('/refresh', validate(refreshSchema), AuthController.refresh);

router.post('/logout', validate(logoutSchema), AuthController.logout);

router.post(
    '/forgot-password',
    authLimiter,
    validate(forgotPasswordSchema),
    AuthController.forgotPassword
);

router.post(
    '/reset-password',
    authLimiter,
    validate(resetPasswordSchema),
    AuthController.resetPassword
);

// ---------------------------------------------------------------------------
// Protected routes
// ---------------------------------------------------------------------------

router.get('/me', requireAuth, AuthController.me);

router.put(
    '/change-password',
    requireAuth,
    validate(changePasswordSchema),
    AuthController.changePassword
);

router.post('/logout-all', requireAuth, AuthController.logoutAll);

module.exports = router;