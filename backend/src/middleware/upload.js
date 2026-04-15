const multer = require('multer');
const path = require('path');

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/zip',
  'application/x-zip-compressed',
  'text/csv',
];

const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.zip', '.csv'];

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 50;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const isAllowedMime = ALLOWED_MIME_TYPES.includes(file.mimetype);
  const isAllowedExt = ALLOWED_EXTENSIONS.includes(ext);

  if (isAllowedMime && isAllowedExt) {
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
