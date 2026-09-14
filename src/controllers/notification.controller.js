/**
 * Notification controller — thin HTTP layer.
 */

'use strict';

const { NotificationService } = require('../services/notification.service');
const asyncHandler = require('../utils/helpers/asyncHandler');

const NotificationController = {
    list: asyncHandler(async (req, res) => {
        const result = await NotificationService.list(req.user.id, req.query);
        res.status(200).json({ success: true, data: result });
    }),

    unreadCount: asyncHandler(async (req, res) => {
        const result = await NotificationService.unreadCount(req.user.id);
        res.status(200).json({ success: true, data: result });
    }),

    markRead: asyncHandler(async (req, res) => {
        const notification = await NotificationService.markRead(req.user.id, req.params.id);
        res.status(200).json({ success: true, data: { notification } });
    }),

    markAllRead: asyncHandler(async (req, res) => {
        const result = await NotificationService.markAllRead(req.user.id);
        res.status(200).json({ success: true, data: result });
    }),

    remove: asyncHandler(async (req, res) => {
        const result = await NotificationService.remove(req.user.id, req.params.id);
        res.status(200).json({ success: true, data: result });
    }),

    clearAll: asyncHandler(async (req, res) => {
        const result = await NotificationService.clearAll(req.user.id);
        res.status(200).json({ success: true, data: result });
    }),
};

module.exports = NotificationController;