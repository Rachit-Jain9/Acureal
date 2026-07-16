const multer = require('multer');
const path = require('path');
// One allow-list for the whole product — the same registry the direct-upload
// presign path and the frontend's file picker read (constants/documentFormats).
const { ALLOWED_EXTENSIONS, isAllowedExtension } = require('../constants/documentFormats');

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 50;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

const storage = multer.memoryStorage();

// Extension-only, matching the direct-upload path. The old filter also required
// a MIME match, which rejected legitimate files the OS types poorly or not at
// all (Windows reports an empty type for .csv, .kml, .geojson) — and it bought
// nothing: the client controls the declared MIME, so it is not a security
// signal. The stored content-type is derived server-side from the extension
// (document.service#confirmDirectUpload), never from the client's claim.
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (isAllowedExtension(ext)) {
    cb(null, true);
  } else {
    cb(
      new multer.MulterError(
        'LIMIT_UNEXPECTED_FILE',
        `File type not allowed. Allowed types: ${ALLOWED_EXTENSIONS.join(', ')}`
      ),
      false
    );
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 5,
  },
  fileFilter,
});

const uploadSingle = (fieldName = 'file') => (req, res, next) => {
  upload.single(fieldName)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          message: `File too large. Maximum allowed size is ${MAX_FILE_SIZE_MB}MB.`,
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || 'File upload error.',
      });
    }
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || 'File upload error.',
      });
    }
    next();
  });
};

const uploadMultiple = (fieldName = 'files', maxCount = 5) => (req, res, next) => {
  upload.array(fieldName, maxCount)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          message: `File too large. Maximum allowed size is ${MAX_FILE_SIZE_MB}MB.`,
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || 'File upload error.',
      });
    }
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || 'File upload error.',
      });
    }
    next();
  });
};

module.exports = { upload, uploadSingle, uploadMultiple };
