/**
 * Conversation controller — thin HTTP layer.
 */

'use strict';

const { ConversationService } = require('../services/conversation.service');
const asyncHandler = require('../utils/helpers/asyncHandler');

const ConversationController = {
    create: asyncHandler(async (req, res) => {
        const { conversation, created } = await ConversationService.create(
            req.user.id,
            req.body
        );
        res.status(201).json({
            success: true,
            data: { conversation, created },
        });
    }),

    list: asyncHandler(async (req, res) => {
        const result = await ConversationService.list(req.user.id, req.query);
        res.status(200).json({ success: true, data: result });
    }),

    getById: asyncHandler(async (req, res) => {
        const conversation = await ConversationService.getById(req.user.id, req.params.id);
        res.status(200).json({ success: true, data: { conversation } });
    }),

    update: asyncHandler(async (req, res) => {
        const conversation = await ConversationService.update(req.user.id, req.params.id, req.body);
        res.status(200).json({ success: true, data: { conversation } });
    }),

    leave: asyncHandler(async (req, res) => {
        const result = await ConversationService.leave(req.user.id, req.params.id);
        res.status(200).json({ success: true, data: result });
    }),

    addMember: asyncHandler(async (req, res) => {
        const conversation = await ConversationService.addMember(
            req.user.id,
            req.params.id,
            req.body.userId
        );
        res.status(200).json({ success: true, data: { conversation } });
    }),

    removeMember: asyncHandler(async (req, res) => {
        const conversation = await ConversationService.removeMember(
            req.user.id,
            req.params.id,
            req.params.userId
        );
        res.status(200).json({ success: true, data: { conversation } });
    }),

    updateMemberRole: asyncHandler(async (req, res) => {
        const conversation = await ConversationService.updateMemberRole(
            req.user.id,
            req.params.id,
            req.params.userId,
            req.body.role
        );
        res.status(200).json({ success: true, data: { conversation } });
    }),

    setPinned: asyncHandler(async (req, res) => {
        const conversation = await ConversationService.setPinned(
            req.user.id,
            req.params.id,
            req.body.pinned
        );
        res.status(200).json({ success: true, data: { conversation } });
    }),

    setArchived: asyncHandler(async (req, res) => {
        const conversation = await ConversationService.setArchived(
            req.user.id,
            req.params.id,
            req.body.archived
        );
        res.status(200).json({ success: true, data: { conversation } });
    }),

    setMuted: asyncHandler(async (req, res) => {
        const conversation = await ConversationService.setMuted(
            req.user.id,
            req.params.id,
            req.body.muted,
            req.body.mutedUntil
        );
        res.status(200).json({ success: true, data: { conversation } });
    }),

    markRead: asyncHandler(async (req, res) => {
        const result = await ConversationService.markRead(
            req.user.id,
            req.params.id,
            req.body.upToMessageId
        );
        res.status(200).json({ success: true, data: result });
    }),
};

module.exports = ConversationController;