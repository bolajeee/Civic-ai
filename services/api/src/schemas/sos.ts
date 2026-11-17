import { z } from 'zod';
import { EMERGENCY_TYPES } from '../lib/sos-messages';

const blankToUndefined = (value: unknown) =>
  value === '' || value === null || value === undefined ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

export const emergencyTypeSchema = z.enum(EMERGENCY_TYPES);

export const createContactSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(7).max(25),
  relationship: optionalText(40),
}).strict();

export const updateContactSchema = createContactSchema.partial().strict()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');

export const contactIdSchema = z.string().uuid();

export const nearbySchema = z.object({
  type: emergencyTypeSchema,
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

export const createAlertSchema = z.object({
  clientAlertId: z.string().uuid(),
  type: emergencyTypeSchema,
  updateIntervalMinutes: z.union([z.literal(15), z.literal(30)]).default(30),
  lat: latitude.optional(),
  lon: longitude.optional(),
  accuracy: z.number().nonnegative().optional(),
  address: optionalText(500),
  note: optionalText(280),
}).strict().refine(
  (value) => (value.lat === undefined) === (value.lon === undefined),
  'lat and lon must be provided together',
);

export const locationUpdateSchema = z.object({
  lat: latitude,
  lon: longitude,
  accuracy: z.number().nonnegative().optional(),
  address: optionalText(500),
  recordedAt: z.string().datetime({ offset: true }).optional(),
}).strict();

export const alertPublicIdSchema = z.string().regex(/^SOS-\d+$/, 'Invalid alert reference');

/** 16 random bytes, base64url-encoded. */
export const shareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/, 'Invalid tracking link');
