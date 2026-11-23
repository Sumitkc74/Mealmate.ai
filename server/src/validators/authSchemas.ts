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
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
