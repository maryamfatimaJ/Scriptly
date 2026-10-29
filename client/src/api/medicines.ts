import { apiRequest, BASE_URL } from "./client";
import type { MedicineDetail, MedicineReference, PriceLookupResult } from "@/types";

export interface MedicineSearchResponse {
  query: string;
  /** How the server read the query: name, plus any strength/form it recognised. */
  interpreted: { name: string; strength: string | null; form: string | null };
  /** Total matches across all pages. */
  count: number;
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  medicines: MedicineReference[];
}

export function searchMedicines(query: string, page = 1, pageSize = 20) {
  const params = new URLSearchParams({ q: query, page: String(page), pageSize: String(pageSize) });
  return apiRequest<MedicineSearchResponse>(`/medicines/search?${params.toString()}`);
}

/** Absolute URL for a catalogue image path returned by the API. */
export function catalogueImageUrl(path: string) {
  return `${BASE_URL}${path}`;
}

export function getMedicine(id: string) {
  return apiRequest<MedicineDetail>(`/medicines/${id}`);
}

export function lookupPrice(input: { name: string; strength?: string | null; form?: string | null }) {
  const params = new URLSearchParams({ name: input.name });
  if (input.strength) params.set("strength", input.strength);
  if (input.form) params.set("form", input.form);
  return apiRequest<{ price: PriceLookupResult }>(`/medicines/price?${params.toString()}`);
}
