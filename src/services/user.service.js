/**
 * UserService — user profile, search, block/mute, presence.
 *
 * Serialization is centralized here so every endpoint returns a consistent
 * shape and sensitive fields (email, settings, etc.) can be gated by role.
 */

'use strict';

const mongoose = require('mongoose');
const { User } = require('../models');
const {
    BadRequestError,
    NotFoundError,
    ForbiddenError,
} = require('../utils/exceptions');
const {
    normalizePagination,
    paginateOffset,
} = require('../utils/helpers/pagination');

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

/**
 * Public view of a user — what anyone authenticated can see.
 */
function publicProfile(user) {
    if (!user) return null;
    return {
        id: user._id.toString(),
        name: user.name,
        username: user.username,
        avatar: user.avatar,
        bio: user.bio,
        status: user.status,
        statusMessage: user.statusMessage,
        // Respect privacy settings on presence
        ...(user.settings?.privacy?.showOnlineStatus !== false
            ? { status: user.status }
            : { status: 'offline' }),
        ...(user.settings?.privacy?.showLastSeen !== false
            ? { lastSeen: user.lastSeen }
            : { lastSeen: null }),
        createdAt: user.createdAt,
    };
}

/**
 * Self view — everything a user can see about themselves.
 */
function selfProfile(user) {
    if (!user) return null;
    return {
        id: user._id.toString(),
        name: user.name,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        bio: user.bio,
        phone: user.phone,
        status: user.status,
        statusMessage: user.statusMessage,
        role: user.role,
        lastSeen: user.lastSeen,
        isEmailVerified: user.isEmailVerified,
        settings: user.settings,
        blockedCount: user.blockedUsers ? user.blockedUsers.length : 0,
        mutedCount: user.mutedUsers ? user.mutedUsers.length : 0,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidId(id) {
    return mongoose.Types.ObjectId.isValid(id);
}

function assertValidId(id, label = 'User') {
    if (!isValidId(id)) throw new BadRequestError(`Invalid ${label} ID`, 'INVALID_ID');
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class UserService {
    // -----------------------------------------------------------------------
    // Self
    // -----------------------------------------------------------------------

    static async getMe(userId) {
        const user = await User.findById(userId);
        if (!user) throw new NotFoundError('User not found', 'USER_NOT_FOUND');
        return selfProfile(user);
    }

    static async updateProfile(userId, updates) {
        const user = await User.findById(userId);
        if (!user) throw new NotFoundError('User not found', 'USER_NOT_FOUND');

        // Whitelist: only fields in this list can be updated.
        const allowed = ['name', 'bio', 'phone', 'statusMessage', 'avatar'];
        for (const key of allowed) {
            if (updates[key] !== undefined) {
                user[key] = updates[key];
            }
        }

        await user.save();
        return selfProfile(user);
    }

    static async updateSettings(userId, updates) {
        const user = await User.findById(userId);
        if (!user) throw new NotFoundError('User not found', 'USER_NOT_FOUND');

        // Deep-merge updates into settings to allow partial updates
        const s = user.settings || {};
        if (updates.notifications) {
            s.notifications = { ...s.notifications, ...updates.notifications };
        }
        if (updates.privacy) {
            s.privacy = { ...s.privacy, ...updates.privacy };
        }
        if (updates.theme !== undefined) s.theme = updates.theme;
        if (updates.language !== undefined) s.language = updates.language;

        user.settings = s;
        await user.save();
        return selfProfile(user);
    }

    static async updateStatus(userId, { status, statusMessage }) {
        const user = await User.findById(userId);
        if (!user) throw new NotFoundError('User not found', 'USER_NOT_FOUND');

        user.status = status;
        if (statusMessage !== undefined) user.statusMessage = statusMessage;
        user.lastSeen = new Date();
        await user.save();

        return { status: user.status, statusMessage: user.statusMessage, lastSeen: user.lastSeen };
    }

    // -----------------------------------------------------------------------
    // Public profile
    // -----------------------------------------------------------------------

    static async getById(viewerId, targetId) {
        assertValidId(targetId);
        const user = await User.findById(targetId);
        if (!user) throw new NotFoundError('User not found', 'USER_NOT_FOUND');

        // Blocked relationship (either direction) → pretend user doesn't exist
        const blockedByMe = user.blockedUsers?.some(
            (id) => id.toString() === viewerId.toString()
        );
        if (blockedByMe) {
            throw new NotFoundError('User not found', 'USER_NOT_FOUND');
        }

        const viewer = await User.findById(viewerId).select('blockedUsers');
        const iBlockedThem = viewer?.blockedUsers?.some(
            (id) => id.toString() === targetId.toString()
        );
        if (iBlockedThem) {
            throw new NotFoundError('User not found', 'USER_NOT_FOUND');
        }

        return publicProfile(user);
    }

    // -----------------------------------------------------------------------
    // Search
    // -----------------------------------------------------------------------

    static async search(viewerId, { q, page, limit }) {
        const { limit: l, page: p } = normalizePagination({ page, limit });

        const viewer = await User.findById(viewerId).select('blockedUsers');
        const excludedIds = new Set(
            (viewer?.blockedUsers || []).map((id) => id.toString())
        );
        excludedIds.add(viewerId.toString());

        const baseFilter = {
            _id: { $nin: Array.from(excludedIds).map((id) => new mongoose.Types.ObjectId(id)) },
        };

        let filter = baseFilter;

        if (q && q.trim().length > 0) {
            const term = q.trim();
            if (term.length >= 3) {
                // Text search (uses text index)
                filter = { ...baseFilter, $text: { $search: term } };
            } else {
                // Short prefix → regex
                const rx = new RegExp(`^${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
                filter = {
                    ...baseFilter,
                    $or: [{ username: rx }, { name: rx }],
                };
            }
        }

        // Total for meta (only when not using $text, which doesn't support count well)
        const total = q && q.trim().length >= 3 ? null : await User.countDocuments(filter);

        let query = User.find(filter)
            .sort({ status: -1, lastSeen: -1, username: 1 })
            .select('name username avatar bio status statusMessage lastSeen settings createdAt');

        const { query: paged } = paginateOffset(query, { page: p, limit: l });

        const users = await paged.lean();
        const items = users.map(publicProfile);

        return {
            items,
            meta: {
                page: p,
                limit: l,
                total,
                hasNextPage: total !== null ? p * l < total : items.length === l,
                hasPrevPage: p > 1,
            },
        };
    }

    // -----------------------------------------------------------------------
    // Online
    // -----------------------------------------------------------------------

    static async listOnline(viewerId, { limit = 50 } = {}) {
        const l = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);

        const viewer = await User.findById(viewerId).select('blockedUsers');
        const excludedIds = (viewer?.blockedUsers || []).map((id) => id.toString());
        excludedIds.push(viewerId.toString());

        const users = await User.find({
            status: { $in: ['online', 'away', 'busy'] },
            _id: { $nin: excludedIds.map((id) => new mongoose.Types.ObjectId(id)) },
        })
            .sort({ status: 1, lastSeen: -1 })
            .limit(l)
            .select('name username avatar status statusMessage lastSeen settings')
            .lean();

        return users.map(publicProfile);
    }

    // -----------------------------------------------------------------------
    // Block
    // -----------------------------------------------------------------------

    static async block(viewerId, targetId) {
        assertValidId(targetId);
        if (viewerId.toString() === targetId.toString()) {
            throw new BadRequestError('You cannot block yourself', 'CANNOT_BLOCK_SELF');
        }

        const target = await User.findById(targetId);
        if (!target) throw new NotFoundError('User not found', 'USER_NOT_FOUND');

        const viewer = await User.findById(viewerId);
        if (!viewer) throw new NotFoundError('User not found', 'USER_NOT_FOUND');

        const already = viewer.blockedUsers.some(
            (id) => id.toString() === targetId.toString()
        );
        if (already) {
            return { blocked: true, alreadyBlocked: true };
        }

        viewer.blockedUsers.push(target._id);

        // Also remove from muted (block supersedes mute)
        viewer.mutedUsers = viewer.mutedUsers.filter(
            (id) => id.toString() !== targetId.toString()
        );

        await viewer.save();
        return { blocked: true, alreadyBlocked: false };
    }

    static async unblock(viewerId, targetId) {
        assertValidId(targetId);
        const viewer = await User.findById(viewerId);
        if (!viewer) throw new NotFoundError('User not found', 'USER_NOT_FOUND');

        const before = viewer.blockedUsers.length;
        viewer.blockedUsers = viewer.blockedUsers.filter(
            (id) => id.toString() !== targetId.toString()
        );
        const removed = viewer.blockedUsers.length < before;

        if (removed) await viewer.save();
        return { unblocked: removed };
    }

    static async listBlocked(viewerId) {
        const viewer = await User.findById(viewerId)
            .populate('blockedUsers', 'name username avatar status lastSeen');
        if (!viewer) throw new NotFoundError('User not found', 'USER_NOT_FOUND');
        return (viewer.blockedUsers || []).map(publicProfile);
    }

    // -----------------------------------------------------------------------
    // Mute
    // -----------------------------------------------------------------------

    static async mute(viewerId, targetId) {
        assertValidId(targetId);
        if (viewerId.toString() === targetId.toString()) {
            throw new BadRequestError('You cannot mute yourself', 'CANNOT_MUTE_SELF');
        }

        const target = await User.findById(targetId);
        if (!target) throw new NotFoundError('User not found', 'USER_NOT_FOUND');

        const viewer = await User.findById(viewerId);
        if (!viewer) throw new NotFoundError('User not found', 'USER_NOT_FOUND');

        const already = viewer.mutedUsers.some(
            (id) => id.toString() === targetId.toString()
        );
        if (already) return { muted: true, alreadyMuted: true };

        viewer.mutedUsers.push(target._id);
        await viewer.save();
        return { muted: true, alreadyMuted: false };
    }

    static async unmute(viewerId, targetId) {
        assertValidId(targetId);
        const viewer = await User.findById(viewerId);
        if (!viewer) throw new NotFoundError('User not found', 'USER_NOT_FOUND');

        const before = viewer.mutedUsers.length;
        viewer.mutedUsers = viewer.mutedUsers.filter(
            (id) => id.toString() !== targetId.toString()
        );
        const removed = viewer.mutedUsers.length < before;

        if (removed) await viewer.save();
        return { unmuted: removed };
    }

    static async listMuted(viewerId) {
        const viewer = await User.findById(viewerId)
            .populate('mutedUsers', 'name username avatar status lastSeen');
        if (!viewer) throw new NotFoundError('User not found', 'USER_NOT_FOUND');
        return (viewer.mutedUsers || []).map(publicProfile);
    }

    // -----------------------------------------------------------------------
    // Block/mute check (used by other services)
    // -----------------------------------------------------------------------

    /**
     * Returns true if `a` has blocked `b` (one-way).
     * @param {string|ObjectId} a
     * @param {string|ObjectId} b
     */
    static async isBlocked(a, b) {
        const user = await User.findById(a).select('blockedUsers').lean();
        if (!user) return false;
        return (user.blockedUsers || []).some((id) => id.toString() === b.toString());
    }

    /**
     * Returns true if either has blocked the other.
     */
    static async isMutuallyBlocked(a, b) {
        const [aBlocksB, bBlocksA] = await Promise.all([
            this.isBlocked(a, b),
            this.isBlocked(b, a),
        ]);
        return aBlocksB || bBlocksA;
    }
}

module.exports = {
    UserService,
    publicProfile,
    selfProfile,
};