import request from 'supertest';
import { createApp } from '../app';
import { connectInMemoryDB, clearDB, disconnectInMemoryDB } from '../test/db';
import { tokenFromCookie } from '../test/auth';

const app = createApp();

beforeAll(async () => {
  await connectInMemoryDB();
});
afterEach(async () => {
  await clearDB();
});
afterAll(async () => {
  await disconnectInMemoryDB();
});

async function registerUser() {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Test', email: 'p@x.com', password: 'longpass123' , termsAccepted: true, dietaryConsent: true });
  return tokenFromCookie(reg);
}

describe('PATCH /api/auth/me', () => {
  it('updates pantry items', async () => {
    const token = await registerUser();
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        pantry: [
          { ingredient: 'Olive Oil', unit: 'ml', quantity: '500' },
          { ingredient: 'salt' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.user.pantry).toHaveLength(2);
    expect(res.body.user.pantry[0].ingredient).toBe('olive oil'); // lowercased by zod + schema
    expect(res.body.user.pantry[1].ingredient).toBe('salt');
  });

  it('updates dietary preferences and allergies', async () => {
    const token = await registerUser();
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ dietaryPreferences: ['vegetarian'], allergies: ['peanuts'] });
    expect(res.status).toBe(200);
    expect(res.body.user.dietaryPreferences).toEqual(['vegetarian']);
    expect(res.body.user.allergies).toEqual(['peanuts']);
  });

  it('rejects empty body', async () => {
    const token = await registerUser();
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app).patch('/api/auth/me').send({ name: 'New name' });
    expect(res.status).toBe(401);
  });
});
