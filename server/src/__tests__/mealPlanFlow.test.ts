import request from 'supertest';
import { createApp } from '../app';
import { connectInMemoryDB, clearDB, disconnectInMemoryDB } from '../test/db';
import { tokenFromCookie } from '../test/auth';
import { Recipe } from '../models/Recipe';
import { MealPlan } from '../models/MealPlan';

const app = createApp();

let token: string;
let recipeId: string;
let recipeId2: string;

const recipeA = {
  title: 'Chicken Stir Fry',
  ingredients: [
    { name: 'chicken', quantity: 300, unit: 'g' },
    { name: 'soy sauce', quantity: 30, unit: 'ml' },
    { name: 'broccoli', quantity: 200, unit: 'g' },
  ],
  instructions: ['cook'],
  prepTime: 10,
  cookTime: 15,
  servings: 2,
  nutrition: { calories: 450, protein: 35, carbs: 20, fat: 18 },
};

const recipeB = {
  title: 'Tomato Pasta',
  ingredients: [
    { name: 'spaghetti', quantity: 200, unit: 'g' },
    { name: 'tomato', quantity: 4 },
    { name: 'garlic', quantity: 3 },
  ],
  instructions: ['boil', 'sauce'],
  prepTime: 5,
  cookTime: 20,
  servings: 2,
  nutrition: { calories: 520, protein: 16, carbs: 90, fat: 8 },
};

beforeAll(async () => {
  await connectInMemoryDB();
  await Recipe.syncIndexes();
  await MealPlan.syncIndexes();
});
beforeEach(async () => {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Test', email: 'test@x.com', password: 'longpass123' , termsAccepted: true, dietaryConsent: true });
  token = tokenFromCookie(reg);
  const r1 = await request(app)
    .post('/api/recipes')
    .set('Authorization', `Bearer ${token}`)
    .send(recipeA);
  recipeId = r1.body.recipe.id ?? r1.body.recipe._id;
  const r2 = await request(app)
    .post('/api/recipes')
    .set('Authorization', `Bearer ${token}`)
    .send(recipeB);
  recipeId2 = r2.body.recipe.id ?? r2.body.recipe._id;
});
afterEach(async () => {
  await clearDB();
});
afterAll(async () => {
  await disconnectInMemoryDB();
});

describe('Meal plan + grocery + nutrition flow', () => {
  it('creates a meal plan with 7 default days', async () => {
    const res = await request(app)
      .post('/api/mealplans')
      .set('Authorization', `Bearer ${token}`)
      .send({ weekStartDate: '2026-01-05', name: 'Week 1' });
    expect(res.status).toBe(201);
    expect(res.body.plan.days).toHaveLength(7);
  });

  it('assigns recipes to slots', async () => {
    const create = await request(app)
      .post('/api/mealplans')
      .set('Authorization', `Bearer ${token}`)
      .send({ weekStartDate: '2026-01-12' });
    const planId = create.body.plan.id ?? create.body.plan._id;

    const assign = await request(app)
      .post(`/api/mealplans/${planId}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ day: 'Monday', slot: 'dinner', recipeId });
    expect(assign.status).toBe(200);
    const monday = assign.body.plan.days.find((d: { day: string }) => d.day === 'Monday');
    expect(monday.dinner.id).toBe(recipeId);
    expect(monday.dinner.title).toBe('Chicken Stir Fry');
  });

  it('generates a grocery list from a meal plan', async () => {
    const create = await request(app)
      .post('/api/mealplans')
      .set('Authorization', `Bearer ${token}`)
      .send({ weekStartDate: '2026-01-19' });
    const planId = create.body.plan.id ?? create.body.plan._id;

    await request(app)
      .post(`/api/mealplans/${planId}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ day: 'Monday', slot: 'dinner', recipeId });
    await request(app)
      .post(`/api/mealplans/${planId}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ day: 'Tuesday', slot: 'dinner', recipeId: recipeId2 });

    const gen = await request(app)
      .post('/api/grocery/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ mealPlanId: planId });

    expect(gen.status).toBe(201);
    const ingredients = gen.body.list.items.map((i: { ingredient: string }) => i.ingredient);
    expect(ingredients).toEqual(expect.arrayContaining(['chicken', 'tomato', 'garlic', 'broccoli', 'spaghetti']));
    // Each item should have a category
    expect(gen.body.list.items.every((i: { category: string }) => i.category)).toBe(true);
  });

  it('toggles a grocery item checked state', async () => {
    const create = await request(app)
      .post('/api/mealplans')
      .set('Authorization', `Bearer ${token}`)
      .send({ weekStartDate: '2026-01-26' });
    const planId = create.body.plan.id ?? create.body.plan._id;
    await request(app)
      .post(`/api/mealplans/${planId}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ day: 'Wednesday', slot: 'dinner', recipeId });

    const gen = await request(app)
      .post('/api/grocery/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({ mealPlanId: planId });
    const listId = gen.body.list.id ?? gen.body.list._id;
    const itemId = gen.body.list.items[0]._id ?? gen.body.list.items[0].id;

    const upd = await request(app)
      .patch(`/api/grocery/${listId}/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId, checked: true });
    expect(upd.status).toBe(200);
    const item = upd.body.list.items.find((i: { _id: string }) => String(i._id) === String(itemId));
    expect(item.checked).toBe(true);
  });

  it('computes weekly nutrition', async () => {
    const create = await request(app)
      .post('/api/mealplans')
      .set('Authorization', `Bearer ${token}`)
      .send({ weekStartDate: '2026-02-02' });
    const planId = create.body.plan.id ?? create.body.plan._id;

    await request(app)
      .post(`/api/mealplans/${planId}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ day: 'Monday', slot: 'dinner', recipeId });
    await request(app)
      .post(`/api/mealplans/${planId}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ day: 'Tuesday', slot: 'lunch', recipeId: recipeId2 });

    const res = await request(app)
      .get(`/api/nutrition/mealplan/${planId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.total.calories).toBe(970); // 450 + 520
    expect(res.body.days).toHaveLength(7);
    const monday = res.body.days.find((d: { day: string }) => d.day === 'Monday');
    expect(monday.nutrition.calories).toBe(450);
  });

  it('blocks access to another user\'s meal plan', async () => {
    const create = await request(app)
      .post('/api/mealplans')
      .set('Authorization', `Bearer ${token}`)
      .send({ weekStartDate: '2026-02-09' });
    const planId = create.body.plan.id ?? create.body.plan._id;

    const reg2 = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Eve', email: 'eve@x.com', password: 'longpass123' , termsAccepted: true, dietaryConsent: true });

    const res = await request(app)
      .get(`/api/mealplans/${planId}`)
      .set('Authorization', `Bearer ${tokenFromCookie(reg2)}`);
    expect(res.status).toBe(404);
  });
});
