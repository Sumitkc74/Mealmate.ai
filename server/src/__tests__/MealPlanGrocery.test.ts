import mongoose from 'mongoose';
import { connectInMemoryDB, clearDB, disconnectInMemoryDB } from '../test/db';
import { MealPlan } from '../models/MealPlan';
import { GroceryList } from '../models/GroceryList';

beforeAll(async () => {
  await connectInMemoryDB();
  // Ensure unique indexes are built before running uniqueness tests
  await MealPlan.syncIndexes();
  await GroceryList.syncIndexes();
});
afterEach(async () => {
  await clearDB();
});
afterAll(async () => {
  await disconnectInMemoryDB();
});

describe('MealPlan model', () => {
  it('seeds 7 day entries by default', async () => {
    const plan = await MealPlan.create({
      user: new mongoose.Types.ObjectId(),
      weekStartDate: new Date('2026-01-05'),
    });
    expect(plan.days).toHaveLength(7);
    expect(plan.days.map((d) => d.day)).toContain('Monday');
  });

  it('enforces unique (user, weekStartDate)', async () => {
    const userId = new mongoose.Types.ObjectId();
    const week = new Date('2026-01-05');
    await MealPlan.create({ user: userId, weekStartDate: week });
    await expect(
      MealPlan.create({ user: userId, weekStartDate: week })
    ).rejects.toThrow();
  });
});

describe('GroceryList model', () => {
  it('creates a list with default category and unchecked items', async () => {
    const list = await GroceryList.create({
      user: new mongoose.Types.ObjectId(),
      items: [{ ingredient: 'Onions', quantity: 3 }],
    });
    expect(list.items[0]?.category).toBe('other');
    expect(list.items[0]?.checked).toBe(false);
    expect(list.items[0]?.ingredient).toBe('onions');
  });

  it('rejects invalid category', async () => {
    await expect(
      GroceryList.create({
        user: new mongoose.Types.ObjectId(),
        items: [
          {
            ingredient: 'Bread',
            category: 'rocket-fuel' as never,
          },
        ],
      })
    ).rejects.toThrow();
  });

  it('supports pantry items with expiresAt and category', async () => {
    const { User } = await import('../models/User');
    const user = await User.create({
      name: 'Pantry Chef',
      email: 'chef@example.com',
      password: 'password123',
      pantry: [
        {
          ingredient: 'milk',
          quantity: '1',
          unit: 'l',
          addedAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          category: 'dairy',
        },
      ],
    });

    expect(user.pantry).toHaveLength(1);
    expect(user.pantry[0]?.category).toBe('dairy');
    expect(user.pantry[0]?.expiresAt).toBeInstanceOf(Date);
  });
});

