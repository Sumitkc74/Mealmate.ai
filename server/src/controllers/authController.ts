import type { Request, Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { User } from '../models/User';
import { MealPlan } from '../models/MealPlan';
import { GroceryList } from '../models/GroceryList';
import { Recipe, COMMUNITY_OWNER_ID } from '../models/Recipe';
import { AppError } from '../utils/AppError';
import { signAccessToken } from '../utils/jwt';
import { setAuthCookie, clearAuthCookie } from '../utils/authCookie';
import { asyncHandler } from '../utils/asyncHandler';
import { frontendBaseUrl, isMailConfigured, sendPasswordResetEmail } from '../services/mailer';
import type {
  RegisterInput,
  LoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  UpdateProfileInput,
} from '../validators/authSchemas';

export const register = asyncHandler<unknown, unknown, RegisterInput>(async (req, res) => {
  const { name, email, password, termsAccepted, dietaryConsent, marketingOptIn } = req.body;

  const existing = await User.findOne({ email });
  // Do not reveal whether the email is registered: the message is generic
  // and the client shows it as a form error (sign-in hint), so an attacker
  // cannot use registration to confirm an email exists.
  if (existing) {
    throw AppError.conflict('Unable to create an account with these details. If you already have an account, please sign in instead.');
  }

  const user = await User.create({
    name,
    email,
    password,
    termsAcceptedAt: termsAccepted ? new Date() : undefined,
    dietaryConsentAt: dietaryConsent ? new Date() : undefined,
    marketingOptIn: Boolean(marketingOptIn),
  });
  const token = signAccessToken({ sub: String(user._id), role: user.role, tokenVersion: user.tokenVersion ?? 0 });

  // The JWT goes in an httpOnly cookie (never in the response body), so
  // JavaScript cannot read it. The client stores only the user profile.
  setAuthCookie(res, token);
  res.status(201).json({
    success: true,
    // Return the full profile (pantry, preferences, allergies): the client
    // keeps this user in its store, and pages that read user.pantry directly
    // would otherwise crash on the missing field after sign-up.
    user: user.toJSON(),
  });
});

/** Failed logins before the account locks, and how long the lock lasts. */
const MAX_FAILED_LOGINS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export const login = asyncHandler<unknown, unknown, LoginInput>(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+password +failedLoginAttempts +lockUntil');
  if (!user) {
    // Same generic message as a wrong password: never reveal whether the
    // email is registered.
    throw AppError.unauthorized('Invalid email or password');
  }

  // Per-account lockout (on top of the per-IP authLimiter): after too many
  // failed attempts the account is locked for a while, which stops
  // credential spraying against a known email even from many IPs.
  if (user.lockUntil && user.lockUntil.getTime() > Date.now()) {
    throw AppError.unauthorized('Account temporarily locked after too many failed sign-in attempts. Please try again later.');
  }

  const passwordOk = await user.comparePassword(password);
  if (!passwordOk) {
    const attempts = (user.failedLoginAttempts ?? 0) + 1;
    user.failedLoginAttempts = attempts;
    if (attempts >= MAX_FAILED_LOGINS) {
      user.lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
      user.failedLoginAttempts = 0;
    }
    await user.save();
    throw AppError.unauthorized('Invalid email or password');
  }

  // Successful login clears any failed-attempt count and lock.
  if (user.failedLoginAttempts || user.lockUntil) {
    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();
  }

  const token = signAccessToken({ sub: String(user._id), role: user.role, tokenVersion: user.tokenVersion ?? 0 });
  // httpOnly cookie (see register): the token is never returned in the body.
  setAuthCookie(res, token);
  res.json({
    success: true,
    // Full profile, same reason as register: the client stores this user and
    // reads user.pantry / preferences from it.
    user: user.toJSON(),
  });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw AppError.unauthorized();
  const user = await User.findById(req.user.sub);
  if (!user) throw AppError.notFound('User not found');
  res.json({ success: true, user: user.toJSON() });
});

/** Clear the httpOnly auth cookie. The client also clears its local state. */
export const logout = asyncHandler(async (_req: Request, res: Response) => {
  clearAuthCookie(res);
  res.json({ success: true, message: 'Signed out' });
});

export const updateProfile = asyncHandler<unknown, unknown, UpdateProfileInput>(
  async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const user = await User.findById(req.user.sub);
    if (!user) throw AppError.notFound('User not found');

    const { name, pantry, cookingHistory, dietaryPreferences, allergies, marketingOptIn, dietaryConsent } = req.body;
    if (name !== undefined) user.name = name;
    if (pantry !== undefined) {
      user.pantry = pantry.map((p) => ({
        ingredient: p.ingredient,
        quantity: p.quantity,
        unit: p.unit,
        addedAt: new Date(),
        expiresAt: p.expiresAt ? new Date(p.expiresAt) : undefined,
        category: p.category,
      }));
    }
    if (cookingHistory !== undefined) {
      user.cookingHistory = cookingHistory.map((c) => ({
        recipeId: c.recipeId,
        recipeTitle: c.recipeTitle,
        cookedAt: c.cookedAt ? new Date(c.cookedAt) : new Date(),
        servingsCooked: c.servingsCooked,
        rating: c.rating,
        notes: c.notes,
      }));
    }
    if (dietaryPreferences !== undefined) user.dietaryPreferences = dietaryPreferences;
    if (allergies !== undefined) user.allergies = allergies;
    if (marketingOptIn !== undefined) user.marketingOptIn = marketingOptIn;
    if (dietaryConsent !== undefined) {
      user.dietaryConsentAt = dietaryConsent ? new Date() : undefined;
    }
    await user.save();

    res.json({ success: true, user: user.toJSON() });
  }
);

/**
 * GDPR / CCPA Data Portability: export all user personal data in a structured JSON bundle.
 */
export const exportData = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw AppError.unauthorized();
  const userId = req.user.sub;

  const [user, mealPlans, groceryLists, authoredRecipes] = await Promise.all([
    User.findById(userId),
    MealPlan.find({ user: userId }).lean(),
    GroceryList.find({ user: userId }).lean(),
    Recipe.find({ createdBy: userId }).lean(),
  ]);

  if (!user) throw AppError.notFound('User not found');

  const exportPayload = {
    exportDate: new Date().toISOString(),
    legalNotice: 'MealMate GDPR / CCPA Data Portability Archive',
    user: user.toJSON(),
    mealPlans,
    groceryLists,
    authoredRecipes,
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="mealmate-data-export-${new Date().toISOString().slice(0, 10)}.json"`
  );
  res.json({ success: true, ...exportPayload });
});

/**
 * GDPR / CCPA Right to Erasure / Right to be Forgotten:
 * Deletes the user profile, personal meal plans, and grocery lists, and
 * clears the auth cookie. Recipes follow the user's choice, read from the
 * request body: by default they stay in the shared library, reassigned to
 * the community owner; when `deleteRecipes` is true they are deleted with
 * the account instead.
 */
export const deleteAccount = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw AppError.unauthorized();
  const userId = req.user.sub;
  const deleteRecipes =
    (req.body as { deleteRecipes?: boolean } | undefined)?.deleteRecipes === true;

  const user = await User.findById(userId);
  if (!user) throw AppError.notFound('User not found');

  // Delete personal data. Recipes follow the user's choice: delete them, or
  // keep them in the shared library reassigned to the community owner so the
  // library does not lose recipes when someone leaves. A signed-in user who
  // edits a community recipe becomes its new owner.
  await Promise.all([
    MealPlan.deleteMany({ user: userId }),
    GroceryList.deleteMany({ user: userId }),
    deleteRecipes
      ? Recipe.deleteMany({ createdBy: userId })
      : Recipe.updateMany({ createdBy: userId }, { $set: { createdBy: COMMUNITY_OWNER_ID } }),
    User.findByIdAndDelete(userId),
  ]);

  // The account is gone; its cookie must not keep authenticating anything.
  clearAuthCookie(res);
  res.json({
    success: true,
    message:
      'Your account and all associated personal data have been permanently deleted in accordance with GDPR / CCPA right to erasure.',
  });
});

/** How long a password-reset link stays valid. */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export const forgotPassword = asyncHandler<unknown, unknown, ForgotPasswordInput>(
  async (req, res) => {
    // Checked before the user lookup so the response cannot reveal whether
    // an email is registered.
    if (!isMailConfigured()) {
      throw new AppError('Password reset is not available right now', 503);
    }

    const { email } = req.body;
    const user = await User.findOne({ email });
    if (user) {
      const token = randomBytes(32).toString('hex');
      user.passwordResetToken = createHash('sha256').update(token).digest('hex');
      user.passwordResetExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await user.save();
      const resetUrl = `${frontendBaseUrl()}/reset-password?token=${token}`;
      await sendPasswordResetEmail(user.email, resetUrl);
    }
    // Always the same answer: never reveal whether the email is registered.
    res.json({
      success: true,
      message: 'If an account exists for that email, a password reset link is on its way.',
    });
  }
);

export const resetPassword = asyncHandler<unknown, unknown, ResetPasswordInput>(
  async (req, res) => {
    const { token, password } = req.body;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      passwordResetToken: tokenHash,
      passwordResetExpires: { $gt: new Date() },
    }).select('+passwordResetToken +passwordResetExpires');
    if (!user) throw AppError.badRequest('Invalid or expired reset link');

    // The pre-save hook hashes the new password; clearing the token fields
    // makes the link single-use. Bumping tokenVersion invalidates every JWT
    // issued before this reset, so a token stolen earlier stops working.
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.save();

    res.json({ success: true, message: 'Password reset. Sign in with your new password.' });
  }
);
