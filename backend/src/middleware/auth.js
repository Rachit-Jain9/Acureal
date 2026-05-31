const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../services/auth.service');
const { hydrateUserAuthContext } = require('../services/organization.service');
const { roleSatisfies } = require('../constants/roles');
const { setRequestContext } = require('../lib/requestContext');
const { readAccessCookie } = require('../lib/cookies');
const log = require('../lib/logger').child({ module: 'auth' });

// Token sources, in order:
//   1. `redip.access` httpOnly cookie — preferred path going forward.
//   2. `Authorization: Bearer <jwt>` header — kept for back-compat with
//      existing localStorage sessions and for any non-browser API client.
//
// Once the SPA has been on cookies for two release cycles, the header
// path can be retired in a follow-up PR.
const extractAccessToken = (req) => {
  const cookieToken = readAccessCookie(req);
  if (cookieToken) return cookieToken;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.substring(7);
  return null;
};

const authenticate = async (req, res, next) => {
  try {
    const token = extractAccessToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please provide a valid token.',
      });
    }

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

// Verify the request's access token WITHOUT enforcing it (no 401, no DB
// hydration). Returns the decoded JWT payload, or null if absent/invalid.
// For routes that are public by default but gate a subset on a valid session.
const verifyAccessToken = (req) => {
  const token = extractAccessToken(req);
  if (!token) return null;
  try {
    return jwt.verify(token, getJwtSecret());
  } catch (err) {
    return null;
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
  verifyAccessToken,
  requireRole,
  requireAdminOrAnalyst,
  requireAdmin,
};
