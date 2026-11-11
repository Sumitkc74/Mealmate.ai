import request from 'supertest';
import { createApp } from '../app';
import { connectInMemoryDB, clearDB, disconnectInMemoryDB } from '../test/db';
import { User } from '../models/User';

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
});
