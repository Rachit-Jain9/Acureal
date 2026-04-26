const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../services/auth.service');
const { hydrateUserAuthContext } = require('../services/organization.service');
const { roleSatisfies } = require('../constants/roles');
const { setRequestContext } = require('../lib/requestContext');
const log = require('../lib/logger').child({ module: 'auth' });

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please provide a valid token.',
      });
    }

    const token = authHeader.substring(7);

    let decoded;
    try {
      decoded = jwt.verify(token, getJwtSecret());
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expired. Please login again.',
          code: 'TOKEN_EXPIRED',
        });
      }

      return res.status(401).json({
        success: false,
        message: 'Invalid token.',
        code: 'INVALID_TOKEN',
      });
    }

    const authContext = await hydrateUserAuthContext(decoded.userId, req.header('x-organization-id'));
    req.user = authContext.user;
    setRequestContext({
      userId: authContext.user.id,
      organizationId: authContext.user.organization_id,
      role: authContext.user.role,
    });
    next();
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    log.error('auth_middleware_failed', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication service error.',
    });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
    });
  }

  if (!roleSatisfies(req.user.role, roles)) {
    return res.status(403).json({
      success: false,
      message: `Access denied. Required role: ${roles.join(' or ')}. Your role: ${req.user.role}`,
    });
  }

  next();
};

const requireAdminOrAnalyst = requireRole('admin', 'analyst');
const requireAdmin = requireRole('admin');

module.exports = {
  authenticate,
  requireRole,
  requireAdminOrAnalyst,
  requireAdmin,
};
