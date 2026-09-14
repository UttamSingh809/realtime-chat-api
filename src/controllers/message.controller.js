/**
 * Message controller — thin HTTP layer.
 */

'use strict';

const { MessageService } = require('../services/message.service');
const asyncHandler = require('../utils/helpers/asyncHandler');

const MessageController = {
    send: asyncHandler(async (req, res) => {
        const message = await MessageService.send(req.user.id, req.body);
        res.status(201).json({ success: true, data: { message } });
    }),

    getHistory: asyncHandler(async (req, res) => {
        const result = await MessageService.getHistory(
            req.user.id,
            req.params.conversationId,
            req.query
        );
        res.status(200).json({ success: true, data: result });
    }),

    getById: asyncHandler(async (req, res) => {
        const message = await MessageService.getById(req.user.id, req.params.id);
        res.status(200).json({ success: true, data: { message } });
    }),

    edit: asyncHandler(async (req, res) => {
        const message = await MessageService.edit(req.user.id, req.params.id, req.body);
        res.status(200).json({ success: true, data: { message } });
    }),

    remove: asyncHandler(async (req, res) => {
        const result = await MessageService.delete(
            req.user.id,
            req.params.id,
            req.query.for || 'me'
        );
        res.status(200).json({ success: true, data: result });
    }),

    addReaction: asyncHandler(async (req, res) => {
        const result = await MessageService.addReaction(
            req.user.id,
            req.params.id,
            req.body.emoji
        );
        res.status(200).json({ success: true, data: result });
    }),

    removeReaction: asyncHandler(async (req, res) => {
        const result = await MessageService.removeReaction(req.user.id, req.params.id);
        res.status(200).json({ success: true, data: result });
    }),

    star: asyncHandler(async (req, res) => {
        const result = await MessageService.star(req.user.id, req.params.id);
        res.status(200).json({ success: true, data: result });
    }),

    unstar: asyncHandler(async (req, res) => {
        const result = await MessageService.unstar(req.user.id, req.params.id);
        res.status(200).json({ success: true, data: result });
    }),

    pin: asyncHandler(async (req, res) => {
        const result = await MessageService.pin(req.user.id, req.params.id);
        res.status(200).json({ success: true, data: result });
    }),

    unpin: asyncHandler(async (req, res) => {
        const result = await MessageService.unpin(req.user.id, req.params.id);
        res.status(200).json({ success: true, data: result });
    }),

    markRead: asyncHandler(async (req, res) => {
        const result = await MessageService.markRead(req.user.id, req.params.id);
        res.status(200).json({ success: true, data: result });
    }),

    forward: asyncHandler(async (req, res) => {
        const message = await MessageService.forward(req.user.id, req.body);
        res.status(201).json({ success: true, data: { message } });
    }),

    search: asyncHandler(async (req, res) => {
        const result = await MessageService.search(req.user.id, req.query);
        res.status(200).json({ success: true, data: result });
    }),

    markDelivered: asyncHandler(async (req, res) => {
        const result = await MessageService.markDelivered(req.user.id, req.params.id);
        res.status(200).json({ success: true, data: result });
    }),
};

module.exports = MessageController;