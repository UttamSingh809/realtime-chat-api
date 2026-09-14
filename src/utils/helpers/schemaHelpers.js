/**
 * Shared Mongoose schema options and helpers.
 */

'use strict';

/**
 * Standard toJSON transform for all schemas.
 * - Removes sensitive/internal fields
 * - Converts _id -> id
 * - Removes __v
 */
function toJSONTransform(doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;

    // Always strip sensitive fields
    delete ret.password;
    delete ret.emailVerificationToken;
    delete ret.resetPasswordToken;
    delete ret.resetPasswordExpires;

    return ret;
}

/**
 * Base schema options reused everywhere.
 */
const baseSchemaOptions = {
    timestamps: true,
    toJSON: {
        virtuals: true,
        transform: toJSONTransform,
    },
    toObject: {
        virtuals: true,
        transform: toJSONTransform,
    },
};

module.exports = { toJSONTransform, baseSchemaOptions };