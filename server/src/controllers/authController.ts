import type { Request, Response } from 'express';
import { User } from '../models/User';
import { MealPlan } from '../models/MealPlan';
import { GroceryList } from '../models/GroceryList';
import { Recipe } from '../models/Recipe';
import { AppError } from '../utils/AppError';
import { signAccessToken } from '../utils/jwt';
import { asyncHandler } from '../utils/asyncHandler';
import type { RegisterInput, LoginInput, UpdateProfileInput } from '../validators/authSchemas';

export const register = asyncHandler<unknown, unknown, RegisterInput>(async (req, res) => {
  const { name, email, password, termsAccepted, dietaryConsent, marketingOptIn } = req.body;

  const existing = await User.findOne({ email });
  if (existing) throw AppError.conflict('Email already registered');

  const user = await User.create({
    name,
    email,
    password,
    termsAcceptedAt: termsAccepted ? new Date() : undefined,
    dietaryConsentAt: dietaryConsent ? new Date() : undefined,
    marketingOptIn: Boolean(marketingOptIn),
  });
  const token = signAccessToken({ sub: String(user._id), role: user.role });

  res.status(201).json({
    success: true,
    token,
    user: { id: String(user._id), name: user.name, email: user.email, role: user.role },
  });
});

export const login = asyncHandler<unknown, unknown, LoginInput>(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    throw AppError.unauthorized('Invalid email or password');
  }

  const token = signAccessToken({ sub: String(user._id), role: user.role });
  res.json({
    success: true,
    token,
    user: { id: String(user._id), name: user.name, email: user.email, role: user.role },
  });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw AppError.unauthorized();
  const user = await User.findById(req.user.sub);
  if (!user) throw AppError.notFound('User not found');
  res.json({ success: true, user: user.toJSON() });
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
 * Deletes user profile, personal meal plans, grocery lists, and user-authored recipes.
 */
export const deleteAccount = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw AppError.unauthorized();
  const userId = req.user.sub;

  const user = await User.findById(userId);
  if (!user) throw AppError.notFound('User not found');

  // Cascade delete all personal data
  await Promise.all([
    MealPlan.deleteMany({ user: userId }),
    GroceryList.deleteMany({ user: userId }),
    Recipe.deleteMany({ createdBy: userId }),
    User.findByIdAndDelete(userId),
  ]);

  res.json({
    success: true,
    message:
      'Your account and all associated personal data have been permanently deleted in accordance with GDPR / CCPA right to erasure.',
  });
});
