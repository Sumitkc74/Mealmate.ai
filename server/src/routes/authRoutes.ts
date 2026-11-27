import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  register,
  login,
  logout,
  forgotPassword,
  resetPassword,
  requestDeletion,
  confirmDeletion,
  approveDeletion,
  me,
  updateProfile,
  exportData,
  deleteAccount,
} from '../controllers/authController';
import { validate } from '../middleware/validate';
import { protect } from '../middleware/authMiddleware';
import { env } from '../config/env';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  requestDeletionSchema,
  deletionTokenSchema,
  updateProfileSchema,
  deleteAccountSchema,
} from '../validators/authSchemas';

const router = Router();

// Tighter rate limit on auth endpoints to deter brute-force. The test
// suite exercises these endpoints heavily from one IP, so the limit is
// relaxed there only; production stays at 20.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many auth attempts, please try again later' },
});

router.post('/register', authLimiter, validate({ body: registerSchema }), register);
router.post('/login', authLimiter, validate({ body: loginSchema }), login);
router.post(
  '/forgot-password',
  authLimiter,
  validate({ body: forgotPasswordSchema }),
  forgotPassword
);
router.post(
  '/reset-password',
  authLimiter,
  validate({ body: resetPasswordSchema }),
  resetPassword
);
// Locked-out deletion requests are public and unauthenticated, so they use
// the same tight auth limiter as the other auth endpoints (and the same
// generic, non-enumerating responses) to deter inbox spam and probing.
router.post(
  '/request-deletion',
  authLimiter,
  validate({ body: requestDeletionSchema }),
  requestDeletion
);
router.post(
  '/confirm-deletion',
  authLimiter,
  validate({ body: deletionTokenSchema }),
  confirmDeletion
);
router.post(
  '/approve-deletion',
  authLimiter,
  validate({ body: deletionTokenSchema }),
  approveDeletion
);
router.post('/logout', logout);
router.get('/me', protect, me);
router.patch('/me', protect, validate({ body: updateProfileSchema }), updateProfile);
router.get('/me/export', protect, exportData);
router.delete('/me', protect, validate({ body: deleteAccountSchema }), deleteAccount);

export default router;
