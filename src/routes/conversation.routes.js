/**
 * Conversation routes.
 * All require authentication.
 */

'use strict';

const express = require('express');
const ConversationController = require('../controllers/conversation.controller');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const {
    createConversationSchema,
    updateConversationSchema,
    addMemberSchema,
    updateRoleSchema,
    listConversationsSchema,
    markReadSchema,
    pinSchema,
    archiveSchema,
    muteSchema,
} = require('../utils/validators/conversation.validator');

const router = express.Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
router.post('/', validate(createConversationSchema), ConversationController.create);
router.get('/', validate(listConversationsSchema, 'query'), ConversationController.list);
router.get('/:id', ConversationController.getById);
router.put('/:id', validate(updateConversationSchema), ConversationController.update);
router.delete('/:id', ConversationController.leave);

// ---------------------------------------------------------------------------
// Members (group-only, guarded in service)
// ---------------------------------------------------------------------------
router.post('/:id/members', validate(addMemberSchema), ConversationController.addMember);
router.delete('/:id/members/:userId', ConversationController.removeMember);
router.put(
    '/:id/members/:userId/role',
    validate(updateRoleSchema),
    ConversationController.updateMemberRole
);

// ---------------------------------------------------------------------------
// Per-user flags
// ---------------------------------------------------------------------------
router.put('/:id/pin', validate(pinSchema), ConversationController.setPinned);
router.put('/:id/archive', validate(archiveSchema), ConversationController.setArchived);
router.put('/:id/mute', validate(muteSchema), ConversationController.setMuted);
router.post('/:id/read', validate(markReadSchema), ConversationController.markRead);

module.exports = router;