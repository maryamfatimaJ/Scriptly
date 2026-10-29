// Re-exported from ./extraction/ (where it sits alongside the provider
// implementations and shared types) so the integration boundary is also
// reachable at the exact path requested in the project brief:
// server/src/services/extractionService.ts
export { extractPrescription } from "./extraction/extractionService";
export type { ExtractionResult, MedicationCandidate, ExtractionWarning } from "./extraction/types";
