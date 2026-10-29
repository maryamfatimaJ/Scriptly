export interface User {
  id: string;
  email: string;
  fullName: string;
  timezone: string;
  createdAt: string;
}

export type PrescriptionStatus =
  | "UPLOADED"
  | "EXTRACTING"
  | "EXTRACTED"
  | "APPROVED"
  | "REJECTED"
  | "NEEDS_CLARIFICATION";

export type MedicationReviewStatus = "NEEDS_REVIEW" | "CONFIRMED" | "NEEDS_CLARIFICATION" | "REJECTED";

export interface ExtractionWarning {
  field?: string;
  message: string;
  severity: "info" | "warning" | "critical";
}

export type ExtractableField =
  | "name"
  | "brand"
  | "genericName"
  | "strength"
  | "form"
  | "route"
  | "dosageInstructions"
  | "instructions"
  | "frequency"
  | "timing"
  | "durationDays"
  | "quantity";

export type FieldConfidenceMap = Partial<Record<ExtractableField, number>>;

/** How each extracted value was obtained — see server/src/services/extraction/types.ts. */
export type FieldSource = "READ" | "UNCERTAIN" | "NOT_VISIBLE" | "INFERRED";
export type FieldSourceMap = Partial<Record<ExtractableField, FieldSource>>;

export type MedicineMatchStatus = "NOT_EVALUATED" | "VERIFIED_MATCH" | "POSSIBLE_MATCH" | "MULTIPLE_MATCHES" | "NO_VERIFIED_RECORD";

export interface MedicineMatchCandidate {
  id: string;
  genericName: string;
  brandName: string | null;
  strength: string | null;
  formulation: string | null;
  manufacturer: string | null;
  score: number;
}

export interface Medication {
  id: string;
  /** Null for a medicine the user added manually. */
  prescriptionId: string | null;
  source?: "PRESCRIPTION" | "MANUAL";
  extractedTiming?: string | null;
  extractedQuantity?: string | null;
  extractionFieldSource?: FieldSourceMap | null;
  confirmedTiming?: string | null;
  confirmedQuantity?: string | null;
  extractedName?: string | null;
  extractedBrand?: string | null;
  extractedGenericName?: string | null;
  extractedStrength?: string | null;
  extractedForm?: string | null;
  extractedRoute?: string | null;
  extractedDosageInstructions?: string | null;
  extractedInstructions?: string | null;
  extractedFrequency?: string | null;
  extractedDurationDays?: number | null;
  extractionConfidence?: number | null;
  extractionFieldConfidence?: FieldConfidenceMap | null;
  extractionWarnings?: ExtractionWarning[] | null;
  confirmedName?: string | null;
  confirmedBrand?: string | null;
  confirmedGenericName?: string | null;
  confirmedStrength?: string | null;
  confirmedForm?: string | null;
  confirmedRoute?: string | null;
  confirmedDosageInstructions?: string | null;
  confirmedInstructions?: string | null;
  confirmedFrequency?: string | null;
  confirmedDurationDays?: number | null;
  reviewStatus: MedicationReviewStatus;
  reviewNotes?: string | null;
  medicineReferenceId?: string | null;
  medicineReference?: MedicineReference | null;
  referenceMatchStatus: MedicineMatchStatus;
  referenceMatchCandidates?: MedicineMatchCandidate[] | null;
  schedules?: { id: string; status: ScheduleStatus }[];
  createdAt: string;
}

export interface Prescription {
  id: string;
  userId: string;
  originalFilename: string;
  mimeType: string;
  status: PrescriptionStatus;
  extractionError?: string | null;
  aiProvider?: string | null;
  extractionOverallConfidence?: number | null;
  extractionOverallWarnings?: ExtractionWarning[] | null;
  extractionLegibility?: "GOOD" | "PARTIAL" | "POOR" | null;
  createdAt: string;
  updatedAt: string;
  medications?: Medication[];
}

export type ReminderStatus = "PENDING" | "TAKEN" | "MISSED" | "SKIPPED";
export type ScheduleStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
export type ReminderDeliveryStatus =
  | "NOT_ATTEMPTED"
  | "PENDING"
  | "SENT"
  | "FAILED"
  | "SKIPPED_NOT_CONFIGURED"
  | "SKIPPED_DISABLED";

// `status` is the DOSE status (taken/missed/etc) — never confused with
// delivery. `due` and `emailStatus` are separate, independent signals:
// a reminder can be due-and-undelivered (no email channel configured) or
// taken-without-ever-being-emailed (the user just used the app).
export interface ScheduleReminder {
  id: string;
  scheduledFor: string;
  status: ReminderStatus;
  respondedAt?: string | null;
  due: boolean;
  /** Unmarked and more than two hours past its time. */
  overdue: boolean;
  /** Its time had passed before the schedule was created; not a missed dose. */
  beforeSchedule: boolean;
  timeOfDay: string;
  label?: string | null;
  medicationId: string;
  medicationName?: string | null;
  dosageInstructions?: string | null;
  scheduleId: string;
  scheduleStatus: ScheduleStatus;
  emailStatus: ReminderDeliveryStatus;
  emailDeliveredAt?: string | null;
}

export interface ScheduleSlot {
  id: string;
  timeOfDay: string;
  label?: string | null;
}

export interface Schedule {
  id: string;
  medicationId: string;
  startDate: string;
  endDate?: string | null;
  status: ScheduleStatus;
  notes?: string | null;
  doseAmount?: string | null;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. Empty means every day. */
  daysOfWeek?: number[];
  remindersEnabled?: boolean;
  createdAt: string;
  slots: ScheduleSlot[];
  medication?: Medication;
}

export type SlotBasis = "WRITTEN_TIME" | "WRITTEN_ANCHOR" | "SUGGESTED";

export interface ScheduleProposal {
  status: "READY" | "NEEDS_TIME_CONFIRMATION" | "NEEDS_CLARIFICATION";
  dosesPerDay: number | null;
  slots: { timeOfDay: string; label: string; basis: SlotBasis }[];
  doseAmount: string | null;
  durationDays: number | null;
  issues: { severity: "info" | "warning" | "critical"; message: string }[];
  startDate: string;
  endDate: string | null;
  timezone: string;
  passedToday: string[];
}

export interface ScheduleSuggestion {
  medicationId: string;
  confirmedName?: string | null;
  confirmedFrequency?: string | null;
  confirmedTiming?: string | null;
  confirmedDosageInstructions?: string | null;
  confirmedDurationDays?: number | null;
  suggestedSlotCount: number | null;
  suggestedLabels: string[];
  requiresManualTiming: boolean;
  note: string;
  proposal: ScheduleProposal;
}

export interface PrescriptionSummary {
  prescriptionId: string;
  status: PrescriptionStatus;
  medicines: Array<{
    medicationId: string;
    name: string | null;
    genericName: string | null;
    strength: string | null;
    form: string | null;
    route: string | null;
    dosageInstructions: string | null;
    frequency: string | null;
    timing: string | null;
    durationDays: number | null;
    quantity: string | null;
    instructions: string | null;
    schedules: Array<{
      id: string;
      status: ScheduleStatus;
      startDate: string;
      endDate: string | null;
      doseAmount: string | null;
      daysOfWeek: number[];
      remindersEnabled: boolean;
      times: { timeOfDay: string; label: string | null }[];
    }>;
    price: PriceLookupResult | null;
  }>;
  removedCount: number;
  outstanding: { medicationId: string | null; name: string | null; reason: string }[];
  reminderDelivery: { emailConfigured: boolean; explanation: string };
}

export interface PrescriptionEvent {
  id: string;
  prescriptionId: string;
  userId?: string | null;
  eventType: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export type DataProvenance = "DRAP" | "OPENFDA" | "WHO_EML" | "RXNORM" | "MANUAL" | "OTHER";
export type VerificationStatus = "VERIFIED" | "UNVERIFIED" | "NEEDS_REVIEW";

export interface MedicineReference {
  id: string;
  genericName: string;
  brandName?: string | null;
  activeIngredient: string;
  strength?: string | null;
  formulation?: string | null;
  manufacturer?: string | null;
  countryOrMarket?: string | null;
  registrationId?: string | null;
  packSize?: string | null;
  referencePrice?: string | null;
  currency?: string | null;
  priceType?: PriceType | null;
  priceSource?: string | null;
  priceSourceUrl?: string | null;
  priceEffectiveFrom?: string | null;
  priceLastVerifiedAt?: string | null;
  sourceUrl?: string | null;
  dataProvenance: DataProvenance;
  verificationStatus: VerificationStatus;
  lastVerifiedAt?: string | null;
  updatedAt: string;
  /** Present on search results only — how well this row matched the query. */
  matchScore?: number;
  matchedOn?: "brandName" | "genericName" | "activeIngredient" | "filter";
  /** Search results only: the first verified product photo, if any. */
  image?: CatalogueImage | null;
}

/** A verified photo of exactly this product, with its attribution. */
export interface CatalogueImage {
  id: string;
  kind: "PACK_BOX" | "BLISTER" | "BOTTLE" | "CONTAINER" | "FORMULATION" | "OTHER";
  /** API-relative path; prefix with the API base URL. */
  url: string;
  width: number;
  height: number;
  sourceName: string;
  sourceUrl: string | null;
  licence: string;
  attribution: string;
  verifiedAt: string;
}

export interface CatalogueSource {
  sourceName: string;
  sourceUrl: string | null;
  fieldsProvided: string[];
  retrievedAt: string;
  permissionBasis: string | null;
}

// --- Medicine information -------------------------------------------------

export type PriceType = "OFFICIAL_MRP" | "RETAILER_LISTED";
export type LabelMarket = "US" | "PAKISTAN" | "INTERNATIONAL";

export interface Monograph {
  id: string;
  ingredientKey: string;
  displayName: string;
  market: LabelMarket;
  uses?: string | null;
  howToUse?: string | null;
  sideEffects?: string | null;
  /** OTC "Stop use and ask a doctor if" — treatment-failure criteria, NOT side effects. */
  whenToStop?: string | null;
  warnings?: string | null;
  precautions?: string | null;
  contraindications?: string | null;
  storage?: string | null;
  sourceName: string;
  sourceUrl?: string | null;
  labelUpdatedAt?: string | null;
  retrievedAt: string;
}

/**
 * Note the three distinct states. "NOT_AVAILABLE" means the source has no
 * label for this medicine; "LOOKUP_FAILED" means we could not reach the
 * source. Collapsing them into one empty state would tell the user
 * something untrue.
 */
export type MonographLookup =
  | { status: "FOUND"; monograph: Monograph; stale: boolean }
  | { status: "NOT_AVAILABLE"; ingredient: string; reason: string }
  | { status: "LOOKUP_FAILED"; ingredient: string; reason: string };

export interface VerifiedPrice {
  medicineId: string;
  brandName: string | null;
  genericName: string;
  activeIngredient: string;
  strength: string | null;
  formulation: string | null;
  packSize: string | null;
  amount: string;
  currency: string;
  priceType: PriceType;
  priceBasis: string;
  sourceName: string | null;
  sourceUrl: string | null;
  effectiveFrom: string | null;
  lastVerifiedAt: string | null;
}

export interface ManualCheckLink {
  label: string;
  url: string;
  note: string;
}

export type PriceLookupResult =
  | { status: "VERIFIED"; price: VerifiedPrice; alternatives: VerifiedPrice[] }
  | {
      status: "UNAVAILABLE";
      query: { name: string; strength?: string | null; form?: string | null };
      reason: string;
      nearMisses: Array<{ name: string; strength: string | null; formulation: string | null; packSize: string | null }>;
      manualCheck: ManualCheckLink[];
    };

export interface MedicineDetail {
  medicine: MedicineReference;
  /** Verified photos of this exact product. Empty = none verified. */
  images: CatalogueImage[];
  /** Other packs of the same product (each its own price). */
  packs: Array<{ id: string; packSize: string | null; price: VerifiedPrice | null }>;
  sources: CatalogueSource[];
  information: MonographLookup;
  price: PriceLookupResult;
  /**
   * Set when the label's dosing text describes a different dosage form
   * from this product (a monograph is keyed by ingredient, so a capsule
   * record can attach to a tablet label). Must be shown, not hidden.
   */
  formMismatch: { productForm: string; labelForms: string[] } | null;
  disclaimer: string;
}

// --- Scripty --------------------------------------------------------------

export interface ScriptyQuickAction {
  id: string;
  label: string;
  message: string;
}

export interface ScriptyPendingAction {
  token: string;
  tool: string;
  summary: string;
  proposal: unknown;
  missingInformation: string[];
}

export interface ScriptyToolResult {
  tool: string;
  data: unknown;
}

export interface ScriptyReply {
  conversationId: string | null;
  reply: string;
  /** Tool results to render as cards under the reply. */
  results: ScriptyToolResult[];
  tool: string | null;
  data: unknown;
  pendingAction?: ScriptyPendingAction;
  toolsUsed: string[];
  quickActions: ScriptyQuickAction[];
  modelComposed: boolean;
  conversationRestarted?: boolean;
  notice?: string;
}

export interface ScheduleProposal {
  medicationId: string;
  medicationName: string | null;
  dosageInstructions: string | null;
  frequency: string | null;
  durationDays: number | null;
  times: string[];
  suggestedSlotCount: number | null;
  missingInformation: string[];
}

export interface ScriptyStatus {
  configured: boolean;
  provider: string;
  model: string | null;
  setupInstructions?: string;
  emailDelivery: string;
}
