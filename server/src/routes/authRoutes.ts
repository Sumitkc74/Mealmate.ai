import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  register,
  login,
  me,
  updateProfile,
  exportData,
  deleteAccount,
} from '../controllers/authController';
import { validate } from '../middleware/validate';
import { protect } from '../middleware/authMiddleware';
import { registerSchema, loginSchema, updateProfileSchema } from '../validators/authSchemas';

const router = Router();

// Tighter rate limit on auth endpoints to deter brute-force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many auth attempts, please try again later' },
});

router.post('/register', authLimiter, validate({ body: registerSchema }), register);
router.post('/login', authLimiter, validate({ body: loginSchema }), login);
router.get('/me', protect, me);
router.patch('/me', protect, validate({ body: updateProfileSchema }), updateProfile);
router.get('/me/export', protect, exportData);
router.delete('/me', protect, deleteAccount);

export default router;
