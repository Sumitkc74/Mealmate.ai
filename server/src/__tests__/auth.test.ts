import request from 'supertest';
import { createApp } from '../app';
import { connectInMemoryDB, clearDB, disconnectInMemoryDB } from '../test/db';
import { User } from '../models/User';
import { Recipe, COMMUNITY_OWNER_ID } from '../models/Recipe';

const app = createApp();

beforeAll(async () => {
  await connectInMemoryDB();
  await User.syncIndexes();
});
afterEach(async () => {
  await clearDB();
});
afterAll(async () => {
  await disconnectInMemoryDB();
});

describe('Auth routes', () => {
  const creds = { name: 'Alice', email: 'alice@example.com', password: 'longpass123' };

  it('POST /api/auth/register creates a user and returns a token', async () => {
    const res = await request(app).post('/api/auth/register').send(creds);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user.email).toBe(creds.email);
    // The client stores this user and reads profile fields from it, so the
    // auth response must carry the full profile, not just id/name/email/role.
    expect(res.body.user.pantry).toEqual([]);
    expect(res.body.user.dietaryPreferences).toEqual([]);
    expect(res.body.user.allergies).toEqual([]);
    expect(res.body.user.password).toBeUndefined();
  });

  it('POST /api/auth/register rejects duplicate email', async () => {
    await request(app).post('/api/auth/register').send(creds);
    const res = await request(app).post('/api/auth/register').send(creds);
    expect(res.status).toBe(409);
  });

  it('POST /api/auth/register validates input', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'bad', password: 'short' });
    expect(res.status).toBe(400);
  });

  it('POST /api/auth/login returns token for valid credentials', async () => {
    await request(app).post('/api/auth/register').send(creds);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: creds.email, password: creds.password });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    // Same full-profile requirement as register (see above).
    expect(res.body.user.pantry).toEqual([]);
    expect(res.body.user.dietaryPreferences).toEqual([]);
    expect(res.body.user.allergies).toEqual([]);
    expect(res.body.user.password).toBeUndefined();
  });

  it('POST /api/auth/login rejects invalid password', async () => {
    await request(app).post('/api/auth/register').send(creds);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: creds.email, password: 'wrongpass' });
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me requires a token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me returns the current user', async () => {
    const reg = await request(app).post('/api/auth/register').send(creds);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${reg.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(creds.email);
    expect(res.body.user).not.toHaveProperty('password');
  });

  it('GET /api/auth/me/export exports user data bundle for GDPR portability', async () => {
    const reg = await request(app).post('/api/auth/register').send(creds);
    const res = await request(app)
      .get('/api/auth/me/export')
      .set('Authorization', `Bearer ${reg.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.email).toBe(creds.email);
    expect(Array.isArray(res.body.mealPlans)).toBe(true);
    expect(Array.isArray(res.body.groceryLists)).toBe(true);
    expect(Array.isArray(res.body.authoredRecipes)).toBe(true);
  });

  it('DELETE /api/auth/me deletes the user account and personal data', async () => {
    const reg = await request(app).post('/api/auth/register').send(creds);
    const res = await request(app)
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${reg.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify user no longer exists
    const check = await User.findOne({ email: creds.email });
    expect(check).toBeNull();
  });

  it('DELETE /api/auth/me keeps the user recipes as community recipes', async () => {
    const reg = await request(app).post('/api/auth/register').send(creds);
    const create = await request(app)
      .post('/api/recipes')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({
        title: 'Community Soup',
        ingredients: [{ name: 'water' }],
        instructions: ['boil'],
        prepTime: 5,
        cookTime: 10,
        servings: 1,
      });
    expect(create.status).toBe(201);
    const id = create.body.recipe.id ?? create.body.recipe._id;

    const res = await request(app)
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${reg.body.token}`);
    expect(res.status).toBe(200);

    // The user is gone, but the recipe survives in the shared library,
    // reassigned to the community owner instead of being deleted.
    expect(await User.findOne({ email: creds.email })).toBeNull();
    const recipe = await Recipe.findById(id);
    expect(recipe).not.toBeNull();
    expect(String(recipe!.createdBy)).toBe(String(COMMUNITY_OWNER_ID));
  });
});
