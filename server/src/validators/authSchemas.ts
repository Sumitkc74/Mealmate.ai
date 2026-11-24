import { z } from 'zod';

/**
 * Password floor: 8-128 chars with at least one letter and one number.
 * Rejects the weakest choices (`password1`, `12345678`) without demanding
 * symbols (which mostly push users to write passwords down). Used for
 * register and password reset.
 */
const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v), {
    message: 'Password must contain at least one letter and one number',
  });

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
  // Consent must be explicit: no default. The client renders both checkboxes
  // unchecked and requires them; the API is the enforcement point, so an
  // omitted or false value is rejected here too.
  termsAccepted: z.boolean().refine((v) => v === true, {
    message: 'You must accept the Terms of Service & Privacy Policy',
  }),
  dietaryConsent: z.boolean().refine((v) => v === true, {
    message: 'Dietary consent is required to process dietary and allergy data',
  }),
  marketingOptIn: z.boolean().default(false),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1),
  password: passwordSchema,
});

/**
 * Locked-out account deletion request. `email` is the registered account
 * email; `contactEmail` is where to reach the requester (it may differ —
 * the requester cannot access the registered inbox). `name` and `recipe`
 * are what the requester claims, compared against the real account when
 * the owner reviews a lost-email request. `deleteRecipes` reuses the
 * DELETE /api/auth/me semantics; `cannotAccessEmail` picks the path.
 */
export const requestDeletionSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  contactEmail: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2).max(80),
  recipe: z.string().trim().max(120).optional(),
  deleteRecipes: z.boolean().optional().default(false),
  cannotAccessEmail: z.boolean().optional().default(false),
});

/** A confirmation or approval link token, posted back by the landing page. */
export const deletionTokenSchema = z.object({
  token: z.string().trim().min(1),
});

/**
 * Account deletion recipe choice: when true the user's recipes are deleted
 * with the account; when false or absent they stay in the shared library,
 * reassigned to the community owner. The body itself is optional — a DELETE
 * with no body deletes the account and keeps the recipes.
 */
export const deleteAccountSchema = z
  .object({
    deleteRecipes: z.boolean().optional().default(false),
  })
  .optional()
  .default({});

const pantryItemSchema = z.object({
  ingredient: z.string().trim().toLowerCase().min(1).max(100),
  quantity: z.string().trim().max(20).optional(),
  unit: z.string().trim().toLowerCase().max(20).optional(),
  expiresAt: z.string().optional(),
  category: z.string().trim().max(50).optional(),
});

const cookingHistoryEntrySchema = z.object({
  recipeId: z.string().trim().min(1),
  recipeTitle: z.string().trim().min(1),
  cookedAt: z.string().optional(),
  servingsCooked: z.number().int().positive().optional(),
  rating: z.number().min(1).max(5).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    pantry: z.array(pantryItemSchema).max(500).optional(),
    cookingHistory: z.array(cookingHistoryEntrySchema).max(500).optional(),
    dietaryPreferences: z.array(z.string().trim().max(40)).max(50).optional(),
    allergies: z.array(z.string().trim().max(40)).max(50).optional(),
    marketingOptIn: z.boolean().optional(),
    dietaryConsent: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type RequestDeletionInput = z.infer<typeof requestDeletionSchema>;
export type DeletionTokenInput = z.infer<typeof deletionTokenSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
