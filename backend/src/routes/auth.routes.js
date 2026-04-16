const express = require('express');
const { body } = require('express-validator');
const authService = require('../services/auth.service');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

const router = express.Router();

// POST /auth/register
router.post(
  '/register',
  [
    body(['name', 'fullName']).optional().trim().isLength({ max: 255 }),
    body().custom((value) => {
      const resolvedName = value?.name || value?.fullName;
      if (!resolvedName || !String(resolvedName).trim()) {
        throw new Error('Name is required');
      }
      return true;
    }),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain uppercase, lowercase and a number'),
    body('role').optional().isIn(['admin', 'analyst', 'viewer']).withMessage('Invalid role'),
    body('phone').optional().trim(),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { email, password, role, phone } = req.body;
      const name = req.body.name || req.body.fullName;
      const result = await authService.register(name, email, password, role, phone);
      res.status(201).json({
        success: true,
        message: 'Account created successfully.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /auth/login
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password);
      res.json({
        success: true,
        message: 'Login successful.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await authService.getUserById(req.user.id);
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

// PUT /auth/me
router.put(
  '/me',
  authenticate,
  [
    body(['name', 'fullName']).optional().trim().notEmpty().isLength({ max: 255 }),
    body('phone').optional().trim(),
    body('currentPassword').optional().isLength({ min: 8 }),
    body('newPassword')
      .optional()
      .isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('New password must contain uppercase, lowercase and a number'),
  ],
  handleValidation,
  async (req, res, next) => {
    try {
      const payload = {
        ...req.body,
        name: req.body.name || req.body.fullName,
      };
      const updated = await authService.updateUser(req.user.id, payload);
      res.json({ success: true, message: 'Profile updated.', data: updated });
    } catch (error) {
      next(error);
    }
  }
);

// GET /auth/users (admin only)
router.get('/users', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const users = await authService.listUsers();
    res.json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
});

// PATCH /auth/users/:id/status (admin only)
router.patch('/users/:id/status', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isActive must be a boolean.' });
    }
    const user = await authService.toggleUserStatus(req.params.id, isActive, req.user.id);
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
