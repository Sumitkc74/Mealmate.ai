import { GroceryList } from '../models/GroceryList';
import { Types } from 'mongoose';
import { MealPlan } from '../models/MealPlan';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { broadcastGrocery } from '../services/realtime';
import { aggregateGroceryItems, collectRecipesFromPlan } from '../utils/groceryAggregator';
import type {
  GenerateFromPlanInput,
  UpdateGroceryItemInput,
} from '../validators/grocerySchemas';

export const listGroceryLists = asyncHandler(async (req, res) => {
  if (!req.user) throw AppError.unauthorized();
  const query = req.query as Record<string, string | undefined>;
  const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(String(query.limit || '20'), 10) || 20));
  const skip = (page - 1) * limit;

  const [lists, total] = await Promise.all([
    GroceryList.find({ user: req.user.sub }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    GroceryList.countDocuments({ user: req.user.sub }),
  ]);

  res.json({
    success: true,
    items: lists,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  });
});

export const getGroceryList = asyncHandler<{ id: string }>(async (req, res) => {
  if (!req.user) throw AppError.unauthorized();
  const list = await GroceryList.findOne({ _id: req.params.id, user: req.user.sub });
  if (!list) throw AppError.notFound('Grocery list not found');
  res.json({ success: true, list });
});

export const generateFromPlan = asyncHandler<unknown, unknown, GenerateFromPlanInput>(
  async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const { mealPlanId, name, excludePantry } = req.body;

    const plan = await MealPlan.findOne({ _id: mealPlanId, user: req.user.sub }).populate(
      'days.breakfast days.lunch days.dinner days.snacks',
      'ingredients servings title'
    );
    if (!plan) throw AppError.notFound('Meal plan not found');

    const user = excludePantry ? await User.findById(req.user.sub) : null;
    const pantry = user?.pantry?.map((p) => ({ ingredient: p.ingredient })) ?? [];

    const recipes = collectRecipesFromPlan(
      plan.days as unknown as Parameters<typeof collectRecipesFromPlan>[0]
    );
    const items = aggregateGroceryItems(recipes, { pantry });

    const list = await GroceryList.create({
      user: req.user.sub,
      mealPlan: plan._id,
      name: name ?? `Groceries for week of ${plan.weekStartDate.toISOString().slice(0, 10)}`,
      items,
    });

    res.status(201).json({ success: true, list });
  }
);

export const updateGroceryItem = asyncHandler<{ id: string }, unknown, UpdateGroceryItemInput>(
  async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const { itemId, ...patch } = req.body;

    const setFields: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(patch)) {
      if (val !== undefined) {
        setFields[`items.$.${key}`] = val;
      }
    }

    const list = await GroceryList.findOneAndUpdate(
      {
        _id: req.params.id,
        user: req.user.sub,
        'items._id': new Types.ObjectId(itemId),
      },
      { $set: setFields },
      { new: true }
    );
    if (!list) throw AppError.notFound('Grocery list or item not found');

    broadcastGrocery({
      type: 'grocery:updated',
      listId: list._id.toString(),
      payload: list,
      actorId: req.user.sub,
    });

    res.json({ success: true, list });
  }
);

export const deleteGroceryList = asyncHandler<{ id: string }>(async (req, res) => {
  if (!req.user) throw AppError.unauthorized();
  const result = await GroceryList.deleteOne({ _id: req.params.id, user: req.user.sub });
  if (result.deletedCount === 0) throw AppError.notFound('Grocery list not found');

  broadcastGrocery({
    type: 'grocery:deleted',
    listId: req.params.id,
    actorId: req.user.sub,
  });

  res.json({ success: true, message: 'Grocery list deleted' });
});

export const transferCheckedToPantry = asyncHandler<{ id: string }>(async (req, res) => {
  if (!req.user) throw AppError.unauthorized();
  const list = await GroceryList.findOne({ _id: req.params.id, user: req.user.sub });
  if (!list) throw AppError.notFound('Grocery list not found');

  const checkedItems = list.items.filter((it) => it.checked);
  if (checkedItems.length === 0) {
    res.json({ success: true, message: 'No checked items to transfer', count: 0, pantry: [] });
    return;
  }

  // Shelf-life estimates by category in days
  const SHELF_LIFE_DAYS: Record<string, number> = {
    produce: 5,
    dairy: 7,
    meat: 3,
    seafood: 2,
    bakery: 5,
    frozen: 180,
    pantry: 90,
    beverages: 30,
    snacks: 60,
    spices: 365,
    other: 14,
  };

  const user = await User.findById(req.user.sub);
  if (!user) throw AppError.notFound('User not found');

  const existingPantry = user.pantry || [];
  const now = new Date();

  for (const item of checkedItems) {
    const days = SHELF_LIFE_DAYS[item.category] ?? 14;
    const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    existingPantry.push({
      ingredient: item.ingredient,
      quantity: item.quantity ? String(item.quantity) : undefined,
      unit: item.unit,
      addedAt: now,
      expiresAt,
      category: item.category,
    });
  }

  user.pantry = existingPantry;
  await user.save();

  // Remove the checked items from grocery list
  list.items = list.items.filter((it) => !it.checked) as unknown as typeof list.items;
  await list.save();

  broadcastGrocery({
    type: 'grocery:updated',
    listId: list._id.toString(),
    payload: list,
    actorId: req.user.sub,
  });

  res.json({
    success: true,
    message: `Transferred ${checkedItems.length} items to pantry with shelf-life tracking`,
    count: checkedItems.length,
    pantry: user.pantry,
    list,
  });
});

