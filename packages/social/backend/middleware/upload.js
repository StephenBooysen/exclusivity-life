'use strict';

/**
 * @fileoverview Multipart upload handling.
 *
 * Memory storage on purpose: nothing untrusted is written to disk before
 * mediaService has re-encoded it. The MIME check here is a cheap first pass —
 * the real check is sharp failing to decode the buffer.
 */

const multer = require('multer');
const config = require('../config');
const { ValidationError } = require('../errors');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.media.maxUploadBytes,
    files: 1,
    fields: 10
  },
  fileFilter(req, file, cb) {
    if (!config.media.acceptedMime.includes(file.mimetype)) {
      return cb(new ValidationError('That image format is not supported'));
    }
    return cb(null, true);
  }
});

/** Wraps multer so its own errors arrive as typed domain errors. */
function singleImage(field = 'photo') {
  const handler = upload.single(field);
  return (req, res, next) => handler(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new ValidationError('That image is too large'));
    }
    if (err instanceof ValidationError) return next(err);
    return next(new ValidationError(err.message || 'Upload failed'));
  });
}

module.exports = { singleImage };
