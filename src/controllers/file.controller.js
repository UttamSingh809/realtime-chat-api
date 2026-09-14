/**
 * File controller — thin HTTP layer.
 */

'use strict';

const { FileService } = require('../services/file.service');
const asyncHandler = require('../utils/helpers/asyncHandler');
const { BadRequestError } = require('../utils/exceptions');

const FileController = {
    upload: asyncHandler(async (req, res) => {
        const attachment = await FileService.uploadOne(req.user.id, req.file);
        res.status(201).json({ success: true, data: { file: attachment } });
    }),

    uploadMultiple: asyncHandler(async (req, res) => {
        const files = await FileService.uploadMany(req.user.id, req.files);
        res.status(201).json({ success: true, data: { files } });
    }),

    remove: asyncHandler(async (req, res) => {
        // Express gives us `:publicId` from the path; it may contain encoded slashes
        const publicId = req.params[0] || req.params.publicId;
        const result = await FileService.remove(req.user.id, publicId);
        res.status(200).json({ success: true, data: result });
    }),

    config: asyncHandler(async (req, res) => {
        const config = FileService.getConfig();
        res.status(200).json({ success: true, data: config });
    }),
};

module.exports = FileController;