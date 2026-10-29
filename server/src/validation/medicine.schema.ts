import { z } from "zod";

// One character is a valid search ("P" lists medicines starting with P);
// results are paginated, so a broad query never loads the whole catalogue.
export const searchMedicinesSchema = z.object({
  q: z.string().trim().min(1, "Type a medicine name to search.").max(200),
  strength: z.string().trim().max(50).optional(),
  form: z.string().trim().max(50).optional(),
  page: z.coerce.number().int().positive().max(10000).optional(),
  pageSize: z.coerce.number().int().positive().max(50).optional(),
  /** Legacy alias for pageSize. */
  limit: z.coerce.number().int().positive().max(50).optional(),
});

export const medicineImageParamsSchema = z.object({
  id: z.string().uuid(),
  imageId: z.string().uuid(),
});

// Price lookup by name. Strength and form are optional, but supplying
// them makes the match STRICTER, not looser — see price.service.ts.
export const priceLookupSchema = z.object({
  name: z.string().trim().min(2, "Enter at least 2 characters.").max(200),
  strength: z.string().trim().max(100).optional(),
  form: z.string().trim().max(100).optional(),
});

export type SearchMedicinesInput = z.infer<typeof searchMedicinesSchema>;
export type PriceLookupInput = z.infer<typeof priceLookupSchema>;
