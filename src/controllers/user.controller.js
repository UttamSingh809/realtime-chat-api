/**
 * User controller — thin HTTP layer.
 */

'use strict';

const { UserService } = require('../services/user.service');
const asyncHandler = require('../utils/helpers/asyncHandler');

const UserController = {
    // Self
    getMe: asyncHandler(async (req, res) => {
        const user = await UserService.getMe(req.user.id);
        res.status(200).json({ success: true, data: { user } });
    }),

    updateProfile: asyncHandler(async (req, res) => {
        const user = await UserService.updateProfile(req.user.id, req.body);
        res.status(200).json({ success: true, data: { user } });
    }),

    updateSettings: asyncHandler(async (req, res) => {
        const user = await UserService.updateSettings(req.user.id, req.body);
        res.status(200).json({ success: true, data: { user } });
    }),

    updateStatus: asyncHandler(async (req, res) => {
        const result = await UserService.updateStatus(req.user.id, req.body);
        res.status(200).json({ success: true, data: result });
    }),

    // Search & listing
    search: asyncHandler(async (req, res) => {
        const result = await UserService.search(req.user.id, req.query);
        res.status(200).json({ success: true, data: result });
    }),

    listOnline: asyncHandler(async (req, res) => {
        const users = await UserService.listOnline(req.user.id, req.query);
        res.status(200).json({ success: true, data: { users } });
    }),

    // Public profile
    getById: asyncHandler(async (req, res) => {
        const user = await UserService.getById(req.user.id, req.params.id);
        res.status(200).json({ success: true, data: { user } });
    }),

    // Block
    block: asyncHandler(async (req, res) => {
        const result = await UserService.block(req.user.id, req.params.id);
        res.status(200).json({ success: true, data: result });
    }),

    unblock: asyncHandler(async (req, res) => {
        const result = await UserService.unblock(req.user.id, req.params.id);
        res.status(200).json({ success: true, data: result });
    }),

    listBlocked: asyncHandler(async (req, res) => {
        const users = await UserService.listBlocked(req.user.id);
        res.status(200).json({ success: true, data: { users } });
    }),

    // Mute
    mute: asyncHandler(async (req, res) => {
        const result = await UserService.mute(req.user.id, req.params.id);
        res.status(200).json({ success: true, data: result });
    }),

    unmute: asyncHandler(async (req, res) => {
        const result = await UserService.unmute(req.user.id, req.params.id);
        res.status(200).json({ success: true, data: result });
    }),

    listMuted: asyncHandler(async (req, res) => {
        const users = await UserService.listMuted(req.user.id);
        res.status(200).json({ success: true, data: { users } });
    }),
};

module.exports = UserController;