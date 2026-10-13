import { z } from 'zod';

// Nigerian NIN is exactly 11 digits
const ninSchema = z.string().regex(/^\d{11}$/, 'NIN must be exactly 11 digits');

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required'),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone: z.string().optional(),
  nin: ninSchema,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const resetPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().trim().regex(/^\d{6}$/, 'Code must be exactly 6 digits'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const socialLoginSchema = z.object({
  provider: z.enum(['google', 'apple']),
  idToken: z.string().min(1),
  nonce: z.string().min(16).optional(),
});

export const refreshSchema = z.object({
  userId: z.string().uuid(),
  refreshToken: z.string().min(1),
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(255),
  phone: z.string().trim().max(32).nullable().optional(),
});
