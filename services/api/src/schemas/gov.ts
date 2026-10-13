import { z } from 'zod';

// Shared NIN validation — Nigerian NIN is exactly 11 digits
const ninSchema = z.string().regex(/^\d{11}$/, 'NIN must be exactly 11 digits');

export const govRegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  nin: ninSchema,
  inviteCode: z.string().min(1, 'Invite code is required'),
  role: z.enum(['OPERATOR', 'ADMIN']).default('OPERATOR'),
});

export const govLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const govInviteCreateSchema = z.object({
  role: z.enum(['OPERATOR', 'ADMIN']),
  expiresInHours: z.number().int().min(1).max(168).default(24),
});

export const govAccountStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
});
