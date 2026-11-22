import request from 'supertest';
import { createApp } from '../app';
import { connectInMemoryDB, clearDB, disconnectInMemoryDB } from '../test/db';
import { Recipe } from '../models/Recipe';
import { verifyRecipeWithAiService } from '../services/aiClient';

// Mock the AI-service call: by default it fails (service unreachable), so the
// deterministic fallback runs — the same behavior as the unmocked suite.
// Individual tests override it with mockResolvedValueOnce.
jest.mock('../services/aiClient', () => ({
  ...jest.requireActual('../services/aiClient'),
  verifyRecipeWithAiService: jest.fn(),
}));
const mockedVerify = verifyRecipeWithAiService as jest.Mock;
mockedVerify.mockRejectedValue(new Error('ai-service unavailable'));

const app = createApp();

let token: string;

const validRecipe = {
  title: 'Creamy Garlic Butter Pasta',
  description: 'Rich and savory pasta tossed in garlic and butter sauce.',
  ingredients: [
    { name: 'pasta', quantity: 250, unit: 'g' },
    { name: 'garlic', quantity: 4, unit: 'cloves' },
    { name: 'butter', quantity: 50, unit: 'g' },
    { name: 'parmesan cheese', quantity: 30, unit: 'g' },
  ],
  instructions: [
    'Boil salted water and cook pasta until al dente.',
    'Melt butter in a pan and sauté minced garlic until fragrant.',
    'Toss pasta in garlic butter and mix in grated parmesan cheese to serve.',
  ],
  cuisine: 'italian',
  prepTime: 10,
  cookTime: 15,
  servings: 2,
};

beforeAll(async () => {
  await connectInMemoryDB();
  await Recipe.syncIndexes();
});

beforeEach(async () => {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Chef Alex', email: 'alex@example.com', password: 'securepassword123' });
  token = reg.body.token;
});

afterEach(async () => {
  await clearDB();
});

afterAll(async () => {
  await disconnectInMemoryDB();
});

describe('Recipe Verification and Safety Guardrails', () => {
  describe('POST /api/recipes/verify', () => {
    it('verifies a culinary-sound recipe and detects allergens', async () => {
      // No AI service runs in the test env, so verification falls back to
      // deterministic rules. Fail-safe: the fallback caps the verdict at
      // needs_review (the AI coherence check did not run), so the score is
      // 69 and the recipe carries the AI-unavailable warning — it is not
      // silently marked fully verified.
      const res = await request(app)
        .post('/api/recipes/verify')
        .set('Authorization', `Bearer ${token}`)
        .send(validRecipe);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.is_valid).toBe(true);
      expect(res.body.score).toBe(69);
      expect(res.body.verdict).toBe('needs_review');
      expect(res.body.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'coherence',
            message: expect.stringContaining('AI verification was unavailable'),
          }),
        ])
      );
      expect(res.body.detected_allergens).toContain('dairy');
      expect(res.body.detected_allergens).toContain('gluten');
    });

    it('rejects recipe containing toxic/hazardous ingredients', async () => {
      const toxicRecipe = {
        ...validRecipe,
        title: 'Chemical Stew',
        ingredients: [
          { name: 'bleach', quantity: 1, unit: 'cup' },
          { name: 'pasta', quantity: 100, unit: 'g' },
        ],
      };

      const res = await request(app)
        .post('/api/recipes/verify')
        .set('Authorization', `Bearer ${token}`)
        .send(toxicRecipe);

      expect(res.status).toBe(200);
      expect(res.body.is_valid).toBe(false);
      expect(res.body.verdict).toBe('rejected');
      expect(res.body.score).toBe(0);
      expect(
        res.body.issues.some(
          (i: { category: string; severity: string }) =>
            i.category === 'safety' && i.severity === 'error'
        )
      ).toBe(true);
    });

    it('rejects recipe with gibberish title or instructions', async () => {
      const gibberishRecipe = {
        ...validRecipe,
        title: 'qwrtypsdfghjkl',
        instructions: ['zxcvbnmasdfghjkl.'],
      };

      const res = await request(app)
        .post('/api/recipes/verify')
        .set('Authorization', `Bearer ${token}`)
        .send(gibberishRecipe);

      expect(res.status).toBe(200);
      expect(res.body.is_valid).toBe(false);
      expect(res.body.verdict).toBe('rejected');
      expect(
        res.body.issues.some((i: { category: string }) => i.category === 'coherence')
      ).toBe(true);
    });
  });

  describe('POST /api/recipes/estimate-nutrition', () => {
    it('estimates macronutrient and calorie values per serving', async () => {
      const res = await request(app)
        .post('/api/recipes/estimate-nutrition')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Creamy Garlic Butter Pasta',
          ingredients: validRecipe.ingredients,
          servings: 2,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.calories).toBeGreaterThan(200);
      expect(res.body.protein).toBeGreaterThan(5);
      expect(res.body.carbs).toBeGreaterThan(20);
      expect(res.body.fat).toBeGreaterThan(5);
      expect(res.body.servings).toBe(2);
    });
  });

  describe('Enforcement on Recipe Creation & Modification', () => {
    it('creates safe recipe successfully', async () => {
      const res = await request(app)
        .post('/api/recipes')
        .set('Authorization', `Bearer ${token}`)
        .send(validRecipe);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.recipe.title).toBe(validRecipe.title);
    });

    it('blocks creation of recipe with hazardous substance with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/recipes')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...validRecipe,
          title: 'Drain Cleaner Soup',
          ingredients: [
            { name: 'drain cleaner', quantity: 50, unit: 'ml' },
            { name: 'noodles', quantity: 100, unit: 'g' },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/hazardous|toxic|verification failed/i);
    });

    it('blocks creation of recipe with gibberish instructions with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/recipes')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...validRecipe,
          instructions: ['asdfghjklzxcvbnmqwerty.'],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/verification failed|gibberish/i);
    });

    it('blocks updating a recipe to include hazardous ingredients', async () => {
      const created = await request(app)
        .post('/api/recipes')
        .set('Authorization', `Bearer ${token}`)
        .send(validRecipe);

      const recipeId = created.body.recipe.id ?? created.body.recipe._id;

      const updateRes = await request(app)
        .patch(`/api/recipes/${recipeId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          ingredients: [{ name: 'motor oil', quantity: 1, unit: 'cup' }],
        });

      expect(updateRes.status).toBe(400);
      expect(updateRes.body.message).toMatch(/hazardous|toxic|verification failed/i);
    });
  });

  describe('Needs-review tagging', () => {
    const needsReviewResult = {
      success: true,
      is_valid: true,
      score: 60,
      verdict: 'needs_review',
      summary: 'Recipe looks plausible but has areas that could be improved before sharing.',
      issues: [
        {
          severity: 'warning',
          category: 'coherence',
          message: 'Title names chicken but no chicken appears in the ingredients.',
        },
      ],
      detected_allergens: [],
      suggestions: [],
    };

    const verifiedResult = {
      success: true,
      is_valid: true,
      score: 95,
      verdict: 'verified',
      summary: 'Recipe verified! Safe, culinary-sound, and ready to publish.',
      issues: [],
      detected_allergens: [],
      suggestions: [],
    };

    it('tags a recipe published anyway (needs_review) so other users know', async () => {
      mockedVerify.mockResolvedValueOnce(needsReviewResult);

      const res = await request(app)
        .post('/api/recipes')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validRecipe, tags: ['dinner'] });

      expect(res.status).toBe(201);
      expect(res.body.recipe.tags).toContain('needs-review');
      expect(res.body.recipe.tags).toContain('dinner');
    });

    it('strips a user-supplied needs-review tag when the recipe verifies', async () => {
      mockedVerify.mockResolvedValueOnce(verifiedResult);

      const res = await request(app)
        .post('/api/recipes')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...validRecipe, tags: ['dinner', 'needs-review'] });

      expect(res.status).toBe(201);
      expect(res.body.recipe.tags).not.toContain('needs-review');
      expect(res.body.recipe.tags).toContain('dinner');
    });

    it('removes the tag when an edit brings the recipe to verified', async () => {
      mockedVerify.mockResolvedValueOnce(needsReviewResult);
      const created = await request(app)
        .post('/api/recipes')
        .set('Authorization', `Bearer ${token}`)
        .send(validRecipe);
      const recipeId = created.body.recipe.id ?? created.body.recipe._id;
      expect(created.body.recipe.tags).toContain('needs-review');

      mockedVerify.mockResolvedValueOnce(verifiedResult);
      const updated = await request(app)
        .patch(`/api/recipes/${recipeId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Creamy Garlic Butter Pasta' });

      expect(updated.status).toBe(200);
      expect(updated.body.recipe.tags).not.toContain('needs-review');
    });

    it('adds the tag when an edit drops the recipe to needs_review', async () => {
      mockedVerify.mockResolvedValueOnce(verifiedResult);
      const created = await request(app)
        .post('/api/recipes')
        .set('Authorization', `Bearer ${token}`)
        .send(validRecipe);
      const recipeId = created.body.recipe.id ?? created.body.recipe._id;
      expect(created.body.recipe.tags).not.toContain('needs-review');

      mockedVerify.mockResolvedValueOnce(needsReviewResult);
      const updated = await request(app)
        .patch(`/api/recipes/${recipeId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Chicken Garlic Butter Pasta' });

      expect(updated.status).toBe(200);
      expect(updated.body.recipe.tags).toContain('needs-review');
    });
  });
});

