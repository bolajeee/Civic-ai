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
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshSchema = z.object({
  userId: z.string().uuid(),
  refreshToken: z.string().min(1),
});
