/**
 * Multer configuration with wrapped error handling.
 */

'use strict';

const multer = require('multer');
const { ALLOWED_MIME_TYPES } = require('../config/constants');
const { ValidationError } = require('../utils/exceptions');

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '10485760', 10);

function makeFilter() {
    return (req, file, cb) => {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            return cb(
                new ValidationError(`File type "${file.mimetype}" is not allowed`, [
                    { path: 'file', message: 'Unsupported MIME type' },
                ])
            );
        }
        cb(null, true);
    };
}

const storage = multer.memoryStorage();

const _single = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE, files: 1 },
    fileFilter: makeFilter(),
}).single('file');

const _multiple = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE, files: 10 },
    fileFilter: makeFilter(),
}).array('files', 10);

function wrapMulter(mw) {
    return (req, res, next) => {
        mw(req, res, (err) => {
            if (!err) return next();
            if (err.name === 'MulterError') {
                const details = [{ path: err.field || 'file', message: err.message }];
                const ve = new ValidationError(err.message || 'Upload failed', details);
                ve.code = err.code || 'UPLOAD_ERROR';
                return next(ve);
            }
            return next(err);
        });
    };
}

const uploadSingle = wrapMulter(_single);
const uploadMultiple = wrapMulter(_multiple);

module.exports = { uploadSingle, uploadMultiple, MAX_FILE_SIZE };