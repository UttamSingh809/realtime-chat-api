/**
 * Message routes.
 *
 * Route ordering matters: /search and /message/:id must come before
 * /:conversationId so they aren't captured as conversation IDs.
 */

'use strict';

const express = require('express');
const MessageController = require('../controllers/message.controller');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const {
    sendMessageSchema,
    editMessageSchema,
    deleteMessageQuerySchema,
    historySchema,
    reactionSchema,
    forwardSchema,
    searchMessagesSchema,
} = require('../utils/validators/message.validator');

const router = express.Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Static / search routes FIRST
// ---------------------------------------------------------------------------
router.post('/', validate(sendMessageSchema), MessageController.send);
router.get('/search', validate(searchMessagesSchema, 'query'), MessageController.search);
router.post('/forward', validate(forwardSchema), MessageController.forward);

// ---------------------------------------------------------------------------
// Single-message by ID (before the conversation history route)
// ---------------------------------------------------------------------------
router.get('/message/:id', MessageController.getById);
router.put('/:id', validate(editMessageSchema), MessageController.edit);
router.delete('/:id', validate(deleteMessageQuerySchema, 'query'), MessageController.remove);

router.post('/:id/reaction', validate(reactionSchema), MessageController.addReaction);
router.delete('/:id/reaction', MessageController.removeReaction);

router.post('/:id/star', MessageController.star);
router.delete('/:id/star', MessageController.unstar);

router.post('/:id/pin', MessageController.pin);
router.delete('/:id/pin', MessageController.unpin);

router.post('/:id/read', MessageController.markRead);

router.post('/:id/deliver', MessageController.markDelivered);
// ---------------------------------------------------------------------------
// Conversation history LAST (catch-all)
// ---------------------------------------------------------------------------
router.get('/:conversationId', validate(historySchema, 'query'), MessageController.getHistory);

module.exports = router;