/**
 * Cloudinary configuration.
 * Only initialized if UPLOAD_PROVIDER=cloudinary.
 */

'use strict';

const cloudinary = require('cloudinary').v2;
const logger = require('./logger');

let configured = false;

/**
 * Configure Cloudinary SDK.
 */
function configureCloudinary() {
    if (process.env.UPLOAD_PROVIDER !== 'cloudinary') {
        logger.info('Cloudinary disabled (UPLOAD_PROVIDER != cloudinary)');
        return null;
    }

    if (
        !process.env.CLOUDINARY_CLOUD_NAME ||
        !process.env.CLOUDINARY_API_KEY ||
        !process.env.CLOUDINARY_API_SECRET
    ) {
        throw new Error('Cloudinary credentials missing in environment variables');
    }

    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true,
    });

    configured = true;
    logger.info('Cloudinary configured');
    return cloudinary;
}

module.exports = { configureCloudinary, cloudinary, isConfigured: () => configured };