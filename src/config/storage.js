/**
 * Storage configuration — chooses between local and cloudinary.
 *
 * Every adapter exposes:
 *   upload(buffer, { key, mimeType, originalName }) → { url, publicId, size, path? }
 *   remove(publicId) → { removed: boolean }
 *   buildThumbnail(buffer) → Buffer | null
 *   buildThumbnailUrl(publicId) → string | null
 */

'use strict';

const fs = require('fs/promises');
const path = require('path');
const logger = require('./logger');
const { BadRequestError } = require('../utils/exceptions');

const PROVIDER = process.env.UPLOAD_PROVIDER || 'local';
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const STATIC_PREFIX = process.env.STATIC_UPLOADS_PREFIX || '/static/uploads';
const THUMB_SIZE = parseInt(process.env.THUMBNAIL_SIZE || '200', 10);

let _sharp = null;
function sharp() {
    if (_sharp) return _sharp;
    _sharp = require('sharp');
    return _sharp;
}

// ---------------------------------------------------------------------------
// Local adapter
// ---------------------------------------------------------------------------

const localAdapter = {
    name: 'local',

    async ensureDir() {
        await fs.mkdir(path.join(process.cwd(), UPLOAD_DIR), { recursive: true });
    },

    async upload(buffer, { key }) {
        await this.ensureDir();
        const fullPath = path.join(process.cwd(), UPLOAD_DIR, key);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, buffer);
        const url = `${STATIC_PREFIX}/${key}`.replace(/\\/g, '/');
        return {
            url,
            publicId: key,
            size: buffer.length,
        };
    },

    async uploadThumbnail(buffer, { key }) {
        try {
            const thumbBuffer = await sharp()(buffer)
                .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
                .webp({ quality: 80 })
                .toBuffer();

            // Replace extension with _thumb.webp
            const thumbKey = key.replace(/\.[^.]+$/, '') + '_thumb.webp';
            const fullPath = path.join(process.cwd(), UPLOAD_DIR, thumbKey);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, thumbBuffer);
            return {
                url: `${STATIC_PREFIX}/${thumbKey}`.replace(/\\/g, '/'),
                publicId: thumbKey,
                size: thumbBuffer.length,
            };
        } catch (err) {
            logger.warn(`Thumbnail generation failed: ${err.message}`);
            return null;
        }
    },

    async remove(publicId) {
        try {
            const fullPath = path.join(process.cwd(), UPLOAD_DIR, publicId);
            await fs.unlink(fullPath);
            // Best-effort delete the thumbnail too
            const thumbKey = publicId.replace(/\.[^.]+$/, '') + '_thumb.webp';
            await fs.unlink(path.join(process.cwd(), UPLOAD_DIR, thumbKey)).catch(() => { });
            return { removed: true };
        } catch (err) {
            if (err.code === 'ENOENT') return { removed: false };
            logger.error(`Local remove failed: ${err.message}`);
            return { removed: false };
        }
    },
};

// ---------------------------------------------------------------------------
// Cloudinary adapter
// ---------------------------------------------------------------------------

const cloudinaryAdapter = {
    name: 'cloudinary',

    _client() {
        const { cloudinary, isConfigured } = require('./cloudinary');
        if (!isConfigured()) {
            throw new BadRequestError('Cloudinary is not configured', 'UPLOAD_NOT_CONFIGURED');
        }
        return cloudinary;
    },

    async upload(buffer, { key, mimeType, originalName }) {
        const c = this._client();
        const folder = process.env.CLOUDINARY_FOLDER || 'realtime-chat';

        return new Promise((resolve, reject) => {
            const stream = c.uploader.upload_stream(
                {
                    folder,
                    public_id: key.replace(/\.[^.]+$/, ''), // Cloudinary manages ext
                    resource_type: 'auto',
                    filename_override: originalName,
                },
                (err, result) => {
                    if (err) return reject(err);
                    resolve({
                        url: result.secure_url,
                        publicId: result.public_id,
                        size: result.bytes,
                    });
                }
            );
            stream.end(buffer);
        });
    },

    async buildThumbnailUrl(publicId) {
        const c = this._client();
        return c.url(publicId, {
            width: THUMB_SIZE,
            height: THUMB_SIZE,
            crop: 'fill',
            quality: 80,
            fetch_format: 'webp',
            secure: true,
        });
    },

    async remove(publicId) {
        const c = this._client();
        try {
            const result = await c.uploader.destroy(publicId);
            return { removed: result.result === 'ok' };
        } catch (err) {
            logger.error(`Cloudinary remove failed: ${err.message}`);
            return { removed: false };
        }
    },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function getStorage() {
    if (PROVIDER === 'cloudinary') return cloudinaryAdapter;
    return localAdapter;
}

module.exports = {
    getStorage,
    PROVIDER,
    UPLOAD_DIR,
    STATIC_PREFIX,
    THUMB_SIZE,
};