import { connectInMemoryDB, clearDB, disconnectInMemoryDB } from '../test/db';
import { Recipe } from '../models/Recipe';
import { resolveRecipe, saveGeneratedRecipe } from '../services/chatActions';

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
});
