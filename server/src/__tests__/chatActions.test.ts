import { Types } from 'mongoose';
import { connectInMemoryDB, clearDB, disconnectInMemoryDB } from '../test/db';
import { Recipe } from '../models/Recipe';
import { MealPlan } from '../models/MealPlan';
import { applyChatActions, resolveRecipe, saveGeneratedRecipe } from '../services/chatActions';
import { findAllergyConflict } from '../utils/allergens';

describe('chatActions', () => {
  beforeAll(async () => {
    await connectInMemoryDB();
    await Recipe.syncIndexes();
  });

  afterEach(async () => {
    await clearDB();
  });

  afterAll(async () => {
    await disconnectInMemoryDB();
  });

  it('returns null when no recipe title matches the requested dish closely', async () => {
    await Recipe.create({
      title: 'Turkey Burger',
      ingredients: [{ name: 'turkey', quantity: 200, unit: 'g' }],
      instructions: ['cook'],
      prepTime: 10,
      cookTime: 15,
      servings: 2,
      nutrition: { calories: 450 },
      difficulty: 'easy',
    });

    const result = await resolveRecipe('hamburger');
    expect(result).toBeNull();
  });

  it('matches an exact recipe title when it exists', async () => {
    await Recipe.create({
      title: 'Hamburger',
      ingredients: [{ name: 'beef', quantity: 200, unit: 'g' }],
      instructions: ['cook'],
      prepTime: 10,
      cookTime: 15,
      servings: 2,
      nutrition: { calories: 500 },
      difficulty: 'easy',
    });

    const result = await resolveRecipe('hamburger');
    expect(result).not.toBeNull();
    expect(result?.title).toBe('Hamburger');
  });

  it('preserves the requested dish name when saving a generated recipe', async () => {
    const saved = await saveGeneratedRecipe('507f191e810c19729de860ea', {
      title: 'Lean Turkey Burger',
      description: 'A healthier turkey burger.',
      cuisine: 'american',
      tags: ['dinner'],
      ingredients: [{ name: 'turkey', quantity: 200, unit: 'g' }],
      instructions: ['mix', 'cook'],
      prep_time: 10,
      cook_time: 15,
      servings: 2,
      nutrition: {
        calories: 420,
        protein: 28,
        carbs: 30,
        fat: 18,
        fiber: 2,
        sugar: 3,
        sodium: 520,
      },
      difficulty: 'easy',
      source: 'ai-generated',
      image_url: 'https://example.com/images/turkey-burger.jpg',
    }, 'hamburger');

    expect(saved).not.toBeNull();
    expect(saved?.title).toBe('Hamburger');
  });

  describe('allergy screening on add_to_plan', () => {
    const userId = '507f191e810c19729de860ea';
    const ctx = { dietaryPreferences: [], allergies: ['dairy'] };

    it('refuses a library recipe whose ingredients violate a saved dairy allergy and leaves the plan untouched', async () => {
      await Recipe.create({
        title: 'Creamy Butter Pasta',
        ingredients: [
          { name: 'pasta', quantity: 200, unit: 'g' },
          { name: 'butter', quantity: 50, unit: 'g' },
          { name: 'milk', quantity: 100, unit: 'ml' },
        ],
        instructions: ['cook'],
        prepTime: 10,
        cookTime: 15,
        servings: 2,
        nutrition: { calories: 600 },
        difficulty: 'easy',
      });

      const results = await applyChatActions(userId, ctx, [
        { type: 'add_to_plan', recipe_query: 'Creamy Butter Pasta', day: 'Monday', slot: 'lunch' },
      ]);
      expect(results).toHaveLength(1);
      const result = results[0]!;

      expect(result.status).toBe('allergy_conflict');
      expect(result.message).toContain('butter');
      expect(result.message).toContain('dairy');
      expect(await MealPlan.countDocuments({ user: new Types.ObjectId(userId) })).toBe(0);
    });

    it('still adds a safe library recipe for a user with allergies', async () => {
      const recipe = await Recipe.create({
        title: 'Grilled Chicken Salad',
        ingredients: [
          { name: 'chicken', quantity: 200, unit: 'g' },
          { name: 'lettuce', quantity: 100, unit: 'g' },
        ],
        instructions: ['grill', 'toss'],
        prepTime: 10,
        cookTime: 15,
        servings: 2,
        nutrition: { calories: 350 },
        difficulty: 'easy',
      });

      const results = await applyChatActions(userId, ctx, [
        { type: 'add_to_plan', recipe_query: 'Grilled Chicken Salad', day: 'Monday', slot: 'lunch' },
      ]);
      expect(results).toHaveLength(1);
      const result = results[0]!;

      expect(result.status).toBe('applied');
      const plan = await MealPlan.findOne({ user: new Types.ObjectId(userId) });
      expect(plan).not.toBeNull();
      expect(plan?.days.find((d) => d.day === 'Monday')?.lunch?.toString()).toBe(
        String(recipe._id)
      );
    });

    it('does not treat eggplant as an egg allergy conflict (whole-word matching)', () => {
      expect(findAllergyConflict(['eggplant', 'olive oil'], ['eggs'])).toBeNull();
      expect(findAllergyConflict(['parmesan cheese'], ['dairy'])?.ingredient).toBe(
        'parmesan cheese'
      );
    });
  });
});
