import { z } from 'zod';

/**
 * Multipart form fields arrive as strings — or as empty strings when the client
 * omits an optional value. Hence `z.coerce.number()`: a plain `z.number()`
 * would reject "6.52" outright, because the part is text.
 *
 * `z.coerce.number()` on its own is not enough either, because it maps `''` to
 * `0` — and a latitude of 0 is a real coordinate in the Gulf of Guinea, not
 * "location not provided". The preprocess strips the blanks first, so an
 * absent field stays absent rather than silently becoming a place.
 */
const blankToUndefined = (value: unknown) =>
  value === '' || value === null || value === undefined ? undefined : value;

const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().max(max).optional());

/**
 * The fields accompanying a report submission. Photos are handled separately —
 * they are binary parts, not fields.
 *
 * Latitude and longitude are individually optional so that a failed GPS fix
 * does not block a submission; the route enforces that they arrive together.
 */
export const createReportSchema = z.object({
  categoryId: z.string().uuid(),
  description: optionalText(2000),
  latitude: z.preprocess(
    blankToUndefined,
    z.coerce.number().min(-90).max(90).optional(),
  ),
  longitude: z.preprocess(
    blankToUndefined,
    z.coerce.number().min(-180).max(180).optional(),
  ),
  accuracy: z.preprocess(
    blankToUndefined,
    z.coerce.number().nonnegative().optional(),
  ),
  address: optionalText(500),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;

/** Query parameters for the citizen's own report history. */
export const listReportsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
