/**
 * FileService — upload, validate, thumbnail, delete.
 * Provider-agnostic: works with local and cloudinary via config/storage.
 */

'use strict';

const path = require('path');
const { getStorage } = require('../config/storage');
const {
    validateFile,
    buildObjectKey,
    mimeToAttachmentType,
    isImageMime,
    sanitizeName,
} = require('../utils/helpers/file');
const { BadRequestError, ForbiddenError, ValidationError } = require('../utils/exceptions');

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '10485760', 10);

/**
 * Serialize a stored file into the attachments shape.
 */
function buildAttachmentPayload({
    storageResult,
    thumbResult,
    thumbUrl,
    originalName,
    mimeType,
    buffer,
}) {
    return {
        url: storageResult.url,
        publicId: storageResult.publicId,
        type: mimeToAttachmentType(mimeType),
        mimeType,
        size: storageResult.size ?? (buffer ? buffer.length : 0),
        name: sanitizeName(originalName),
        thumbnail: thumbResult?.url || thumbUrl || null,
        width: null,   // filled below for images when sharp can read dims
        height: null,
        duration: null,
    };
}

class FileService {
    /**
     * Upload a single file.
     * @param {string} userId
     * @param {object} file — multer file
     */
    static async uploadOne(userId, file) {
        if (!file) {
            throw new ValidationError('No file provided', [
                { path: 'file', message: 'File is required' },
            ]);
        }

        const { ext, attachmentType } = validateFile(file, MAX_FILE_SIZE);
        const key = buildObjectKey(userId, ext);
        const storage = getStorage();

        const storageResult = await storage.upload(file.buffer, {
            key,
            mimeType: file.mimetype,
            originalName: file.originalname,
        });

        let thumbResult = null;
        let thumbUrl = null;
        let width = null;
        let height = null;

        if (isImageMime(file.mimetype)) {
            if (storage.name === 'local') {
                thumbResult = await storage.uploadThumbnail(file.buffer, { key });
            } else if (storage.buildThumbnailUrl) {
                thumbUrl = await storage.buildThumbnailUrl(storageResult.publicId);
            }

            // Read dims with sharp
            try {
                const sharp = require('sharp');
                const meta = await sharp(file.buffer).metadata();
                width = meta.width || null;
                height = meta.height || null;
            } catch (err) {
                // Not fatal — dims are nice-to-have
            }
        }

        const payload = buildAttachmentPayload({
            storageResult,
            thumbResult,
            thumbUrl,
            originalName: file.originalname,
            mimeType: file.mimetype,
            buffer: file.buffer,
        });
        payload.width = width;
        payload.height = height;

        return payload;
    }

    /**
     * Upload multiple files (up to 10).
     */
    static async uploadMany(userId, files) {
        if (!files || files.length === 0) {
            throw new ValidationError('No files provided', [
                { path: 'files', message: 'At least one file is required' },
            ]);
        }
        if (files.length > 10) {
            throw new ValidationError('Maximum 10 files per request', [
                { path: 'files', message: 'Too many files' },
            ]);
        }
        // Sequential to avoid hammering cloudinary / disk IO
        const results = [];
        for (const f of files) {
            results.push(await this.uploadOne(userId, f));
        }
        return results;
    }

    /**
     * Delete a file. Authorization: the publicId must be namespaced under
     * the caller's userId (we generate keys as "<userId>/...").
     */
    static async remove(userId, publicId) {
        if (!publicId || typeof publicId !== 'string') {
            throw new BadRequestError('Invalid publicId', 'INVALID_PUBLIC_ID');
        }

        // Decode URL-encoded slashes from Express params
        const decoded = decodeURIComponent(publicId);

        const prefix = `${userId}/`;
        const cloudinaryFolder = process.env.CLOUDINARY_FOLDER || 'realtime-chat';
        const cloudinaryPrefix = `${cloudinaryFolder}/${userId}/`;

        const ownsIt =
            decoded.startsWith(prefix) ||
            decoded.startsWith(cloudinaryPrefix);
        if (!ownsIt) {
            throw new ForbiddenError('You do not own this file', 'NOT_OWNER');
        }

        const storage = getStorage();
        return storage.remove(decoded);
    }

    /**
     * Small config descriptor for clients.
     */
    static getConfig() {
        const storage = getStorage();
        return {
            provider: storage.name,
            maxFileSize: MAX_FILE_SIZE,
            allowedExtensions: require('../config/constants').ALLOWED_EXTENSIONS,
            allowedMimeTypes: require('../config/constants').ALLOWED_MIME_TYPES,
            staticPrefix: process.env.STATIC_UPLOADS_PREFIX || '/static/uploads',
        };
    }
}

module.exports = { FileService };