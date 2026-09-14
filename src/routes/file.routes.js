/**
 * File routes.
 *
 * Order matters: /config and /upload-multiple must come before the wildcard
 * delete route, or they'll be interpreted as publicId segments.
 */

'use strict';

const express = require('express');
const FileController = require('../controllers/file.controller');
const { requireAuth } = require('../middleware/auth');
const { uploadSingle, uploadMultiple } = require('../middleware/upload');
const { authLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Static
// ---------------------------------------------------------------------------
router.get('/config', FileController.config);

// ---------------------------------------------------------------------------
// Uploads (rate-limited like auth — uploads are expensive)
// ---------------------------------------------------------------------------
router.post('/upload', authLimiter, uploadSingle, FileController.upload);
router.post('/upload-multiple', authLimiter, uploadMultiple, FileController.uploadMultiple);

// ---------------------------------------------------------------------------
// Delete (catch-all with wildcard to support `userId/2024/10/uuid.ext`)
// ---------------------------------------------------------------------------
router.delete('/*', FileController.remove);

module.exports = router;