/**
 * Auth controller — thin HTTP layer.
 * Translates req/res ↔ AuthService calls. No business logic here.
 */

'use strict';

const AuthService = require('../services/auth.service');
const asyncHandler = require('../utils/helpers/asyncHandler');

/**
 * Attach refresh token as HttpOnly cookie AND include in body
 * so clients (mobile) can store it however they want.
 */
function setRefreshCookie(res, token) {
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days
    res.cookie('refreshToken', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
        maxAge: maxAgeMs,
        path: '/api/auth', // only sent to auth endpoints
    });
}

function clearRefreshCookie(res) {
    res.clearCookie('refreshToken', { path: '/api/auth' });
}

const AuthController = {
    register: asyncHandler(async (req, res) => {
        const result = await AuthService.register(req.body, {
            userAgent: req.headers['user-agent'],
            ip: req.ip,
        });
        setRefreshCookie(res, result.refreshToken);
        res.status(201).json({ success: true, data: result });
    }),

    login: asyncHandler(async (req, res) => {
        const result = await AuthService.login(req.body, {
            userAgent: req.headers['user-agent'],
            ip: req.ip,
        });
        setRefreshCookie(res, result.refreshToken);
        res.status(200).json({ success: true, data: result });
    }),

    refresh: asyncHandler(async (req, res) => {
        // Accept from body OR cookie
        const token = req.body.refreshToken || req.cookies?.refreshToken;
        const result = await AuthService.refresh(token, {
            userAgent: req.headers['user-agent'],
            ip: req.ip,
        });
        setRefreshCookie(res, result.refreshToken);
        res.status(200).json({ success: true, data: result });
    }),

    logout: asyncHandler(async (req, res) => {
        const token = req.body.refreshToken || req.cookies?.refreshToken;
        const result = await AuthService.logout(token);
        clearRefreshCookie(res);
        res.status(200).json({ success: true, data: result });
    }),

    logoutAll: asyncHandler(async (req, res) => {
        const result = await AuthService.logoutAll(req.user.id);
        clearRefreshCookie(res);
        res.status(200).json({ success: true, data: result });
    }),

    forgotPassword: asyncHandler(async (req, res) => {
        const result = await AuthService.forgotPassword(req.body.email);
        res.status(200).json({
            success: true,
            message: 'If an account exists with that email, a reset link has been sent.',
            data: result,
        });
    }),

    resetPassword: asyncHandler(async (req, res) => {
        const result = await AuthService.resetPassword(req.body);
        clearRefreshCookie(res);
        res.status(200).json({ success: true, data: result });
    }),

    changePassword: asyncHandler(async (req, res) => {
        const result = await AuthService.changePassword(req.user.id, req.body);
        clearRefreshCookie(res);
        res.status(200).json({ success: true, data: result });
    }),

    me: asyncHandler(async (req, res) => {
        const user = await AuthService.me(req.user.id);
        res.status(200).json({ success: true, data: { user } });
    }),
};

module.exports = AuthController;