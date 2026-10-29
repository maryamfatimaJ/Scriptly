import { apiRequest } from "./client";
import type { Medication, MedicationReviewStatus, MonographLookup, PriceLookupResult } from "@/types";

export interface UpdateMedicationPayload {
  confirmedName?: string;
  confirmedBrand?: string;
  confirmedGenericName?: string;
  confirmedStrength?: string;
  confirmedForm?: string;
  confirmedRoute?: string;
  confirmedDosageInstructions?: string;
  confirmedInstructions?: string;
  confirmedFrequency?: string;
  confirmedDurationDays?: number;
  confirmedTiming?: string;
  confirmedQuantity?: string;
  reviewStatus: MedicationReviewStatus;
  reviewNotes?: string;
  /** Pick a specific reference from this medication's own suggested candidates, or null to clear. */
  medicineReferenceId?: string | null;
}

export interface ManualMedicationPayload {
  name: string;
  genericName?: string;
  strength?: string;
  form?: string;
  route?: string;
  dosageInstructions: string;
  frequency: string;
  timing?: string;
  instructions?: string;
  durationDays?: number;
}

/** A medicine the user adds themselves, without uploading a prescription. */
export function createManualMedication(payload: ManualMedicationPayload) {
  return apiRequest<{ medication: Medication }>("/medications", { method: "POST", body: payload });
}

export function listMedications() {
  return apiRequest<{ medications: Medication[] }>("/medications");
}

export function updateMedication(id: string, payload: UpdateMedicationPayload) {
  return apiRequest<{ medication: Medication }>(`/medications/${id}`, { method: "PATCH", body: payload });
}

export interface MedicationInformation {
  medicationId: string;
  medicineName: string | null;
  activeIngredient: string | null;
  isConfirmed: boolean;
  information: MonographLookup;
  marketNote?: string;
}

export interface MedicationPrice {
  medicationId: string;
  medicineName: string;
  isConfirmed: boolean;
  price: PriceLookupResult;
}

/** Sourced label information for one of the user's own medications. */
export function getMedicationInformation(id: string) {
  return apiRequest<MedicationInformation>(`/medications/${id}/information`);
}

/** Pakistan price lookup for one of the user's own medications. */
export function getMedicationPrice(id: string) {
  return apiRequest<MedicationPrice>(`/medications/${id}/price`);
}

/** Removes a medicine (and its schedules and reminders) from the account. */
export function deleteMedication(id: string) {
  return apiRequest<void>(`/medications/${id}`, { method: "DELETE" });
}
