/**
 * User routes.
 *
 * IMPORTANT: static segments (`/me`, `/online`, etc.) MUST be declared
 * before dynamic `/:id` routes, otherwise `/me` would be matched as id='me'.
 */

'use strict';

const express = require('express');
const UserController = require('../controllers/user.controller');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const {
    updateProfileSchema,
    updateSettingsSchema,
    updateStatusSchema,
    searchUsersSchema,
} = require('../utils/validators/user.validator');

const router = express.Router();

// All user routes require authentication
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Self
// ---------------------------------------------------------------------------
router.get('/me', UserController.getMe);
router.put('/me', validate(updateProfileSchema), UserController.updateProfile);
router.put('/me/settings', validate(updateSettingsSchema), UserController.updateSettings);
router.put('/me/status', validate(updateStatusSchema), UserController.updateStatus);

// ---------------------------------------------------------------------------
// Listing (static segments FIRST)
// ---------------------------------------------------------------------------
router.get('/online', UserController.listOnline);
router.get('/blocked', UserController.listBlocked);
router.get('/muted', UserController.listMuted);

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
router.get('/', validate(searchUsersSchema, 'query'), UserController.search);

// ---------------------------------------------------------------------------
// Block/mute actions (targeted by :id)
// ---------------------------------------------------------------------------
router.post('/:id/block', UserController.block);
router.delete('/:id/block', UserController.unblock);
router.post('/:id/mute', UserController.mute);
router.delete('/:id/mute', UserController.unmute);

// ---------------------------------------------------------------------------
// Public profile (must be LAST — catch-all for :id)
// ---------------------------------------------------------------------------
router.get('/:id', UserController.getById);

module.exports = router;