/**
 * Tests for the AI proxy routes (/api/ai/*).
 *
 * The Python AI service is mocked at the aiClient module level so these tests
 * are pure unit tests of the Express layer — auth gating, validation, profile
 * fallback, hydration, error mapping.
 */
import request from 'supertest';

jest.mock('../services/aiClient', () => ({
  getRecommendations: jest.fn(),
  getSimilarRecipes: jest.fn(),
  generateWeekPlan: jest.fn(),
  getAssistantReply: jest.fn(),
  parsePantryText: jest.fn(),
  getCapabilities: jest.fn(),
  getKnowledgeSubstitutes: jest.fn(),
  getKnowledgePairings: jest.fn(),
  getRecipeFootprint: jest.fn(),
}));

import { createApp } from '../app';
import { connectInMemoryDB, clearDB, disconnectInMemoryDB } from '../test/db';
import { tokenFromCookie } from '../test/auth';
import { User } from '../models/User';
import { Recipe } from '../models/Recipe';
import {
  generateWeekPlan,
  getAssistantReply,
  getCapabilities,
  getKnowledgePairings,
  getKnowledgeSubstitutes,
  getRecipeFootprint,
  getRecommendations,
  getSimilarRecipes,
  parsePantryText,
} from '../services/aiClient';

const mockedRecommend = getRecommendations as jest.MockedFunction<typeof getRecommendations>;
const mockedSimilar = getSimilarRecipes as jest.MockedFunction<typeof getSimilarRecipes>;
const mockedWeek = generateWeekPlan as jest.MockedFunction<typeof generateWeekPlan>;
const mockedChat = getAssistantReply as jest.MockedFunction<typeof getAssistantReply>;
const mockedParse = parsePantryText as jest.MockedFunction<typeof parsePantryText>;
const mockedCaps = getCapabilities as jest.MockedFunction<typeof getCapabilities>;
const mockedSubstitutes = getKnowledgeSubstitutes as jest.MockedFunction<
  typeof getKnowledgeSubstitutes
>;
const mockedPairings = getKnowledgePairings as jest.MockedFunction<typeof getKnowledgePairings>;
const mockedFootprint = getRecipeFootprint as jest.MockedFunction<typeof getRecipeFootprint>;

const app = createApp();

beforeAll(async () => {
  await connectInMemoryDB();
});
afterEach(async () => {
  await clearDB();
  jest.clearAllMocks();
});
afterAll(async () => {
  await disconnectInMemoryDB();
});

async function authedToken(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Eve', email: 'eve@example.com', password: 'longpass123' , termsAccepted: true, dietaryConsent: true });
  return tokenFromCookie(res);
}

describe('AI routes', () => {
  describe('POST /api/ai/recipes/recommend', () => {
    it('serves guests: returns recommendations without a token', async () => {
      mockedRecommend.mockResolvedValueOnce({
        success: true,
        count: 1,
        strategy: 'hybrid',
        results: [
          {
            recipe_id: 'rice-bowl',
            title: 'Rice Bowl',
            score: 0.8,
            matched_ingredients: ['rice'],
            reason: 'matches',
          },
        ],
      });

      const res = await request(app)
        .post('/api/ai/recipes/recommend')
        .send({ ingredients: ['rice'] });

      expect(res.status).toBe(200);
      expect(mockedRecommend).toHaveBeenCalledWith(
        expect.objectContaining({ ingredients: ['rice'] })
      );
    });

    it('serves guests: returns starter recipes for database scope with no inputs', async () => {
      await Recipe.create({
        title: 'Quick Oats',
        slug: 'quick-oats',
        ingredients: [{ name: 'oats' }],
        instructions: ['boil'],
        prepTime: 5,
        cookTime: 5,
        servings: 1,
        difficulty: 'easy',
      });

      const res = await request(app)
        .post('/api/ai/recipes/recommend')
        .send({ scope: 'database' });

      expect(res.status).toBe(200);
      expect(res.body.strategy).toBe('starter');
      expect(res.body.results.length).toBeGreaterThan(0);
      expect(res.body.results[0].title).toBe('Quick Oats');
      expect(mockedRecommend).not.toHaveBeenCalled();
    });

    it('ranks database recipes by pantry overlap instead of a flat score', async () => {
      await Recipe.create({
        title: 'Tomato Soup',
        slug: 'tomato-soup',
        ingredients: [{ name: 'tomato' }, { name: 'onion' }],
        instructions: ['boil'],
        prepTime: 5,
        cookTime: 10,
        servings: 2,
        difficulty: 'easy',
      });
      await Recipe.create({
        title: 'Plain Rice',
        slug: 'plain-rice',
        ingredients: [{ name: 'rice' }],
        instructions: ['boil'],
        prepTime: 5,
        cookTime: 10,
        servings: 2,
        difficulty: 'easy',
      });

      const res = await request(app)
        .post('/api/ai/recipes/recommend')
        .send({ scope: 'database', ingredients: ['tomato'] });

      expect(res.status).toBe(200);
      expect(res.body.strategy).toBe('database');
      const results = res.body.results as Array<{ title: string; score: number }>;
      const tomatoSoup = results.find((r) => r.title === 'Tomato Soup')?.score;
      const plainRice = results.find((r) => r.title === 'Plain Rice')?.score;
      expect(tomatoSoup).toBeDefined();
      expect(plainRice).toBeDefined();
      // The recipe matching a pantry ingredient must score clearly above
      // one matching none — the old 0.2 floor collapsed both to 20%.
      expect(tomatoSoup).toBeGreaterThan(plainRice as number);
      expect(tomatoSoup).toBeGreaterThan(0.5);
      expect(mockedRecommend).not.toHaveBeenCalled();
    });

    it('falls back to user pantry when no ingredients provided', async () => {
      const token = await authedToken();
      await User.findOneAndUpdate(
        { email: 'eve@example.com' },
        { $set: { pantry: [{ ingredient: 'tomato' }, { ingredient: 'garlic' }] } }
      );
      mockedRecommend.mockResolvedValueOnce({
        success: true,
        count: 1,
        strategy: 'hybrid',
        results: [
          {
            recipe_id: 'tomato-pasta',
            title: 'Tomato Basil Pasta',
            score: 0.9,
            matched_ingredients: ['tomato'],
            reason: 'matches',
          },
        ],
      });

      const res = await request(app)
        .post('/api/ai/recipes/recommend')
        .set('Authorization', `Bearer ${token}`)
        .send({ usePantry: true });

      expect(res.status).toBe(200);
      expect(mockedRecommend).toHaveBeenCalledWith(
        expect.objectContaining({ ingredients: ['tomato', 'garlic'] })
      );
    });

    it('returns 503 when AI service throws', async () => {
      const token = await authedToken();
      mockedRecommend.mockRejectedValueOnce(new Error('boom'));
      const res = await request(app)
        .post('/api/ai/recipes/recommend')
        .set('Authorization', `Bearer ${token}`)
        .send({ ingredients: ['rice'] });
      expect(res.status).toBe(503);
    });

    it('hydrates recommendation results with Mongo _id and metadata', async () => {
      const token = await authedToken();
      const seeded = await Recipe.create({
        title: 'Tomato Basil Pasta',
        slug: 'tomato-pasta',
        ingredients: [{ name: 'tomato' }],
        instructions: ['cook'],
        prepTime: 12,
        cookTime: 18,
        servings: 4,
        difficulty: 'easy',
        tags: ['italian'],
      });

      mockedRecommend.mockResolvedValueOnce({
        success: true,
        count: 1,
        strategy: 'hybrid',
        results: [
          {
            recipe_id: 'tomato-pasta',
            title: 'Tomato Basil Pasta',
            score: 0.95,
            matched_ingredients: ['tomato'],
            reason: 'matches',
          },
        ],
      });

      const res = await request(app)
        .post('/api/ai/recipes/recommend')
        .set('Authorization', `Bearer ${token}`)
        .send({ ingredients: ['tomato'] });

      expect(res.status).toBe(200);
      expect(res.body.results[0]._id).toBe(String(seeded._id));
      expect(res.body.results[0].prepTime).toBe(12);
      expect(res.body.results[0].cookTime).toBe(18);
    });

    it('returns starter recommendations when pantry and preferences are completely empty', async () => {
      const token = await authedToken();
      await Recipe.create({
        title: 'Quick Oats',
        slug: 'quick-oats',
        ingredients: [{ name: 'oats' }],
        instructions: ['boil'],
        prepTime: 5,
        cookTime: 5,
        servings: 1,
        difficulty: 'easy',
      });

      const res = await request(app)
        .post('/api/ai/recipes/recommend')
        .set('Authorization', `Bearer ${token}`)
        .send({ usePantry: false });

      expect(res.status).toBe(200);
      expect(res.body.strategy).toBe('starter');
      expect(res.body.results.length).toBeGreaterThan(0);
      expect(res.body.results[0].title).toBe('Quick Oats');
    });

    it('allows recommendations with dietary preferences when pantry is empty', async () => {
      const token = await authedToken();
      mockedRecommend.mockResolvedValueOnce({
        success: true,
        count: 1,
        strategy: 'hybrid',
        results: [
          {
            recipe_id: 'vegan-bowl',
            title: 'Vegan Bowl',
            score: 0.88,
            matched_ingredients: [],
            reason: 'matches vegan',
          },
        ],
      });

      const res = await request(app)
        .post('/api/ai/recipes/recommend')
        .set('Authorization', `Bearer ${token}`)
        .send({ usePantry: false, dietary_preferences: ['vegan'] });

      expect(res.status).toBe(200);
      expect(mockedRecommend).toHaveBeenCalledWith(
        expect.objectContaining({ dietary_preferences: ['vegan'] })
      );
    });
  });

  describe('POST /api/ai/recipes/:slug/similar', () => {
    it('hydrates results with Mongo _id when seeded', async () => {
      const token = await authedToken();
      const seeded = await Recipe.create({
        title: 'Tomato Basil Pasta',
        slug: 'tomato-pasta',
        ingredients: [{ name: 'tomato' }],
        instructions: ['cook'],
        prepTime: 10,
        cookTime: 10,
        servings: 2,
        difficulty: 'easy',
        tags: ['italian'],
      });

      mockedSimilar.mockResolvedValueOnce({
        success: true,
        recipe_id: 'pesto-pasta',
        count: 1,
        strategy: 'tfidf',
        results: [
          {
            recipe_id: 'tomato-pasta',
            title: 'Tomato Basil Pasta',
            score: 0.5,
            matched_ingredients: [],
            reason: 'similar',
          },
        ],
      });

      const res = await request(app)
        .post('/api/ai/recipes/pesto-pasta/similar')
        .set('Authorization', `Bearer ${token}`)
        .send({ top_k: 5 });

      expect(res.status).toBe(200);
      expect(res.body.results[0]._id).toBe(String(seeded._id));
      expect(mockedSimilar).toHaveBeenCalledWith('pesto-pasta', 5, 'tfidf');
    });

    it('returns 404 when AI service returns 404', async () => {
      const token = await authedToken();
      const err = Object.assign(new Error('not found'), {
        response: { status: 404 },
        isAxiosError: true,
      });
      mockedSimilar.mockRejectedValueOnce(err);

      const res = await request(app)
        .post('/api/ai/recipes/unknown/similar')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(404);
    });

    it('serves guests without a token', async () => {
      mockedSimilar.mockResolvedValueOnce({
        success: true,
        recipe_id: 'pesto-pasta',
        count: 0,
        strategy: 'tfidf',
        results: [],
      });

      const res = await request(app)
        .post('/api/ai/recipes/pesto-pasta/similar')
        .send({ top_k: 5 });

      expect(res.status).toBe(200);
      expect(mockedSimilar).toHaveBeenCalledWith('pesto-pasta', 5, 'tfidf');
    });
  });

  describe('POST /api/ai/plan/week', () => {
    it('uses the user profile when useProfile=true and hydrates _ids', async () => {
      const token = await authedToken();
      await User.findOneAndUpdate(
        { email: 'eve@example.com' },
        {
          $set: {
            pantry: [{ ingredient: 'rice' }],
            dietaryPreferences: ['vegetarian'],
            allergies: ['peanut'],
          },
        }
      );
      const seeded = await Recipe.create({
        title: 'Tomato Basil Pasta',
        slug: 'tomato-pasta',
        ingredients: [{ name: 'tomato' }],
        instructions: ['cook'],
        prepTime: 10,
        cookTime: 10,
        servings: 2,
        difficulty: 'easy',
      });

      mockedWeek.mockResolvedValueOnce({
        success: true,
        strategy: 'heuristic',
        days: [
          {
            day: 'monday',
            meals: [
              { slot: 'breakfast', recipe_id: 'tomato-pasta', title: 'Tomato Basil Pasta', tags: [] },
              { slot: 'lunch', recipe_id: 'unseeded-recipe', title: 'Other', tags: [] },
            ],
          },
        ],
      });

      const res = await request(app)
        .post('/api/ai/plan/week')
        .set('Authorization', `Bearer ${token}`)
        .send({ useProfile: true });

      expect(res.status).toBe(200);
      expect(res.body.strategy).toBe('heuristic');
      expect(res.body.days[0].meals[0]._id).toBe(String(seeded._id));
      expect(res.body.days[0].meals[1]._id).toBeUndefined();
      expect(mockedWeek).toHaveBeenCalledWith({
        ingredients: ['rice'],
        dietary_preferences: ['vegetarian'],
        allergies: ['peanut'],
        use_llm: false,
        objective: 'balanced',
        weights: undefined,
      });
    });

    it('returns 503 when AI service is unreachable', async () => {
      const token = await authedToken();
      mockedWeek.mockRejectedValueOnce(new Error('boom'));
      const res = await request(app)
        .post('/api/ai/plan/week')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(503);
    });
  });

  describe('POST /api/ai/chat', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await request(app)
        .post('/api/ai/chat')
        .send({ messages: [{ role: 'user', content: 'What can I make?' }] });
      expect(res.status).toBe(401);
    });

    it('forwards profile context (pantry / prefs / allergies)', async () => {
      const token = await authedToken();
      await User.findOneAndUpdate(
        { email: 'eve@example.com' },
        {
          $set: {
            pantry: [{ ingredient: 'tomato' }, { ingredient: 'rice' }],
            dietaryPreferences: ['vegetarian'],
            allergies: ['peanut'],
          },
        }
      );
      mockedChat.mockResolvedValueOnce({
        success: true,
        reply: 'Try tomato rice.',
        strategy: 'llm',
        suggestions: [],
      });
      const res = await request(app)
        .post('/api/ai/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({
          messages: [{ role: 'user', content: 'What can I make?' }],
        });
      expect(res.status).toBe(200);
      expect(res.body.reply).toBe('Try tomato rice.');
      expect(mockedChat).toHaveBeenCalledWith(
        expect.objectContaining({
          pantry: ['tomato', 'rice'],
          dietary_preferences: ['vegetarian'],
          allergies: ['peanut'],
        })
      );
    });

    it('rejects empty message arrays', async () => {
      const token = await authedToken();
      const res = await request(app)
        .post('/api/ai/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ messages: [] });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/ai/pantry/parse', () => {
    it('returns parsed items', async () => {
      const token = await authedToken();
      mockedParse.mockResolvedValueOnce({
        success: true,
        strategy: 'heuristic',
        items: [
          { ingredient: 'tomato', quantity: '2', unit: null },
          { ingredient: 'rice', quantity: null, unit: null },
        ],
      });
      const res = await request(app)
        .post('/api/ai/pantry/parse')
        .set('Authorization', `Bearer ${token}`)
        .send({ text: '2 tomatoes and rice' });
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(mockedParse).toHaveBeenCalledWith('2 tomatoes and rice');
    });
  });

  describe('GET /api/ai/capabilities', () => {
    it('returns AI service capabilities', async () => {
      const token = await authedToken();
      mockedCaps.mockResolvedValueOnce({
        success: true,
        llm: { provider: 'gemini', model: 'gemini-1.5-flash', available: true },
        features: {
          recommend: true,
          similar: true,
          plan_week: true,
          chat: true,
          pantry_parse: true,
        },
      });
      const res = await request(app)
        .get('/api/ai/capabilities')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.llm.available).toBe(true);
      expect(res.body.llm.provider).toBe('gemini');
    });

    it('serves guests without a token', async () => {
      mockedCaps.mockResolvedValueOnce({
        success: true,
        llm: { provider: 'gemini', model: 'gemini-1.5-flash', available: true },
        features: {
          recommend: true,
          similar: true,
          plan_week: true,
          chat: true,
          pantry_parse: true,
        },
      });
      const res = await request(app).get('/api/ai/capabilities');
      expect(res.status).toBe(200);
      expect(res.body.llm.available).toBe(true);
    });
  });

  describe('GET /api/ai/knowledge/substitutes', () => {
    it('serves guests without a token', async () => {
      mockedSubstitutes.mockResolvedValueOnce({
        success: true,
        ingredient: 'egg',
        substitutions: [
          {
            target: 'egg',
            substitute: 'flaxseed',
            ratio: '1 tbsp + 3 tbsp water',
            context: 'baking',
            notes: 'Works as a binder.',
          },
        ],
      });
      const res = await request(app)
        .get('/api/ai/knowledge/substitutes')
        .query({ ingredient: 'egg' });
      expect(res.status).toBe(200);
      expect(res.body.substitutions).toHaveLength(1);
      expect(mockedSubstitutes).toHaveBeenCalledWith('egg', undefined);
    });
  });

  describe('GET /api/ai/knowledge/pairings', () => {
    it('serves guests without a token', async () => {
      mockedPairings.mockResolvedValueOnce({
        success: true,
        ingredient: 'garlic',
        complements: ['butter'],
      });
      const res = await request(app)
        .get('/api/ai/knowledge/pairings')
        .query({ ingredient: 'garlic' });
      expect(res.status).toBe(200);
      expect(mockedPairings).toHaveBeenCalledWith('garlic');
    });
  });

  describe('GET /api/ai/recipes/:slug/footprint', () => {
    it('serves guests without a token', async () => {
      mockedFootprint.mockResolvedValueOnce({
        success: true,
        recipe_id: 'pho',
        title: 'Pho',
        co2_kg: 1.2,
        cost_usd: 3.5,
        eco_score: 0.8,
        categories: ['soup'],
        breakdown: [],
      });
      const res = await request(app).get('/api/ai/recipes/pho/footprint');
      expect(res.status).toBe(200);
      expect(mockedFootprint).toHaveBeenCalledWith('pho');
    });
  });
});
