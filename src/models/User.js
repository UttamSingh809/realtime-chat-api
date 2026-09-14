/**
 * User model.
 *
 * Handles: authentication, profile, presence, block/mute lists, settings.
 *
 * Indexes:
 *   - email: unique lookup on login
 *   - username: unique lookup on search
 *   - text index on name+username+email for search
 *   - status: for "who's online" queries
 */

'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { baseSchemaOptions } = require('../utils/helpers/schemaHelpers');
const { USER_ROLES, USER_STATUS } = require('../config/constants');

const { Schema } = mongoose;

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const AvatarSchema = new Schema(
    {
        url: { type: String, default: null },
        publicId: { type: String, default: null },
    },
    { _id: false }
);

const SettingsSchema = new Schema(
    {
        notifications: {
            messages: { type: Boolean, default: true },
            mentions: { type: Boolean, default: true },
            reactions: { type: Boolean, default: true },
            sound: { type: Boolean, default: true },
            email: { type: Boolean, default: false },
            push: { type: Boolean, default: false },
        },
        privacy: {
            showLastSeen: { type: Boolean, default: true },
            showOnlineStatus: { type: Boolean, default: true },
            readReceipts: { type: Boolean, default: true },
            allowMessagesFrom: {
                type: String,
                enum: ['everyone', 'contacts', 'nobody'],
                default: 'everyone',
            },
        },
        theme: {
            type: String,
            enum: ['light', 'dark', 'system'],
            default: 'system',
        },
        language: { type: String, default: 'en' },
    },
    { _id: false }
);

// ---------------------------------------------------------------------------
// Main schema
// ---------------------------------------------------------------------------

const UserSchema = new Schema(
    {
        name: {
            type: String,
            required: [true, 'Name is required'],
            trim: true,
            minlength: [2, 'Name must be at least 2 characters'],
            maxlength: [80, 'Name cannot exceed 80 characters'],
        },
        username: {
            type: String,
            required: [true, 'Username is required'],
            unique: true,
            lowercase: true,
            trim: true,
            minlength: [3, 'Username must be at least 3 characters'],
            maxlength: [30, 'Username cannot exceed 30 characters'],
            match: [/^[a-z0-9_.]+$/, 'Username may only contain lowercase letters, numbers, "_" and "."'],
        },
        email: {
            type: String,
            required: [true, 'Email is required'],
            unique: true,
            lowercase: true,
            trim: true,
            match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
        },
        password: {
            type: String,
            required: [true, 'Password is required'],
            minlength: [8, 'Password must be at least 8 characters'],
            select: false, // never returned by default
        },
        avatar: { type: AvatarSchema, default: () => ({}) },
        bio: {
            type: String,
            default: '',
            maxlength: [200, 'Bio cannot exceed 200 characters'],
            trim: true,
        },
        phone: {
            type: String,
            default: null,
            trim: true,
        },

        // Role & status
        role: {
            type: String,
            enum: Object.values(USER_ROLES),
            default: USER_ROLES.USER,
        },
        status: {
            type: String,
            enum: Object.values(USER_STATUS),
            default: USER_STATUS.OFFLINE,
        },
        statusMessage: {
            type: String,
            default: '',
            maxlength: 100,
        },
        lastSeen: { type: Date, default: Date.now },

        // Presence tracking
        socketIds: {
            type: [String],
            default: [],
            select: false,
        },

        // Email verification
        isEmailVerified: { type: Boolean, default: false },
        emailVerificationToken: { type: String, select: false },
        emailVerificationExpires: { type: Date, select: false },

        // Password reset
        resetPasswordToken: { type: String, select: false },
        resetPasswordExpires: { type: Date, select: false },

        // Password change tracking
        passwordChangedAt: { type: Date, default: null },

        // Security
        failedLoginAttempts: { type: Number, default: 0, select: false },
        lockedUntil: { type: Date, default: null, select: false },

        // Relationships
        blockedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
        mutedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],

        // Settings
        settings: { type: SettingsSchema, default: () => ({}) },

        // Soft delete
        isDeleted: { type: Boolean, default: false, select: false },
        deletedAt: { type: Date, default: null, select: false },
    },
    baseSchemaOptions
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// Search (text index on name/username/email)
UserSchema.index({ name: 'text', username: 'text', email: 'text' }, { name: 'user_text_search' });

// Presence queries
UserSchema.index({ status: 1, lastSeen: -1 }, { name: 'user_status_lastseen' });

// Active users only (partial index)
UserSchema.index(
    { isDeleted: 1 },
    { name: 'user_active', partialFilterExpression: { isDeleted: false } }
);

// ---------------------------------------------------------------------------
// Virtuals
// ---------------------------------------------------------------------------

UserSchema.virtual('initials').get(function () {
    if (!this.name) return '';
    return this.name
        .split(' ')
        .map((p) => p.charAt(0).toUpperCase())
        .slice(0, 2)
        .join('');
});

UserSchema.virtual('isOnline').get(function () {
    return this.status === USER_STATUS.ONLINE;
});

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Hash password before save (only if modified)
UserSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();

    try {
        const rounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);
        const salt = await bcrypt.genSalt(rounds);
        this.password = await bcrypt.hash(this.password, salt);

        // Set passwordChangedAt (except on first creation)
        if (!this.isNew) {
            // Subtract 1s to avoid race condition with token issuance
            this.passwordChangedAt = new Date();
        }
        next();
    } catch (err) {
        next(err);
    }
});

// Filter out soft-deleted users from all find queries by default
UserSchema.pre(/^find/, function (next) {
    // Only add filter if not explicitly bypassed via `.setOptions({ includeDeleted: true })`
    if (!this.getOptions().includeDeleted) {
        this.where({ isDeleted: { $ne: true } });
    }
    next();
});

// ---------------------------------------------------------------------------
// Instance methods
// ---------------------------------------------------------------------------

/**
 * Compare a plaintext password against the stored hash.
 * Requires the document to have been fetched with `.select('+password')`.
 */
UserSchema.methods.comparePassword = async function (candidate) {
    if (!this.password) throw new Error('Password not loaded on this document');
    return bcrypt.compare(candidate, this.password);
};

/**
 * Check if password was changed after a given JWT was issued.
 * @param {number} jwtIssuedAt - Unix timestamp (seconds)
 */
UserSchema.methods.passwordChangedAfter = function (jwtIssuedAt) {
    if (!this.passwordChangedAt) return false;
    const changedAt = Math.floor(this.passwordChangedAt.getTime() / 1000);
    return changedAt > jwtIssuedAt;
};

/**
 * Soft-delete a user: anonymize PII, mark as deleted.
 */
UserSchema.methods.softDelete = async function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    this.status = USER_STATUS.OFFLINE;
    this.name = 'Deleted User';

    // Anonymize identifiers while keeping them unique and within maxlength.
    // Use last 12 chars of the ObjectId + short prefix.
    const shortId = this._id.toString().slice(-12); // 12 chars

    // username: "deleted_" (8) + shortId (12) = 20 chars  → under 30 ✓
    this.username = `deleted_${shortId}`;

    // email: needs to remain unique + match email regex.
    // "deleted_" (8) + shortId (12) + "@deleted.local" (14) = 34 chars → no max on email ✓
    this.email = `deleted_${shortId}@deleted.local`;

    // Clear PII
    this.avatar = { url: null, publicId: null };
    this.bio = '';
    this.phone = null;
    this.statusMessage = '';
    this.socketIds = [];
    this.blockedUsers = [];
    this.mutedUsers = [];

    // Ensure validators run (username maxlength = 30)
    return this.save({ validateBeforeSave: true });
};

/**
 * Track a socket connection (multi-tab support).
 */
UserSchema.methods.addSocket = async function (socketId) {
    if (!this.socketIds.includes(socketId)) {
        this.socketIds.push(socketId);
    }
    this.status = USER_STATUS.ONLINE;
    this.lastSeen = new Date();
    return this.save();
};

/**
 * Remove a socket connection; go offline if none remain.
 */
UserSchema.methods.removeSocket = async function (socketId) {
    this.socketIds = this.socketIds.filter((id) => id !== socketId);
    if (this.socketIds.length === 0) {
        this.status = USER_STATUS.OFFLINE;
        this.lastSeen = new Date();
    }
    return this.save();
};

// ---------------------------------------------------------------------------
// Static methods
// ---------------------------------------------------------------------------

UserSchema.statics.findByEmail = function (email, withPassword = false) {
    const query = this.findOne({ email: email.toLowerCase() });
    if (withPassword) query.select('+password');
    return query;
};

UserSchema.statics.findByUsername = function (username) {
    return this.findOne({ username: username.toLowerCase() });
};

module.exports = mongoose.model('User', UserSchema);