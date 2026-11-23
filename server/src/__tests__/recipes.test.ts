import request from 'supertest';
import { createApp } from '../app';
import { connectInMemoryDB, clearDB, disconnectInMemoryDB } from '../test/db';
import { tokenFromCookie } from '../test/auth';
import { Recipe, COMMUNITY_OWNER_ID } from '../models/Recipe';
import { User } from '../models/User';

const app = createApp();

const baseRecipe = {
  title: 'Spaghetti Aglio e Olio',
  description: 'Garlic, oil, chili, parsley over pasta.',
  ingredients: [
    { name: 'spaghetti', quantity: 200, unit: 'g' },
    { name: 'garlic', quantity: 4 },
    { name: 'olive oil', quantity: 60, unit: 'ml' },
  ],
  instructions: ['Boil pasta', 'Sauté garlic', 'Toss together'],
  cuisine: 'italian',
  tags: ['quick', 'vegetarian'],
  prepTime: 5,
  cookTime: 10,
  servings: 2,
};

let token: string;

beforeAll(async () => {
  await connectInMemoryDB();
  await Recipe.syncIndexes();
});
beforeEach(async () => {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Chef', email: 'chef@example.com', password: 'longpass123' , termsAccepted: true, dietaryConsent: true });
  token = tokenFromCookie(reg);
});
afterEach(async () => {
  await clearDB();
});
afterAll(async () => {
  await disconnectInMemoryDB();
});

describe('Recipe routes', () => {
  it('requires auth to create', async () => {
    const res = await request(app).post('/api/recipes').send(baseRecipe);
    expect(res.status).toBe(401);
  });

  it('creates a recipe', async () => {
    const res = await request(app)
      .post('/api/recipes')
      .set('Authorization', `Bearer ${token}`)
      .send(baseRecipe);
    expect(res.status).toBe(201);
    expect(res.body.recipe.slug).toMatch(/^spaghetti-aglio-e-olio-/);
    expect(res.body.recipe.totalTime).toBe(15);
  });

  it('returns 404 (not 400) for a slug URL', async () => {
    const res = await request(app).get('/api/recipes/pho-mqa0sdys');
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });

  it('rejects invalid recipe payload', async () => {
    const res = await request(app)
      .post('/api/recipes')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...baseRecipe, prepTime: -1 });
    expect(res.status).toBe(400);
  });

  it('lists recipes with pagination', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/recipes')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...baseRecipe, title: `Recipe ${i}` });
    }
    const res = await request(app).get('/api/recipes?limit=2&page=1');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.pages).toBe(2);
  });

  it('searches by text query', async () => {
    await request(app)
      .post('/api/recipes')
      .set('Authorization', `Bearer ${token}`)
      .send(baseRecipe);
    await request(app)
      .post('/api/recipes')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...baseRecipe, title: 'Pancakes', tags: ['breakfast'] });

    const res = await request(app).get('/api/recipes?q=spaghetti');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    expect(res.body.items[0].title.toLowerCase()).toContain('spaghetti');
  });

  it('filters by cuisine and tag', async () => {
    await request(app)
      .post('/api/recipes')
      .set('Authorization', `Bearer ${token}`)
      .send(baseRecipe);

    const res = await request(app).get('/api/recipes?cuisine=italian&tag=vegetarian');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it('updates and deletes own recipe', async () => {
    const create = await request(app)
      .post('/api/recipes')
      .set('Authorization', `Bearer ${token}`)
      .send(baseRecipe);
    const id = create.body.recipe.id ?? create.body.recipe._id;

    const update = await request(app)
      .patch(`/api/recipes/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ servings: 4 });
    expect(update.status).toBe(200);
    expect(update.body.recipe.servings).toBe(4);

    const del = await request(app)
      .delete(`/api/recipes/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);

    const fetch = await request(app).get(`/api/recipes/${id}`);
    expect(fetch.status).toBe(404);
  });

  it('forbids editing another user\'s recipe', async () => {
    const create = await request(app)
      .post('/api/recipes')
      .set('Authorization', `Bearer ${token}`)
      .send(baseRecipe);
    const id = create.body.recipe.id ?? create.body.recipe._id;

    const reg2 = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Eve', email: 'eve@example.com', password: 'longpass123' , termsAccepted: true, dietaryConsent: true });

    const res = await request(app)
      .patch(`/api/recipes/${id}`)
      .set('Authorization', `Bearer ${tokenFromCookie(reg2)}`)
      .send({ servings: 99 });
    expect(res.status).toBe(403);
  });

  it('lets any signed-in user edit a community recipe and transfers ownership to them', async () => {
    const create = await request(app)
      .post('/api/recipes')
      .set('Authorization', `Bearer ${token}`)
      .send(baseRecipe);
    const id = create.body.recipe.id ?? create.body.recipe._id;

    // Simulate the recipe becoming a community recipe (owner account deleted).
    await Recipe.findByIdAndUpdate(id, { createdBy: COMMUNITY_OWNER_ID });

    const reg2 = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Eve', email: 'eve@example.com', password: 'longpass123' , termsAccepted: true, dietaryConsent: true });
    const eve = await User.findOne({ email: 'eve@example.com' });

    const res = await request(app)
      .patch(`/api/recipes/${id}`)
      .set('Authorization', `Bearer ${tokenFromCookie(reg2)}`)
      .send({ servings: 6 });
    expect(res.status).toBe(200);
    expect(res.body.recipe.servings).toBe(6);
    // Ownership moved from the community owner to the editor.
    expect(String(res.body.recipe.createdBy)).toBe(String(eve!._id));
  });

  it('lets any signed-in user delete a community recipe', async () => {
    const create = await request(app)
      .post('/api/recipes')
      .set('Authorization', `Bearer ${token}`)
      .send(baseRecipe);
    const id = create.body.recipe.id ?? create.body.recipe._id;

    await Recipe.findByIdAndUpdate(id, { createdBy: COMMUNITY_OWNER_ID });

    const reg2 = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Eve', email: 'eve@example.com', password: 'longpass123' , termsAccepted: true, dietaryConsent: true });

    const del = await request(app)
      .delete(`/api/recipes/${id}`)
      .set('Authorization', `Bearer ${tokenFromCookie(reg2)}`);
    expect(del.status).toBe(200);

    const fetch = await request(app).get(`/api/recipes/${id}`);
    expect(fetch.status).toBe(404);
  });
});
