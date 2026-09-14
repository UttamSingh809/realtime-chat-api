/**
 * File helpers: validation, naming, type detection.
 */

'use strict';

const path = require('path');
const { v4: uuidv4 } = require('uuid');
const {
    ALLOWED_EXTENSIONS,
    ALLOWED_MIME_TYPES,
    MIME_TO_ATTACHMENT_TYPE,
} = require('../../config/constants');
const { ValidationError } = require('../exceptions');

/**
 * Validate a file's MIME type + extension against the allowlist.
 * Throws ValidationError (422) on any mismatch.
 *
 * @param {{ originalname: string, mimetype: string, size: number }} file
 * @param {number} maxSize — bytes
 */
/**
 * Includes a fallback: if the MIME type is missing/unknown (e.g.,
 * "application/octet-stream"), infer the category from the file extension.
 */
function validateFile(file, maxSize) {
    if (!file) {
        throw new ValidationError('No file provided', [
            { path: 'file', message: 'File is required' },
        ]);
    }

    if (typeof file.size === 'number' && file.size > maxSize) {
        throw new ValidationError(
            `File exceeds maximum size of ${Math.round(maxSize / 1024 / 1024)}MB`,
            [{ path: 'file', message: 'File too large' }]
        );
    }

    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
        throw new ValidationError(
            `File extension "${ext || '(none)'}" is not allowed`,
            [{ path: 'file', message: 'Unsupported file extension' }]
        );
    }

    // Look up MIME → category, with an extension-based fallback for cases
    // where the browser sent a generic MIME (e.g., "application/octet-stream").
    let inferred = MIME_TO_ATTACHMENT_TYPE[file.mimetype];

    if (!inferred) {
        // Fallback: infer from the extension
        const lowerExt = ext.slice(1); // remove leading dot
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(lowerExt)) {
            inferred = 'image';
        } else if (['mp3', 'wav', 'ogg'].includes(lowerExt)) {
            inferred = 'audio';
        } else if (['mp4', 'webm', 'mov'].includes(lowerExt)) {
            inferred = 'video';
        } else if (['pdf', 'doc', 'docx', 'txt'].includes(lowerExt)) {
            inferred = 'file';
        } else {
            throw new ValidationError('Unsupported file type', [
                { path: 'file', message: 'Unsupported file type' },
            ]);
        }
    }

    return { ext, attachmentType: inferred };
}

/**
 * Build a namespaced, collision-proof object key.
 * e.g. "64f.../2024/10/ab12cd34-...-ef.jpg"
 */
function buildObjectKey(userId, ext, folder = '') {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const base = `${uuidv4()}${ext}`;
    const parts = [String(userId), String(year), month, base].filter(Boolean);
    return folder ? `${folder}/${parts.join('/')}` : parts.join('/');
}

/**
 * Determine the attachment type ("image" | "file" | "audio" | "video") from MIME.
 */
function mimeToAttachmentType(mime) {
    return MIME_TO_ATTACHMENT_TYPE[mime] || 'file';
}

/**
 * Return true if the MIME is an image type.
 */
function isImageMime(mime) {
    return MIME_TO_ATTACHMENT_TYPE[mime] === 'image';
}

/**
 * Sanitize a display name (never used as a path).
 */
function sanitizeName(name, fallback = 'file') {
    if (!name || typeof name !== 'string') return fallback;
    return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 255) || fallback;
}

module.exports = {
    validateFile,
    buildObjectKey,
    mimeToAttachmentType,
    isImageMime,
    sanitizeName,
};