import {
  isMailConfigured,
  ownerInbox,
  frontendBaseUrl,
  sendPasswordResetEmail,
  sendDeletionConfirmEmail,
  sendDeletionReviewEmail,
  sendDeletionApprovedToRequester,
  sendDeletionApprovedToAccountOwner,
  type DeletionReviewDetails,
} from '../services/mailer';

/**
 * The mailer reads env at call time, so the mocked env object is mutated
 * per test (via the imported handle below) and the mailer sees the change.
 * The factory defines the object inline: referencing an outer variable
 * from a hoisted jest.mock factory throws "Cannot access before
 * initialization".
 */
jest.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
    SENDGRID_API_KEY: 'SG.test_key',
    SENDGRID_FROM: 'MealMate <mealmate.ai1@gmail.com>',
    OWNER_EMAIL: 'owner@example.com',
    SMTP_USER: undefined,
    FRONTEND_URL: undefined,
    CORS_ORIGIN: 'http://localhost:3000',
  },
}));
import { env as mockEnv } from '../config/env';

const mockedFetch = jest.fn();
const originalFetch = global.fetch;

const okResponse = {
  ok: true,
  status: 202,
  text: async () => '',
} as unknown as Response;

function postedUrl(): string {
  return mockedFetch.mock.calls[0]?.[0] as string;
}

function postedInit(): RequestInit {
  return mockedFetch.mock.calls[0]?.[1] as RequestInit;
}

function postedBody(): Record<string, unknown> {
  return JSON.parse(String(postedInit().body));
}

function postedTo(): string {
  const body = postedBody();
  const personalizations = body.personalizations as Array<{ to: Array<{ email: string }> }>;
  const first = personalizations[0];
  if (!first) throw new Error('no personalizations in SendGrid payload');
  const to = first.to[0];
  if (!to) throw new Error('no to in SendGrid payload');
  return to.email;
}

function postedFrom(): { name?: string; email: string } {
  return postedBody().from as { name?: string; email: string };
}

function postedContent(type: string): string {
  const body = postedBody();
  const content = body.content as Array<{ type: string; value: string }>;
  return content.find((c) => c.type === type)?.value ?? '';
}

const reviewDetails: DeletionReviewDetails = {
  accountEmail: 'deleter@example.com',
  accountName: 'Deleter',
  createdAt: new Date('2026-01-15T12:00:00.000Z'),
  lastSignInAt: new Date('2026-11-20T12:00:00.000Z'),
  recipeCount: 1,
  recipeTitles: ['DelReq Test Soup'],
  mealPlanCount: 2,
  groceryListCount: 1,
  pantryItemCount: 3,
  claimedName: 'Deleter',
  claimedRecipe: 'DelReq Test Soup',
  contactEmail: 'requester@example.com',
  deleteRecipes: false,
};

beforeEach(() => {
  mockedFetch.mockReset();
  mockedFetch.mockResolvedValue(okResponse);
  global.fetch = mockedFetch as typeof fetch;
  mockEnv.SENDGRID_API_KEY = 'SG.test_key';
  mockEnv.SENDGRID_FROM = 'MealMate <mealmate.ai1@gmail.com>';
  mockEnv.OWNER_EMAIL = 'owner@example.com';
  mockEnv.SMTP_USER = undefined;
  mockEnv.FRONTEND_URL = undefined;
  mockEnv.CORS_ORIGIN = 'http://localhost:3000';
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('mailer (SendGrid transport)', () => {
  it('isMailConfigured is true only with a SendGrid key — SMTP vars do not count', () => {
    expect(isMailConfigured()).toBe(true);
    mockEnv.SENDGRID_API_KEY = undefined;
    // Even with the old SMTP credentials present, mail is not configured.
    mockEnv.SMTP_HOST = 'smtp.gmail.com';
    mockEnv.SMTP_USER = 'smtp@example.com';
    mockEnv.SMTP_PASS = 'app-password';
    expect(isMailConfigured()).toBe(false);
  });

  it('ownerInbox prefers OWNER_EMAIL, falls back to the old SMTP_USER, else empty', () => {
    expect(ownerInbox()).toBe('owner@example.com');
    mockEnv.OWNER_EMAIL = undefined;
    mockEnv.SMTP_USER = 'smtp@example.com';
    expect(ownerInbox()).toBe('smtp@example.com');
    mockEnv.SMTP_USER = undefined;
    expect(ownerInbox()).toBe('');
  });

  it('frontendBaseUrl prefers FRONTEND_URL, then the first CORS origin', () => {
    mockEnv.FRONTEND_URL = 'https://mealmate-ai-three.vercel.app';
    expect(frontendBaseUrl()).toBe('https://mealmate-ai-three.vercel.app');
    mockEnv.FRONTEND_URL = undefined;
    mockEnv.CORS_ORIGIN = 'https://a.example.com, https://b.example.com';
    expect(frontendBaseUrl()).toBe('https://a.example.com');
  });

  it('sendPasswordResetEmail posts to SendGrid v3 with the Bearer key and the reset link', async () => {
    await sendPasswordResetEmail('reset@example.com', 'https://app.example.com/reset-password?token=abc');
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(postedUrl()).toBe('https://api.sendgrid.com/v3/mail/send');
    const init = postedInit();
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer SG.test_key',
      'Content-Type': 'application/json',
    });
    // Fail-fast: the call carries an abort signal so a hanging send errors
    // in seconds instead of hanging the request for minutes as SMTP did.
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = postedBody();
    expect(postedTo()).toBe('reset@example.com');
    expect(postedFrom()).toEqual({ name: 'MealMate', email: 'mealmate.ai1@gmail.com' });
    expect(body.subject).toBe('Reset your MealMate password');
    expect(postedContent('text/plain')).toContain('https://app.example.com/reset-password?token=abc');
    expect(postedContent('text/html')).toContain('https://app.example.com/reset-password?token=abc');
  });

  it('a bare SENDGRID_FROM address is sent without a name', async () => {
    mockEnv.SENDGRID_FROM = 'mealmate.ai1@gmail.com';
    await sendPasswordResetEmail('reset@example.com', 'https://app.example.com/reset-password?token=abc');
    expect(postedFrom()).toEqual({ email: 'mealmate.ai1@gmail.com' });
  });

  it('sendDeletionConfirmEmail posts the confirm link with the right subject', async () => {
    await sendDeletionConfirmEmail('deleter@example.com', 'https://app.example.com/confirm-deletion?token=abc');
    expect(postedTo()).toBe('deleter@example.com');
    expect(postedBody().subject).toBe('Confirm your MealMate account deletion');
    expect(postedContent('text/plain')).toContain('https://app.example.com/confirm-deletion?token=abc');
    expect(postedContent('text/html')).toContain('https://app.example.com/confirm-deletion?token=abc');
  });

  it('sendDeletionReviewEmail posts the real account details next to the claim', async () => {
    await sendDeletionReviewEmail(
      'owner@example.com',
      reviewDetails,
      'https://app.example.com/approve-deletion?token=abc'
    );
    expect(postedTo()).toBe('owner@example.com');
    expect(postedBody().subject).toBe('Account deletion request to review: deleter@example.com');
    expect(postedContent('text/plain')).toContain('Deleter');
    expect(postedContent('text/plain')).toContain('DelReq Test Soup');
    expect(postedContent('text/plain')).toContain('requester@example.com');
    expect(postedContent('text/plain')).toContain('https://app.example.com/approve-deletion?token=abc');
    expect(postedContent('text/html')).toContain('https://app.example.com/approve-deletion?token=abc');
  });

  it('sendDeletionApprovedToRequester has no sign-in link', async () => {
    // Noon UTC so the formatted date is December 23 in every timezone.
    await sendDeletionApprovedToRequester('requester@example.com', new Date('2026-12-23T12:00:00.000Z'));
    expect(postedTo()).toBe('requester@example.com');
    expect(postedBody().subject).toBe('Your MealMate account deletion was approved');
    expect(postedContent('text/plain')).toContain('December 23, 2026');
    expect(postedContent('text/plain')).not.toContain('/login');
    expect(postedContent('text/html')).not.toContain('/login');
  });

  it('sendDeletionApprovedToAccountOwner includes the sign-in link', async () => {
    await sendDeletionApprovedToAccountOwner(
      'deleter@example.com',
      new Date('2026-12-23T12:00:00.000Z'),
      'https://app.example.com/login'
    );
    expect(postedTo()).toBe('deleter@example.com');
    expect(postedBody().subject).toBe('A MealMate account deletion was approved for your account');
    expect(postedContent('text/plain')).toContain('December 23, 2026');
    expect(postedContent('text/plain')).toContain('https://app.example.com/login');
    expect(postedContent('text/html')).toContain('https://app.example.com/login');
  });

  it('throws on a non-2xx SendGrid response instead of pretending the mail went out', async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'The from address does not match a verified Sender Identity',
    } as unknown as Response);
    await expect(
      sendPasswordResetEmail('reset@example.com', 'https://app.example.com/reset-password?token=abc')
    ).rejects.toThrow(/403/);
  });

  it('propagates a fetch failure (timeout / network error)', async () => {
    mockedFetch.mockRejectedValue(new Error('fetch failed'));
    await expect(
      sendPasswordResetEmail('reset@example.com', 'https://app.example.com/reset-password?token=abc')
    ).rejects.toThrow('fetch failed');
  });
});
