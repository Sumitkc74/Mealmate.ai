import { createHash } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../app';
import { connectInMemoryDB, clearDB, disconnectInMemoryDB } from '../test/db';
import { User } from '../models/User';
import { DeletionRequest } from '../models/DeletionRequest';
import { Recipe, COMMUNITY_OWNER_ID } from '../models/Recipe';
import { MealPlan } from '../models/MealPlan';
import { GroceryList } from '../models/GroceryList';
import { processPendingDeletions } from '../services/accountDeletion';
import {
  isMailConfigured,
  sendDeletionConfirmEmail,
  sendDeletionReviewEmail,
  sendDeletionApprovedToRequester,
  sendDeletionApprovedToAccountOwner,
} from '../services/mailer';

jest.mock('../services/mailer', () => ({
  isMailConfigured: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  sendDeletionConfirmEmail: jest.fn(),
  sendDeletionReviewEmail: jest.fn(),
  sendDeletionApprovedToRequester: jest.fn(),
  sendDeletionApprovedToAccountOwner: jest.fn(),
  frontendBaseUrl: jest.fn(() => 'http://localhost:3000'),
  ownerInbox: jest.fn(() => 'owner@example.com'),
}));

const mockedIsMailConfigured = isMailConfigured as jest.Mock;
const mockedConfirmMail = sendDeletionConfirmEmail as jest.Mock;
const mockedReviewMail = sendDeletionReviewEmail as jest.Mock;
const mockedApprovedToRequester = sendDeletionApprovedToRequester as jest.Mock;
const mockedApprovedToOwner = sendDeletionApprovedToAccountOwner as jest.Mock;

const app = createApp();

const user = { name: 'Deleter', email: 'deleter@example.com', password: 'longpass123' };

beforeAll(async () => {
  await connectInMemoryDB();
  await DeletionRequest.syncIndexes();
});

beforeEach(async () => {
  mockedIsMailConfigured.mockReset();
  mockedConfirmMail.mockReset();
  mockedReviewMail.mockReset();
  mockedApprovedToRequester.mockReset();
  mockedApprovedToOwner.mockReset();
  mockedIsMailConfigured.mockReturnValue(true);
  mockedConfirmMail.mockResolvedValue(undefined);
  mockedReviewMail.mockResolvedValue(undefined);
  mockedApprovedToRequester.mockResolvedValue(undefined);
  mockedApprovedToOwner.mockResolvedValue(undefined);
  // Create the user directly (not via the API) so these tests do not spend
  // the auth rate-limit budget (20 requests / 15 min) on registrations.
  await User.create(user);
});

afterEach(async () => {
  await clearDB();
});

afterAll(async () => {
  await disconnectInMemoryDB();
});

function tokenFromUrl(url: string): string {
  return new URL(url).searchParams.get('token') as string;
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** A raw token shaped like the ones the controller generates (64 hex chars). */
const RAW_TOKEN =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('POST /api/auth/request-deletion', () => {
  it('returns 503 when mail is not configured', async () => {
    mockedIsMailConfigured.mockReturnValue(false);
    const res = await request(app)
      .post('/api/auth/request-deletion')
      .send({
        email: user.email,
        contactEmail: 'reachme@example.com',
        name: user.name,
        cannotAccessEmail: false,
      });
    expect(res.status).toBe(503);
    expect(mockedConfirmMail).not.toHaveBeenCalled();
    expect(mockedReviewMail).not.toHaveBeenCalled();
    expect(await DeletionRequest.countDocuments()).toBe(0);
  });

  it('email-access path: creates a pending-confirmation request and emails a confirm link', async () => {
    const res = await request(app)
      .post('/api/auth/request-deletion')
      .send({
        email: user.email,
        contactEmail: 'reachme@example.com',
        name: user.name,
        recipe: 'My Soup',
        deleteRecipes: false,
        cannotAccessEmail: false,
      });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/request received/i);
    expect(mockedConfirmMail).toHaveBeenCalledTimes(1);
    expect(mockedConfirmMail.mock.calls[0][0]).toBe(user.email);
    expect(mockedReviewMail).not.toHaveBeenCalled();

    const stored = await DeletionRequest.findOne({ contactEmail: 'reachme@example.com' }).select(
      '+confirmTokenHash +confirmTokenExpires'
    );
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe('pending-confirmation');
    expect(stored!.deleteRecipes).toBe(false);
    expect(stored!.claimedName).toBe(user.name);
    expect(stored!.claimedRecipe).toBe('My Soup');
    expect(stored!.confirmTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored!.confirmTokenExpires?.getTime()).toBeGreaterThan(Date.now());
    expect(tokenFromUrl(mockedConfirmMail.mock.calls[0][1] as string)).toHaveLength(64);
  });

  it('lost-email path: creates a pending-approval request and emails the owner the real account details', async () => {
    const dbUser = await User.findOne({ email: user.email });
    await Recipe.create({
      title: 'Deleter Soup',
      ingredients: [{ name: 'water' }],
      instructions: ['boil'],
      prepTime: 5,
      cookTime: 10,
      servings: 1,
      imageUrl: 'https://example.com/images/deleter-soup.jpg',
      createdBy: dbUser!._id,
    });

    const res = await request(app)
      .post('/api/auth/request-deletion')
      .send({
        email: user.email,
        contactEmail: 'reachme@example.com',
        name: user.name,
        recipe: 'Deleter Soup',
        deleteRecipes: true,
        cannotAccessEmail: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/request received/i);
    expect(mockedReviewMail).toHaveBeenCalledTimes(1);
    expect(mockedConfirmMail).not.toHaveBeenCalled();

    // The review email goes to the owner's inbox, carries the account's
    // real details next to what the requester claimed, and an Approve link.
    const [to, details, approveUrl] = mockedReviewMail.mock.calls[0] as [
      string,
      Record<string, unknown>,
      string,
    ];
    expect(to).toBe('owner@example.com');
    expect(details.accountEmail).toBe(user.email);
    expect(details.accountName).toBe(user.name);
    expect(details.claimedName).toBe(user.name);
    expect(details.claimedRecipe).toBe('Deleter Soup');
    expect(details.recipeCount).toBe(1);
    expect(details.recipeTitles).toContain('Deleter Soup');
    expect(details.deleteRecipes).toBe(true);
    expect(approveUrl).toContain('/approve-deletion?token=');
    expect(tokenFromUrl(approveUrl)).toHaveLength(64);

    const stored = await DeletionRequest.findOne({ contactEmail: 'reachme@example.com' }).select(
      '+approveTokenHash +approveTokenExpires'
    );
    expect(stored!.status).toBe('pending-approval');
    expect(stored!.deleteRecipes).toBe(true);
    expect(stored!.approveTokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('answers the same for an unknown email and sends nothing', async () => {
    const res = await request(app)
      .post('/api/auth/request-deletion')
      .send({
        email: 'nobody@example.com',
        contactEmail: 'reachme@example.com',
        name: 'Nobody',
        cannotAccessEmail: false,
      });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/request received/i);
    expect(mockedConfirmMail).not.toHaveBeenCalled();
    expect(mockedReviewMail).not.toHaveBeenCalled();
    expect(await DeletionRequest.countDocuments()).toBe(0);
  });

  it('validates input', async () => {
    const res = await request(app)
      .post('/api/auth/request-deletion')
      .send({ email: 'bad', contactEmail: 'also-bad', name: 'X' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/confirm-deletion', () => {
  async function requestConfirmToken(): Promise<string> {
    await request(app)
      .post('/api/auth/request-deletion')
      .send({
        email: user.email,
        contactEmail: 'reachme@example.com',
        name: user.name,
        cannotAccessEmail: false,
      });
    return tokenFromUrl(mockedConfirmMail.mock.calls[0][1] as string);
  }

  it('confirms with a valid token and starts the 30-day clock', async () => {
    const token = await requestConfirmToken();
    const res = await request(app).post('/api/auth/confirm-deletion').send({ token });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/scheduled/i);
    const deleteAt = new Date(res.body.deleteAt as string).getTime();
    expect(deleteAt).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
    expect(deleteAt).toBeLessThan(Date.now() + 31 * 24 * 60 * 60 * 1000);

    const stored = await DeletionRequest.findOne({ contactEmail: 'reachme@example.com' });
    expect(stored!.status).toBe('scheduled');
    expect(stored!.deleteAt?.getTime()).toBe(deleteAt);
  });

  it('rejects reusing a token', async () => {
    const token = await requestConfirmToken();
    await request(app).post('/api/auth/confirm-deletion').send({ token });
    const again = await request(app).post('/api/auth/confirm-deletion').send({ token });
    expect(again.status).toBe(400);
  });

  it('rejects a bogus token', async () => {
    const res = await request(app)
      .post('/api/auth/confirm-deletion')
      .send({ token: 'deadbeef' });
    expect(res.status).toBe(400);
  });

  it('rejects an expired token', async () => {
    const dbUser = await User.findOne({ email: user.email });
    await DeletionRequest.create({
      user: dbUser!._id,
      contactEmail: 'reachme@example.com',
      claimedName: user.name,
      deleteRecipes: false,
      status: 'pending-confirmation',
      confirmTokenHash: hashToken(RAW_TOKEN),
      confirmTokenExpires: new Date(Date.now() - 1000),
    });
    const res = await request(app)
      .post('/api/auth/confirm-deletion')
      .send({ token: RAW_TOKEN });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/approve-deletion', () => {
  async function createPendingApproval(): Promise<string> {
    const dbUser = await User.findOne({ email: user.email });
    await DeletionRequest.create({
      user: dbUser!._id,
      contactEmail: 'reachme@example.com',
      claimedName: user.name,
      claimedRecipe: 'Deleter Soup',
      deleteRecipes: false,
      status: 'pending-approval',
      approveTokenHash: hashToken(RAW_TOKEN),
      approveTokenExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    return RAW_TOKEN;
  }

  it('approves with a valid token and sends the two emails', async () => {
    const token = await createPendingApproval();
    const res = await request(app).post('/api/auth/approve-deletion').send({ token });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/approved/i);
    const deleteAt = new Date(res.body.deleteAt as string).getTime();
    expect(deleteAt).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);

    const stored = await DeletionRequest.findOne({ contactEmail: 'reachme@example.com' });
    expect(stored!.status).toBe('scheduled');
    expect(stored!.deleteAt?.getTime()).toBe(deleteAt);

    // The requester is emailed with NO sign-in link (they cannot sign in;
    // replying is how they change their mind). The call carries only the
    // address and the date — there is no URL argument at all.
    expect(mockedApprovedToRequester).toHaveBeenCalledTimes(1);
    expect(mockedApprovedToRequester.mock.calls[0][0]).toBe('reachme@example.com');
    expect(mockedApprovedToRequester.mock.calls[0]).toHaveLength(2);
    expect(mockedApprovedToRequester.mock.calls[0][1]).toBeInstanceOf(Date);
    // The account owner is emailed WITH a sign-in link, so they can sign
    // in and cancel the deletion.
    expect(mockedApprovedToOwner).toHaveBeenCalledTimes(1);
    expect(mockedApprovedToOwner.mock.calls[0][0]).toBe(user.email);
    expect(mockedApprovedToOwner.mock.calls[0][1]).toBeInstanceOf(Date);
    expect(mockedApprovedToOwner.mock.calls[0][2]).toContain('/login');
  });

  it('rejects reusing a token', async () => {
    const token = await createPendingApproval();
    await request(app).post('/api/auth/approve-deletion').send({ token });
    const again = await request(app).post('/api/auth/approve-deletion').send({ token });
    expect(again.status).toBe(400);
    // The two emails go out once, on the first (valid) approval only.
    expect(mockedApprovedToRequester).toHaveBeenCalledTimes(1);
    expect(mockedApprovedToOwner).toHaveBeenCalledTimes(1);
  });

  it('rejects a bogus token', async () => {
    const res = await request(app)
      .post('/api/auth/approve-deletion')
      .send({ token: 'deadbeef' });
    expect(res.status).toBe(400);
    expect(mockedApprovedToRequester).not.toHaveBeenCalled();
    expect(mockedApprovedToOwner).not.toHaveBeenCalled();
  });
});

describe('sign-in cancels pending deletions', () => {
  it('a successful login cancels scheduled and unconfirmed requests', async () => {
    const dbUser = await User.findOne({ email: user.email });
    const scheduled = await DeletionRequest.create({
      user: dbUser!._id,
      contactEmail: 'reachme@example.com',
      claimedName: user.name,
      deleteRecipes: false,
      status: 'scheduled',
      deleteAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const unconfirmed = await DeletionRequest.create({
      user: dbUser!._id,
      contactEmail: 'other@example.com',
      claimedName: user.name,
      deleteRecipes: false,
      status: 'pending-confirmation',
      confirmTokenHash: hashToken(RAW_TOKEN),
      confirmTokenExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password });
    expect(res.status).toBe(200);

    expect((await DeletionRequest.findById(scheduled._id))!.status).toBe('cancelled');
    expect((await DeletionRequest.findById(unconfirmed._id))!.status).toBe('cancelled');
    // And the user is still there, with the sign-in recorded.
    const after = await User.findById(dbUser!._id);
    expect(after).not.toBeNull();
    expect(after!.lastSignInAt).toBeInstanceOf(Date);
  });
});

describe('processPendingDeletions sweep', () => {
  async function seedUser(
    email: string,
    deleteRecipes: boolean,
    deleteAt: Date
  ): Promise<{ userId: string; recipeId: string }> {
    const u = await User.create({ name: 'Sweep', email, password: 'longpass123' });
    const recipe = await Recipe.create({
      title: `Sweep Soup ${email}`,
      ingredients: [{ name: 'water' }],
      instructions: ['boil'],
      prepTime: 5,
      cookTime: 10,
      servings: 1,
      imageUrl: 'https://example.com/images/sweep-soup.jpg',
      createdBy: u._id,
    });
    await MealPlan.create({ user: u._id, weekStartDate: new Date('2026-01-05') });
    await GroceryList.create({ user: u._id, items: [{ ingredient: 'tomato' }] });
    await DeletionRequest.create({
      user: u._id,
      contactEmail: 'reachme@example.com',
      claimedName: 'Sweep',
      deleteRecipes,
      status: 'scheduled',
      deleteAt,
    });
    return { userId: String(u._id), recipeId: String(recipe._id) };
  }

  it('deletes only past-due requests and respects the Leave/Delete choice', async () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const doomed = await seedUser('doomed@example.com', true, past);
    const kept = await seedUser('kept@example.com', false, past);
    const waiting = await seedUser('waiting@example.com', false, future);

    const result = await processPendingDeletions();
    expect(result).toEqual({ checked: 2, deleted: 2 });

    // deleteRecipes=true: the user, their recipe, plans and lists are gone.
    expect(await User.findById(doomed.userId)).toBeNull();
    expect(await Recipe.findById(doomed.recipeId)).toBeNull();
    expect(await MealPlan.findOne({ user: doomed.userId })).toBeNull();
    expect(await GroceryList.findOne({ user: doomed.userId })).toBeNull();
    // deleteRecipes=false: the user is gone but the recipe survives as a
    // community recipe.
    expect(await User.findById(kept.userId)).toBeNull();
    const keptRecipe = await Recipe.findById(kept.recipeId);
    expect(keptRecipe).not.toBeNull();
    expect(String(keptRecipe!.createdBy)).toBe(String(COMMUNITY_OWNER_ID));
    expect(await MealPlan.findOne({ user: kept.userId })).toBeNull();
    expect(await GroceryList.findOne({ user: kept.userId })).toBeNull();
    // Future-dated: untouched, still scheduled.
    expect(await User.findById(waiting.userId)).not.toBeNull();
    expect(
      (await DeletionRequest.findOne({ user: waiting.userId }))!.status
    ).toBe('scheduled');
    // Completed requests are done.
    expect(
      (await DeletionRequest.findOne({ user: doomed.userId }))!.status
    ).toBe('completed');
    expect(
      (await DeletionRequest.findOne({ user: kept.userId }))!.status
    ).toBe('completed');
  });

  it('is a no-op when nothing is due', async () => {
    expect(await processPendingDeletions()).toEqual({ checked: 0, deleted: 0 });
  });
});
