/**
 * RefreshToken model.
 *
 * One document per issued refresh token. Supports rotation (revoke old, issue new)
 * and tracking of device/session metadata.
 *
 * Indexes:
 *   - token: unique lookup
 *   - userId + revoked: list user's active sessions
 *   - expiresAt: TTL index for auto-cleanup
 */

'use strict';

const mongoose = require('mongoose');
const { baseSchemaOptions } = require('../utils/helpers/schemaHelpers');

const { Schema } = mongoose;

const RefreshTokenSchema = new Schema(
    {
        token: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        expiresAt: {
            type: Date,
            required: true,
        },
        revoked: { type: Boolean, default: false },
        revokedAt: { type: Date, default: null },
        replacedByToken: { type: String, default: null },

        // Session metadata
        userAgent: { type: String, default: null },
        ip: { type: String, default: null },
        device: { type: String, default: null },
    },
    baseSchemaOptions
);

// TTL index: Mongo auto-removes expired tokens
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'refresh_ttl' });

// Active tokens per user
RefreshTokenSchema.index(
    { userId: 1, revoked: 1 },
    { name: 'refresh_user_active' }
);

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

RefreshTokenSchema.methods.revoke = function (replacedBy = null) {
    this.revoked = true;
    this.revokedAt = new Date();
    if (replacedBy) this.replacedByToken = replacedBy;
    return this.save();
};

RefreshTokenSchema.methods.isActive = function () {
    return !this.revoked && this.expiresAt > new Date();
};

// ---------------------------------------------------------------------------
// Statics
// ---------------------------------------------------------------------------

RefreshTokenSchema.statics.revokeAllForUser = function (userId) {
    return this.updateMany(
        { userId, revoked: false },
        { $set: { revoked: true, revokedAt: new Date() } }
    );
};

module.exports = mongoose.model('RefreshToken', RefreshTokenSchema);