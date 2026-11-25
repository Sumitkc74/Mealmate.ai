import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  // Shared secret the ai-service requires as X-AI-Service-Key. Optional
  // (local dev runs without it); production must set the same value on
  // both the server and the ai-service, or AI calls will 401.
  AI_SERVICE_KEY: z.string().optional(),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // Base URL of the frontend, used to build links sent in emails (e.g. the
  // password-reset link). Falls back to CORS_ORIGIN when unset.
  FRONTEND_URL: z.string().url().optional(),
  // Outgoing mail goes through the Resend HTTP API. All optional: when
  // RESEND_API_KEY is missing, mail is disabled and the forgot-password
  // endpoint answers 503 instead of pretending to send. RESEND_FROM is a
  // full "Name <address>" string; without a verified domain Resend only
  // lets the sandbox sender onboarding@resend.dev deliver to the Resend
  // account's own address, so a verified domain is needed to reach
  // arbitrary users. OWNER_EMAIL is where deletion-review requests go.
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().default('MealMate <onboarding@resend.dev>'),
  OWNER_EMAIL: z.string().email().optional(),
  // Legacy Gmail SMTP settings. The mailer no longer uses SMTP (its port
  // is blocked from Render); these stay declared only so OWNER_EMAIL can
  // fall back to the old SMTP_USER. Safe to remove once OWNER_EMAIL is set.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
