import { z } from 'zod';

const blankToUndefined = (value: unknown) =>
  value === '' || value === null || value === undefined ? undefined : value;

/** Query parameters for the address/landmark search proxy. */
export const locationSearchSchema = z.object({
  q: z.string().trim().min(2).max(200),
  limit: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(10).default(5),
  ),
  lat: z.preprocess(
    blankToUndefined,
    z.coerce.number().min(-90).max(90).optional(),
  ),
  lon: z.preprocess(
    blankToUndefined,
    z.coerce.number().min(-180).max(180).optional(),
  ),
});

export type LocationSearchInput = z.infer<typeof locationSearchSchema>;
