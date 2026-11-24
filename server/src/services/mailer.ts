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

/** The inbox the owner reads (and the sender of app mail): the SMTP account. */
export function ownerInbox(): string {
  return env.SMTP_FROM ?? env.SMTP_USER ?? '';
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Send a deletion-confirmation email with the confirm link. Throws on failure. */
export async function sendDeletionConfirmEmail(
  to: string,
  confirmUrl: string
): Promise<void> {
  const from = env.SMTP_FROM ?? env.SMTP_USER ?? 'no-reply@mealmate.app';
  await getTransporter().sendMail({
    from: `MealMate <${from}>`,
    to,
    subject: 'Confirm your MealMate account deletion',
    text:
      `You asked to delete your MealMate account.\n\n` +
      `Confirm it here (the link works for 7 days):\n${confirmUrl}\n\n` +
      `Once confirmed, your account will be deleted 30 days later. Signing in at any point before then cancels the deletion.\n\n` +
      `If you did not ask for this, you can ignore this email — nothing will be deleted.`,
    html:
      `<p>You asked to delete your MealMate account.</p>` +
      `<p><a href="${confirmUrl}">Confirm the deletion</a> (the link works for 7 days).</p>` +
      `<p>Once confirmed, your account will be deleted 30 days later. Signing in at any point before then cancels the deletion.</p>` +
      `<p>If you did not ask for this, you can ignore this email — nothing will be deleted.</p>`,
  });
  logger.info({ to }, 'account deletion confirmation email sent');
}

/** Account details included in the owner's review email, so the request can
 * be judged at a glance without digging in the database. */
export interface DeletionReviewDetails {
  accountEmail: string;
  accountName: string;
  createdAt: Date;
  lastSignInAt?: Date;
  recipeCount: number;
  recipeTitles: string[];
  mealPlanCount: number;
  groceryListCount: number;
  pantryItemCount: number;
  claimedName: string;
  claimedRecipe?: string;
  contactEmail: string;
  deleteRecipes: boolean;
}

/**
 * Send the owner a deletion request to review, with the account's real
 * details next to what the requester claimed. Throws on failure.
 */
export async function sendDeletionReviewEmail(
  to: string,
  details: DeletionReviewDetails,
  approveUrl: string
): Promise<void> {
  const from = env.SMTP_FROM ?? env.SMTP_USER ?? 'no-reply@mealmate.app';
  const recipeLines =
    details.recipeTitles.length > 0
      ? details.recipeTitles.map((t) => `  - ${t}`).join('\n')
      : '  (none)';
  const text =
    `Someone who cannot sign in asked to delete a MealMate account.\n\n` +
    `ACCOUNT (as it actually is):\n` +
    `  Name: ${details.accountName}\n` +
    `  Email: ${details.accountEmail}\n` +
    `  Created: ${formatDate(details.createdAt)}\n` +
    `  Last sign-in: ${details.lastSignInAt ? formatDate(details.lastSignInAt) : 'never'}\n` +
    `  Recipes (${details.recipeCount}):\n${recipeLines}\n` +
    `  Meal plans: ${details.mealPlanCount}\n` +
    `  Grocery lists: ${details.groceryListCount}\n` +
    `  Pantry items: ${details.pantryItemCount}\n\n` +
    `WHAT THE REQUESTER CLAIMED:\n` +
    `  Name: ${details.claimedName}\n` +
    `  A recipe they created: ${details.claimedRecipe ?? '(not given)'}\n` +
    `  Contact email: ${details.contactEmail}\n` +
    `  Recipes on deletion: ${details.deleteRecipes ? 'Delete them' : 'Leave them as community recipes'}\n\n` +
    `If the claim matches the account, approve it here (the link works for 7 days):\n${approveUrl}\n\n` +
    `Once approved, the requester and the account owner are both emailed, and the account is deleted 30 days later unless the owner signs in. If the claim does not match, ignore this email — nothing happens.`;
  await getTransporter().sendMail({
    from: `MealMate <${from}>`,
    to,
    subject: `Account deletion request to review: ${details.accountEmail}`,
    text,
    html:
      `<p>Someone who cannot sign in asked to delete a MealMate account.</p>` +
      `<p><strong>Account (as it actually is):</strong><br/>` +
      `Name: ${details.accountName}<br/>` +
      `Email: ${details.accountEmail}<br/>` +
      `Created: ${formatDate(details.createdAt)}<br/>` +
      `Last sign-in: ${details.lastSignInAt ? formatDate(details.lastSignInAt) : 'never'}<br/>` +
      `Recipes (${details.recipeCount}): ${details.recipeTitles.join(', ') || '(none)'}<br/>` +
      `Meal plans: ${details.mealPlanCount}<br/>` +
      `Grocery lists: ${details.groceryListCount}<br/>` +
      `Pantry items: ${details.pantryItemCount}</p>` +
      `<p><strong>What the requester claimed:</strong><br/>` +
      `Name: ${details.claimedName}<br/>` +
      `A recipe they created: ${details.claimedRecipe ?? '(not given)'}<br/>` +
      `Contact email: ${details.contactEmail}<br/>` +
      `Recipes on deletion: ${details.deleteRecipes ? 'Delete them' : 'Leave them as community recipes'}</p>` +
      `<p>If the claim matches the account, <a href="${approveUrl}">approve it here</a> (the link works for 7 days).</p>` +
      `<p>Once approved, the requester and the account owner are both emailed, and the account is deleted 30 days later unless the owner signs in. If the claim does not match, ignore this email — nothing happens.</p>`,
  });
  logger.info({ to }, 'account deletion review email sent');
}

/**
 * Tell the requester their deletion was approved. NO sign-in link: the
 * requester cannot sign in (no password), so a link would be useless.
 * Replying to this email is how they change their mind.
 */
export async function sendDeletionApprovedToRequester(
  to: string,
  deleteAt: Date
): Promise<void> {
  const from = env.SMTP_FROM ?? env.SMTP_USER ?? 'no-reply@mealmate.app';
  await getTransporter().sendMail({
    from: `MealMate <${from}>`,
    to,
    subject: 'Your MealMate account deletion was approved',
    text:
      `Your request to delete your MealMate account was approved.\n\n` +
      `The account will be deleted on ${formatDate(deleteAt)}.\n\n` +
      `If you change your mind, reply to this email and the deletion will be cancelled.`,
    html:
      `<p>Your request to delete your MealMate account was approved.</p>` +
      `<p>The account will be deleted on ${formatDate(deleteAt)}.</p>` +
      `<p>If you change your mind, reply to this email and the deletion will be cancelled.</p>`,
  });
  logger.info({ to }, 'account deletion approved email sent to requester');
}

/**
 * Warn the account owner that a deletion was approved for their account.
 * WITH a sign-in link: the owner can use it (they have the password, or
 * can reset it through this inbox) to sign in and cancel the deletion.
 */
export async function sendDeletionApprovedToAccountOwner(
  to: string,
  deleteAt: Date,
  signInUrl: string
): Promise<void> {
  const from = env.SMTP_FROM ?? env.SMTP_USER ?? 'no-reply@mealmate.app';
  await getTransporter().sendMail({
    from: `MealMate <${from}>`,
    to,
    subject: 'A MealMate account deletion was approved for your account',
    text:
      `A deletion was requested and approved for your MealMate account.\n\n` +
      `It will be deleted on ${formatDate(deleteAt)}. If this wasn't you, sign in now to cancel it:\n${signInUrl}\n\n` +
      `Signing in at any point before then cancels the deletion.`,
    html:
      `<p>A deletion was requested and approved for your MealMate account.</p>` +
      `<p>It will be deleted on ${formatDate(deleteAt)}. If this wasn't you, <a href="${signInUrl}">sign in now to cancel it</a>.</p>` +
      `<p>Signing in at any point before then cancels the deletion.</p>`,
  });
  logger.info({ to }, 'account deletion approved email sent to account owner');
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
