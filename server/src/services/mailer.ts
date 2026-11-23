import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../config/logger';

let transporter: Transporter | null = null;

/** True when SMTP credentials are configured; otherwise mail is disabled. */
export function isMailConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }
  return transporter;
}

/**
 * Base URL of the frontend, used to build links sent in emails.
 * CORS_ORIGIN is a comma-separated list, so it can never be used verbatim:
 * with several origins the reset link would be malformed. Use only the
 * first origin as the fallback, and prefer FRONTEND_URL (required when mail
 * is configured — see isMailConfigured).
 */
export function frontendBaseUrl(): string {
  if (env.FRONTEND_URL) return env.FRONTEND_URL;
  return env.CORS_ORIGIN.split(',')[0]?.trim() || 'http://localhost:3000';
}

/** Send a password-reset email with the reset link. Throws on failure. */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const from = env.SMTP_FROM ?? env.SMTP_USER ?? 'no-reply@mealmate.app';
  await getTransporter().sendMail({
    from: `MealMate <${from}>`,
    to,
    subject: 'Reset your MealMate password',
    text:
      `You asked to reset your MealMate password.\n\n` +
      `Reset it here (the link works for 1 hour):\n${resetUrl}\n\n` +
      `If you did not ask for this, you can ignore this email — your password will not change.`,
    html:
      `<p>You asked to reset your MealMate password.</p>` +
      `<p><a href="${resetUrl}">Reset your password</a> (the link works for 1 hour).</p>` +
      `<p>If you did not ask for this, you can ignore this email — your password will not change.</p>`,
  });
  logger.info({ to }, 'password reset email sent');
}
