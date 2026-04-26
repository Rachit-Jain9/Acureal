const log = require('../lib/logger').child({ module: 'http.error' });

const errorHandler = (err, req, res, next) => {
  // Body is intentionally omitted from logs — request bodies on REDIP routes
  // routinely contain financial assumptions, RERA numbers, and ownership PII.
  // The request id + path + method + status are enough to trace; the body lives
  // on the client and the snapshot tables.
  log.error('request_failed', err, {
    method: req.method,
    path: req.originalUrl || req.url,
    user_id: req.user?.id || null,
    pg_code: err.code || null,
    status_code: err.statusCode || err.status || 500,
  });

  // PostgreSQL errors
  if (err.code) {
    switch (err.code) {
      case '23505': // unique_violation
        return res.status(409).json({
          success: false,
          message: 'A record with this information already exists.',
          field: err.detail ? extractFieldFromDetail(err.detail) : undefined,
        });
      case '23503': // foreign_key_violation
        return res.status(400).json({
          success: false,
          message: 'Referenced record does not exist.',
        });
      case '23502': // not_null_violation
        return res.status(400).json({
          success: false,
          message: `Required field missing: ${err.column || 'unknown'}`,
        });
      case '22001': // string_data_right_truncation
        return res.status(400).json({
          success: false,
          message: 'Input value is too long for the field.',
        });
      case '22P02': // invalid_text_representation (bad UUID etc)
        return res.status(400).json({
          success: false,
          message: 'Invalid data format provided.',
        });
      case '42703': // undefined_column
        return res.status(400).json({
          success: false,
          message: 'Invalid field name in request.',
        });
    }
  }

  // JWT errors (should be caught in auth middleware, but just in case)
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid authentication token.',
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Authentication token has expired.',
    });
  }

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: `File too large. Maximum size is ${parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 50}MB.`,
    });
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      success: false,
      message: 'Unexpected file field.',
    });
  }

  // Custom application errors
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.errors && { errors: err.errors }),
    });
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  // Default server error
  const statusCode = err.status || 500;
  return res.status(statusCode).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'An internal server error occurred.'
      : err.message || 'An internal server error occurred.',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

const extractFieldFromDetail = (detail) => {
  const match = detail.match(/Key \((\w+)\)/);
  return match ? match[1] : undefined;
};

const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.url}`,
  });
};

const createError = (message, statusCode = 500, errors = null) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (errors) error.errors = errors;
  return error;
};

module.exports = { errorHandler, notFoundHandler, createError };
