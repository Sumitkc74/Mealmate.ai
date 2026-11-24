import type { Request, Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { User } from '../models/User';
import { MealPlan } from '../models/MealPlan';
import { GroceryList } from '../models/GroceryList';
import { Recipe } from '../models/Recipe';
import { DeletionRequest } from '../models/DeletionRequest';
import {
  deleteUserAccount,
  cancelPendingDeletionsForUser,
} from '../services/accountDeletion';
import { AppError } from '../utils/AppError';
import { signAccessToken } from '../utils/jwt';
import { setAuthCookie, clearAuthCookie } from '../utils/authCookie';
import { asyncHandler } from '../utils/asyncHandler';
import {
  frontendBaseUrl,
  isMailConfigured,
  sendPasswordResetEmail,
  ownerInbox,
  sendDeletionConfirmEmail,
  sendDeletionReviewEmail,
  sendDeletionApprovedToRequester,
  sendDeletionApprovedToAccountOwner,
} from '../services/mailer';
import type {
  RegisterInput,
  LoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  RequestDeletionInput,
  DeletionTokenInput,
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
    lastSignInAt: new Date(),
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

  // Successful login clears any failed-attempt count and lock, and records
  // the sign-in time (shown in the deletion-request review email).
  user.failedLoginAttempts = 0;
  user.lockUntil = undefined;
  user.lastSignInAt = new Date();
  await user.save();

  // Signing in cancels any live account-deletion request: the user is back,
  // so the scheduled deletion (and any unconfirmed or unapproved request)
  // is moot. The in-app Privacy page is the way to delete instead.
  await cancelPendingDeletionsForUser(String(user._id));

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

  // The cleanup itself is shared with the scheduled sweep for locked-out
  // deletion requests (see services/accountDeletion): whatever one deletes,
  // the other deletes too.
  await deleteUserAccount(userId, deleteRecipes);
  // The account is gone; any pending deletion request for it is moot.
  await cancelPendingDeletionsForUser(userId);

  // The account is gone; its cookie must not keep authenticating anything.
  clearAuthCookie(res);
  res.json({
    success: true,
    message:
      'Your account and all associated personal data have been permanently deleted in accordance with GDPR / CCPA right to erasure.',
  });
});

/** How long a deletion confirmation / approval link stays valid. */
const DELETION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** How long after confirmation / approval the account is deleted. */
const DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Locked-out account deletion request. The in-app Privacy delete needs a
 * session, so a user who cannot sign in uses this flow instead.
 *
 * Two paths, picked by `cannotAccessEmail`:
 * - Email-access path: a confirmation link goes to the registered email;
 *   clicking it schedules the deletion.
 * - Lost-email path: the request goes to the owner's inbox with the
 *   account's real details, so the owner can judge the claim; the owner's
 *   Approve click schedules the deletion.
 *
 * The response is always the same generic message, whether or not an
 * account exists for the email — never reveal that.
 */
export const requestDeletion = asyncHandler<unknown, unknown, RequestDeletionInput>(
  async (req, res) => {
    // Checked before the user lookup so the response cannot reveal whether
    // an email is registered (same rule as forgot-password).
    if (!isMailConfigured()) {
      throw new AppError('Account deletion requests are not available right now', 503);
    }

    const { email, contactEmail, name, recipe, deleteRecipes, cannotAccessEmail } =
      req.body;
    const user = await User.findOne({ email });
    if (user) {
      // A new request supersedes any earlier live one for this user.
      await cancelPendingDeletionsForUser(String(user._id));

      const token = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const expires = new Date(Date.now() + DELETION_TOKEN_TTL_MS);

      if (cannotAccessEmail) {
        await DeletionRequest.create({
          user: user._id,
          contactEmail,
          claimedName: name,
          claimedRecipe: recipe || undefined,
          deleteRecipes,
          status: 'pending-approval',
          approveTokenHash: tokenHash,
          approveTokenExpires: expires,
        });
        const [recipes, mealPlanCount, groceryListCount] = await Promise.all([
          Recipe.find({ createdBy: user._id }).select('title').lean(),
          MealPlan.countDocuments({ user: user._id }),
          GroceryList.countDocuments({ user: user._id }),
        ]);
        const approveUrl = `${frontendBaseUrl()}/approve-deletion?token=${token}`;
        await sendDeletionReviewEmail(
          ownerInbox(),
          {
            accountEmail: user.email,
            accountName: user.name,
            createdAt: user.createdAt,
            lastSignInAt: user.lastSignInAt,
            recipeCount: recipes.length,
            recipeTitles: recipes.map((r) => r.title),
            mealPlanCount,
            groceryListCount,
            pantryItemCount: user.pantry?.length ?? 0,
            claimedName: name,
            claimedRecipe: recipe || undefined,
            contactEmail,
            deleteRecipes,
          },
          approveUrl
        );
      } else {
        await DeletionRequest.create({
          user: user._id,
          contactEmail,
          claimedName: name,
          claimedRecipe: recipe || undefined,
          deleteRecipes,
          status: 'pending-confirmation',
          confirmTokenHash: tokenHash,
          confirmTokenExpires: expires,
        });
        const confirmUrl = `${frontendBaseUrl()}/confirm-deletion?token=${token}`;
        await sendDeletionConfirmEmail(user.email, confirmUrl);
      }
    }
    // Always the same answer: never reveal whether the email is registered.
    res.json({
      success: true,
      message:
        'Request received. If an account exists for that email, check your inbox for next steps — if you cannot access that inbox, your request has been sent for review instead.',
    });
  }
);

/**
 * Confirm a deletion request from the email-access path. The link click is
 * the verification, so this schedules the deletion: deleteAt is now +
 * 30 days. The token is single-use. Signing in before deleteAt cancels it.
 */
export const confirmDeletion = asyncHandler<unknown, unknown, DeletionTokenInput>(
  async (req, res) => {
    const { token } = req.body;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const request = await DeletionRequest.findOne({
      confirmTokenHash: tokenHash,
      confirmTokenExpires: { $gt: new Date() },
      status: 'pending-confirmation',
    }).select('+confirmTokenHash +confirmTokenExpires');
    if (!request) throw AppError.badRequest('Invalid or expired confirmation link');

    const user = await User.findById(request.user);
    if (!user) {
      // Already gone (e.g. deleted via the Privacy page): nothing to do.
      request.status = 'completed';
      await request.save();
      res.json({
        success: true,
        message: 'This account has already been deleted.',
      });
      return;
    }

    request.status = 'scheduled';
    request.deleteAt = new Date(Date.now() + DELETION_GRACE_MS);
    request.confirmTokenHash = undefined;
    request.confirmTokenExpires = undefined;
    await request.save();
    res.json({
      success: true,
      message:
        'Your account deletion is scheduled. Signing in at any point before the deletion date cancels it.',
      deleteAt: request.deleteAt.toISOString(),
    });
  }
);

/**
 * Approve a deletion request from the lost-email path (owner's click).
 * On approval the app sends two emails: one to the requesting (contact)
 * email — no sign-in link, the requester cannot sign in, replying is how
 * they change their mind — and one to the registered email WITH a sign-in
 * link, so the real owner can sign in and cancel the deletion.
 */
export const approveDeletion = asyncHandler<unknown, unknown, DeletionTokenInput>(
  async (req, res) => {
    if (!isMailConfigured()) {
      throw new AppError('Account deletion requests are not available right now', 503);
    }
    const { token } = req.body;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const request = await DeletionRequest.findOne({
      approveTokenHash: tokenHash,
      approveTokenExpires: { $gt: new Date() },
      status: 'pending-approval',
    }).select('+approveTokenHash +approveTokenExpires');
    if (!request) throw AppError.badRequest('Invalid or expired approval link');

    const user = await User.findById(request.user);
    if (!user) {
      // Already gone (e.g. deleted via the Privacy page): nothing to do.
      request.status = 'completed';
      await request.save();
      res.json({
        success: true,
        message: 'This account has already been deleted.',
      });
      return;
    }

    request.status = 'scheduled';
    request.deleteAt = new Date(Date.now() + DELETION_GRACE_MS);
    request.approveTokenHash = undefined;
    request.approveTokenExpires = undefined;
    await request.save();

    await sendDeletionApprovedToRequester(request.contactEmail, request.deleteAt);
    await sendDeletionApprovedToAccountOwner(
      user.email,
      request.deleteAt,
      `${frontendBaseUrl()}/login`
    );
    res.json({
      success: true,
      message:
        'Deletion approved. The requester and the account owner have been emailed.',
      deleteAt: request.deleteAt.toISOString(),
    });
  }
);

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
