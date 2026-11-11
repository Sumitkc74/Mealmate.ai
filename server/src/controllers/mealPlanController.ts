import { Types } from 'mongoose';
import { MealPlan, DAYS_OF_WEEK, type IDayPlan } from '../models/MealPlan';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { broadcastMealPlan } from '../services/realtime';
import type {
  CreateMealPlanInput,
  UpdateMealPlanInput,
  AssignSlotInput,
} from '../validators/mealPlanSchemas';

export const listMealPlans = asyncHandler(async (req, res) => {
  if (!req.user) throw AppError.unauthorized();
  const query = req.query as Record<string, string | undefined>;
  const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(String(query.limit || '20'), 10) || 20));
  const skip = (page - 1) * limit;

  const [plans, total] = await Promise.all([
    MealPlan.find({ user: req.user.sub })
      .sort({ weekStartDate: -1 })
      .skip(skip)
      .limit(limit)
      .populate(
        'days.breakfast days.lunch days.dinner days.snacks',
        'title slug imageUrl prepTime cookTime nutrition'
      ),
    MealPlan.countDocuments({ user: req.user.sub }),
  ]);

  res.json({
    success: true,
    items: plans,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  });
});

export const getMealPlan = asyncHandler<{ id: string }>(async (req, res) => {
  if (!req.user) throw AppError.unauthorized();
  const plan = await MealPlan.findOne({ _id: req.params.id, user: req.user.sub }).populate(
    'days.breakfast days.lunch days.dinner days.snacks',
    'title slug imageUrl prepTime cookTime nutrition ingredients servings'
  );
  if (!plan) throw AppError.notFound('Meal plan not found');
  res.json({ success: true, plan });
});

export const createMealPlan = asyncHandler<unknown, unknown, CreateMealPlanInput>(
  async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const { weekStartDate, name, notes, days } = req.body;

    const seededDays: IDayPlan[] =
      days?.map((d) => ({
        day: d.day,
        breakfast: d.breakfast ? new Types.ObjectId(d.breakfast) : undefined,
        lunch: d.lunch ? new Types.ObjectId(d.lunch) : undefined,
        dinner: d.dinner ? new Types.ObjectId(d.dinner) : undefined,
        snacks: (d.snacks ?? []).map((id) => new Types.ObjectId(id)),
      })) ?? DAYS_OF_WEEK.map((d) => ({ day: d, snacks: [] }));

    try {
      const plan = await MealPlan.create({
        user: req.user.sub,
        name,
        notes,
        weekStartDate,
        days: seededDays,
      });
      broadcastMealPlan({
        type: 'mealplan:updated',
        mealPlanId: String(plan._id),
        payload: plan,
        actorId: req.user.sub,
      });
      res.status(201).json({ success: true, plan });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('E11000')) {
        throw AppError.conflict('A meal plan already exists for this week');
      }
      throw err;
    }
  }
);

export const updateMealPlan = asyncHandler<{ id: string }, unknown, UpdateMealPlanInput>(
  async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const plan = await MealPlan.findOneAndUpdate(
      { _id: req.params.id, user: req.user.sub },
      req.body,
      { new: true, runValidators: true }
    );
    if (!plan) throw AppError.notFound('Meal plan not found');
    broadcastMealPlan({
      type: 'mealplan:updated',
      mealPlanId: String(plan._id),
      payload: plan,
      actorId: req.user.sub,
    });
    res.json({ success: true, plan });
  }
);

export const assignSlot = asyncHandler<{ id: string }, unknown, AssignSlotInput>(
  async (req, res) => {
    if (!req.user) throw AppError.unauthorized();
    const { day, slot, recipeId } = req.body;

    const updateOp = recipeId
      ? { $set: { [`days.$.${slot}`]: new Types.ObjectId(recipeId) } }
      : { $unset: { [`days.$.${slot}`]: '' } };

    let plan = await MealPlan.findOneAndUpdate(
      { _id: req.params.id, user: req.user.sub, 'days.day': day },
      updateOp,
      { new: true }
    );

    // If day was not present yet, push it atomically
    if (!plan) {
      const exists = await MealPlan.exists({ _id: req.params.id, user: req.user.sub });
      if (!exists) throw AppError.notFound('Meal plan not found');

      plan = await MealPlan.findOneAndUpdate(
        { _id: req.params.id, user: req.user.sub },
        {
          $push: {
            days: {
              day,
              ...(recipeId ? { [slot]: new Types.ObjectId(recipeId) } : {}),
              snacks: [],
            },
          },
        },
        { new: true }
      );
    }

    if (!plan) throw AppError.notFound('Meal plan not found');

    const populatedPlan = await MealPlan.findById(plan._id).populate(
      'days.breakfast days.lunch days.dinner days.snacks',
      'title slug imageUrl prepTime cookTime nutrition ingredients servings'
    );

    broadcastMealPlan({
      type: 'mealplan:updated',
      mealPlanId: String(plan._id),
      payload: populatedPlan ?? plan,
      actorId: req.user.sub,
    });
    res.json({ success: true, plan: populatedPlan ?? plan });
  }
);

export const deleteMealPlan = asyncHandler<{ id: string }>(async (req, res) => {
  if (!req.user) throw AppError.unauthorized();
  const result = await MealPlan.deleteOne({ _id: req.params.id, user: req.user.sub });
  if (result.deletedCount === 0) throw AppError.notFound('Meal plan not found');
  broadcastMealPlan({
    type: 'mealplan:deleted',
    mealPlanId: req.params.id,
    actorId: req.user.sub,
  });
  res.json({ success: true, message: 'Meal plan deleted' });
});
