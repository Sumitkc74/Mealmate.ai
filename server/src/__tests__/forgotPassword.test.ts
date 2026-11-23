import request from 'supertest';
import { createApp } from '../app';
import { connectInMemoryDB, clearDB, disconnectInMemoryDB } from '../test/db';
import { User } from '../models/User';
import { isMailConfigured, sendPasswordResetEmail } from '../services/mailer';

jest.mock('../services/mailer', () => ({
  isMailConfigured: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  frontendBaseUrl: jest.fn(() => 'http://localhost:3000'),
}));

const mockedIsMailConfigured = isMailConfigured as jest.Mock;
const mockedSendMail = sendPasswordResetEmail as jest.Mock;

const app = createApp();

const user = { name: 'Reset Test', email: 'reset@example.com', password: 'oldpassword123' };

beforeAll(async () => {
  await connectInMemoryDB();
});

beforeEach(async () => {
  mockedIsMailConfigured.mockReset();
  mockedSendMail.mockReset();
  mockedSendMail.mockResolvedValue(undefined);
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

function tokenFromMailCall(): string {
  const url = mockedSendMail.mock.calls[0][1] as string;
  return new URL(url).searchParams.get('token') as string;
}

describe('Forgot password', () => {
  it('returns 503 when mail is not configured', async () => {
    mockedIsMailConfigured.mockReturnValue(false);
    const res = await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    expect(res.status).toBe(503);
    expect(mockedSendMail).not.toHaveBeenCalled();
  });

  it('sends a reset link for a registered email and stores a hashed token', async () => {
    mockedIsMailConfigured.mockReturnValue(true);
    const res = await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/If an account exists/i);
    expect(mockedSendMail).toHaveBeenCalledTimes(1);
    expect(mockedSendMail.mock.calls[0][0]).toBe(user.email);
    const stored = await User.findOne({ email: user.email }).select(
      '+passwordResetToken +passwordResetExpires'
    );
    expect(stored?.passwordResetToken).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.passwordResetExpires?.getTime()).toBeGreaterThan(Date.now());
    expect(tokenFromMailCall()).toHaveLength(64);
  });

  it('answers the same for an unknown email and sends nothing', async () => {
    mockedIsMailConfigured.mockReturnValue(true);
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/If an account exists/i);
    expect(mockedSendMail).not.toHaveBeenCalled();
  });
});

describe('Reset password', () => {
  async function requestResetToken(): Promise<string> {
    mockedIsMailConfigured.mockReturnValue(true);
    await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    return tokenFromMailCall();
  }

  it('resets with a valid token and the new password works', async () => {
    const token = await requestResetToken();
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'newpassword123' , termsAccepted: true, dietaryConsent: true });
    expect(res.status).toBe(200);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'newpassword123' , termsAccepted: true, dietaryConsent: true });
    expect(login.status).toBe(200);
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password });
    expect(oldLogin.status).toBe(401);
  });

  it('rejects reusing a token', async () => {
    const token = await requestResetToken();
    await request(app).post('/api/auth/reset-password').send({ token, password: 'newpassword123' , termsAccepted: true, dietaryConsent: true });
    const again = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'anotherpass123' , termsAccepted: true, dietaryConsent: true });
    expect(again.status).toBe(400);
  });

  it('rejects a bogus token', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'deadbeef', password: 'newpassword123' , termsAccepted: true, dietaryConsent: true });
    expect(res.status).toBe(400);
  });

  it('rejects an expired token', async () => {
    const token = await requestResetToken();
    await User.updateOne(
      { email: user.email },
      { passwordResetExpires: new Date(Date.now() - 1000) }
    );
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'newpassword123' , termsAccepted: true, dietaryConsent: true });
    expect(res.status).toBe(400);
  });

  it('rejects a short new password', async () => {
    const token = await requestResetToken();
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'short' , termsAccepted: true, dietaryConsent: true });
    expect(res.status).toBe(400);
  });
});
