/**
 * Notification routes.
 *
 * Order matters: /unread-count and /read-all must be declared
 * before /:id, otherwise Express matches them as IDs.
 */

'use strict';

const express = require('express');
const NotificationController = require('../controllers/notification.controller');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { listNotificationsSchema } = require('../utils/validators/notification.validator');

const router = express.Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Static routes FIRST
// ---------------------------------------------------------------------------
router.get('/unread-count', NotificationController.unreadCount);
router.put('/read-all', NotificationController.markAllRead);
router.delete('/', NotificationController.clearAll);

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
router.get('/', validate(listNotificationsSchema, 'query'), NotificationController.list);

// ---------------------------------------------------------------------------
// Single by ID
// ---------------------------------------------------------------------------
router.put('/:id/read', NotificationController.markRead);
router.delete('/:id', NotificationController.remove);

module.exports = router;