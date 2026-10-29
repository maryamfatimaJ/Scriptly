# The extraction pipeline

This document explains how a prescription actually moves from an upload
to a reviewable set of medication candidates, and where every safety
rule from the brief ("never guess", "no auto-approval", "match ≠
substitute") is actually enforced in code — not just described.

## End-to-end flow

1. **Capture** (`client/src/pages/CapturePrescription.tsx`) — camera or
   file upload, with a client-side MIME/basic-resolution check
   (`checkImageQuality`) that warns (never blocks) on a very
   low-resolution photo.
2. **Upload** (`POST /api/prescriptions`) — `upload.middleware.ts`
   validates MIME type (JPG/PNG/WEBP/PDF) and size
   (`MAX_UPLOAD_SIZE_MB`) before the file ever touches disk; it's saved
   under `UPLOAD_DIR` with a randomly generated filename (never the
   user's original filename) and the DB row records the path — a path
   that is **never** returned to any API response (see
   `sanitizePrescription` in `prescription.service.ts`). The only way to
   ever see the bytes again is the authenticated, ownership-checked
   `GET /api/prescriptions/:id/image`.
3. **Extraction claim** (`POST /api/prescriptions/:id/extract`,
   `prescription.service.ts::runExtraction`) — before calling any
   provider:
   - Refuses outright if the prescription is already `APPROVED`/
     `REJECTED` (finalized).
   - Refuses if any medication from a *previous* extraction attempt has
     already been reviewed (`CONFIRMED`/`REJECTED`/
     `NEEDS_CLARIFICATION`) — re-extracting would silently discard a
     human's review work.
   - Atomically claims the extraction slot with a conditional
     `updateMany` (`status: EXTRACTING` only succeeds if the row was
     still in an extractable status), so two concurrent `/extract` calls
     can't both proceed and create duplicate medications.
   - Clears any leftover `NEEDS_REVIEW` medications from a prior,
     un-reviewed attempt — this is what makes retrying after a bad
     extraction safe instead of additive.
4. **Provider call** (`extractionService.ts` → whichever provider
   `AI_PROVIDER` selects) — returns `MedicationCandidate[]` plus
   prescription-level `confidence`/`warnings`. The pipeline then applies
   `CONFIDENCE_THRESHOLD_LOW`/`_HIGH` (`config/env.ts`) uniformly across
   whichever provider ran, adding its own warning when a field's
   confidence is low/moderate — this is deliberately pipeline-level, not
   provider-level, so the thresholds apply consistently regardless of
   which provider is active.
5. **Medicine-reference matching** (`medicineMatching.service.ts`) — runs
   once per candidate, in parallel, **before** anything is written to the
   database. Name similarity (character-bigram Dice coefficient) alone is
   never enough: `VERIFIED_MATCH` (the only status that auto-links a
   `medicineReferenceId`) additionally requires strength and formulation
   to match exactly. Anything less becomes `POSSIBLE_MATCH` or
   `MULTIPLE_MATCHES` — left for the human reviewer to pick from
   (`MedicineMatchPanel.tsx`) — or `NO_VERIFIED_RECORD` if nothing clears
   `MEDICINE_MATCH_MIN_SCORE`.
6. **Persist** — one `Medication` row per candidate, with
   `extracted*` fields set from the provider's output and `confirmed*`
   fields left `null` (they're only ever set by a human, in
   `medication.service.ts::updateMedication`), plus the match result and
   `reviewStatus: NEEDS_REVIEW`. The prescription's own
   `extractionOverallConfidence`/`extractionOverallWarnings` are recorded
   separately from any one medication's confidence/warnings.
7. **Review** (`ReviewPrescription.tsx` /
   `MedicationReviewCard.tsx`) — original image (zoomable) alongside
   editable fields with per-field confidence dots, the medicine-reference
   match, and warnings. Confirming a medication
   (`reviewStatus: CONFIRMED`) is rejected by both client and server
   validation unless it has a name. A dose or frequency that isn't written
   stays empty rather than being filled in; the confirmed card tells the
   user to ask a doctor or pharmacist, and with no frequency the schedule
   planner proposes no times. "High confidence" is never treated as a
   substitute for the human confirmation.
8. **Approve** (`POST /api/prescriptions/:id/approve`) — refused unless
   every medication on the prescription is `CONFIRMED` or `REJECTED` (no
   `NEEDS_REVIEW`/`NEEDS_CLARIFICATION` left outstanding), and refused if
   there are zero medications at all.
9. **Schedule** (`schedule.service.ts::createSchedule`) — refused unless
   the target medication's `reviewStatus` is `CONFIRMED`. This is the
   same rule from Part 1, re-verified here because the richer schema
   didn't get to bypass it.

## Audit trail

Every state transition is logged to `PrescriptionEvent`: `CREATED`,
`EXTRACTION_STARTED`/`_COMPLETED`/`_FAILED`/`_RETRY_BLOCKED`,
`MEDICINE_MATCHING_COMPLETED`, `APPROVED`, `REJECTED`,
`CLARIFICATION_REQUESTED`, `MEDICATION_UPDATED` (with a field-level
before/after diff — see `AUDITED_FIELDS` in `medication.service.ts`),
`SCHEDULE_CREATED`, `REMINDER_UPDATED`. The original image and the raw
per-field `extracted*` values are never mutated after extraction — only
the parallel `confirmed*` columns change, so what the AI actually said
is always still there to compare against.

## What this pipeline does *not* do (by design)

- Never overwrites an extracted/confirmed value with a medicine-reference
  lookup result.
- Never auto-selects a medicine-reference match unless name, strength,
  and formulation all agree.
- Never fabricates a missing field — an unreadable/ambiguous field is
  left `null` with a warning, not guessed.
- Never treats a high confidence score as medical correctness — it's a
  UI signal, not a verification.
