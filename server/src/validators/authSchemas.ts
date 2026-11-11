import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
  termsAccepted: z.boolean().default(true),
  dietaryConsent: z.boolean().default(true),
  marketingOptIn: z.boolean().default(false),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
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
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
