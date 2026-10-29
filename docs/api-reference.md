# API reference

Base URL: `http://localhost:4000/api` (dev). All endpoints except
`GET /auth/csrf-token`, `POST /auth/register`, `POST /auth/login`, and
`POST /auth/refresh` require an authenticated session (httpOnly
`access_token` cookie). All `POST`/`PATCH` requests additionally require
an `x-csrf-token` header matching the token from `GET /auth/csrf-token`
(see `client/src/api/client.ts` for the reference implementation).

Every response that returns a known failure uses the shape
`{ "error": { "code": string, "message": string, "details"?: unknown } }`.

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/auth/csrf-token` | — | Returns `{ csrfToken }`; also sets the readable `csrf_token` cookie. Call before any mutating request. |
| POST | `/auth/register` | `{ email, password, fullName, timezone? }` | `timezone` is an IANA name (e.g. `Asia/Karachi`); defaults to `UTC` if omitted. Sets auth cookies. |
| POST | `/auth/login` | `{ email, password }` | Sets auth cookies. |
| POST | `/auth/refresh` | — (uses `refresh_token` cookie) | Rotates the refresh token. |
| POST | `/auth/logout` | — | Revokes the current session. |
| GET | `/auth/me` | — | Returns `{ user }` or 401. |
| PATCH | `/auth/me` | `{ fullName?, timezone? }` | Updates the profile. Rejects an invalid IANA timezone. |

## Prescriptions

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/prescriptions` | multipart, field `prescriptionImage` | JPG/PNG/WEBP/PDF only, ≤`MAX_UPLOAD_SIZE_MB`. |
| GET | `/prescriptions` | — | Lists the caller's own prescriptions. |
| GET | `/prescriptions/:id` | — | Ownership-checked; 404 if not yours. |
| GET | `/prescriptions/:id/image` | — | Streams the original file. The **only** way to ever retrieve it — never a public/static URL. |
| GET | `/prescriptions/:id/events` | — | Full audit-trail event log for the History view. |
| GET | `/prescriptions/:id/summary` | — | What was actually saved for a prescription: confirmed medicines and instructions, their schedules and reminder times, a price lookup per medicine (VERIFIED with source and dates, or UNAVAILABLE), outstanding items (medicines marked uncertain, medicines without a schedule) and reminder-delivery status. Owner only. |
| POST | `/prescriptions/:id/extract` | — | Runs `AI_PROVIDER`. Idempotent before review; 409 if already reviewed or finalized, or if extraction is already in progress. |
| POST | `/prescriptions/:id/approve` | — | 422 unless every medication is `CONFIRMED` or `REJECTED`. |
| DELETE | `/prescriptions/:id` | — | 204. Deletes the prescription, its medicines (and their schedules/reminders), its event trail and the uploaded image file. 404 for another user's id. |
| POST | `/prescriptions/:id/reject` | `{ reason? }` | |
| POST | `/prescriptions/:id/request-clarification` | `{ note }` | `note` required, non-empty. |

## Medications

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/medications` | — | All of the caller's medications, with prescription status, medicine-reference match, and `schedules[]` (id + status). |
| POST | `/medications` | `{ name, dosageInstructions, frequency, strength?, form?, genericName?, route?, timing?, instructions?, durationDays? }` | Adds a medicine without a prescription (`source: MANUAL`, `prescriptionId: null`). Created CONFIRMED by the user themselves; name, dose and frequency are required. |
| GET | `/medications/:id/schedule-preview` | — | 422 unless `CONFIRMED`. Returns `{ preview: { suggestedSlotCount, ..., proposal } }`. `proposal` is the schedule prepared from the confirmed instructions: `status` (READY / NEEDS_TIME_CONFIRMATION / NEEDS_CLARIFICATION), `slots[]` each with `basis` (WRITTEN_TIME, WRITTEN_ANCHOR, SUGGESTED), `doseAmount`, `durationDays`, `startDate`, `endDate`, `passedToday`, and `issues[]`. NEEDS_CLARIFICATION proposes no times. Nothing is saved by this call. |
| GET | `/medications/:id/information` | — | Sourced label information for one of the caller's own medications. Resolves the ingredient from the medication row (preferring the generic name) and returns `{ medicineName, activeIngredient, isConfirmed, information, marketNote? }`. `information.status` is `FOUND` / `NOT_AVAILABLE` / `LOOKUP_FAILED` — "no label exists" and "we could not check" are deliberately distinct. |
| GET | `/medications/:id/price` | — | Pakistan price lookup for one of the caller's own medications, using its confirmed strength and form to make the match stricter. Returns `{ medicineName, isConfirmed, price }`. |
| PATCH | `/medications/:id` | `{ reviewStatus, confirmed*, medicineReferenceId? }` | See `server/src/validation/medication.schema.ts`. Confirming requires name + dosage instructions + frequency. `medicineReferenceId` must be one of that medication's own suggested candidates (or `null` to clear). 409 once the prescription is finalized. |
| DELETE | `/medications/:id` | — | 204. Removes the medicine with its schedules, reminders and delivery records (schema cascade). 404 for another user's id. |

## Schedules

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/schedule?date=YYYY-MM-DD` | — | Day view (defaults to today), computed in the user's own timezone. |
| GET | `/schedule?date=YYYY-MM-DD&view=week` | — | Week view: `{ days: { "YYYY-MM-DD": Reminder[] } }`. |
| GET | `/schedule/list` | — | All of the caller's schedules (for the pause/resume/discontinue UI). |
| POST | `/schedule` | `{ medicationId, startDate, endDate?, slots: [{ timeOfDay, label? }], notes? }` | 422 unless the medication is `CONFIRMED` (re-checked here, independent of the preview step). Reminders are generated up to 30 days ahead. |
| PATCH | `/schedule/:id` | `{ status: "ACTIVE" \| "PAUSED" \| "CANCELLED" }` | Pausing/cancelling marks future `PENDING` reminders `SKIPPED` (not deleted). Resuming un-skips them. `CANCELLED` is terminal. |
| PUT | `/schedule/:id` | `{ slots?, daysOfWeek?, endDate? (null = ongoing), doseAmount?, notes?, remindersEnabled? }` | Edits a schedule. Only future, open doses are regenerated; past doses are untouched; a removed time's slot is deactivated (history kept). Duplicate doses are impossible (unique slot+time). `remindersEnabled: false` keeps doses in the app but sends no notification (recorded `SKIPPED_DISABLED`). |

## Reminders

| Method | Path | Body | Notes |
|---|---|---|---|
| PATCH | `/reminders/:id` | `{ status: "PENDING" \| "TAKEN" \| "MISSED" \| "SKIPPED" }` | `PENDING` is a correction/undo. Every change is logged with its previous value. |

A reminder's **dose status** (`status` above) is independent of its
**delivery status** — see a day/week view response's `emailStatus`
(`NOT_ATTEMPTED` / `PENDING` / `SENT` / `FAILED` / `SKIPPED_NOT_CONFIGURED`)
and `emailDeliveredAt`. There is no endpoint to trigger delivery directly —
it's a server-side background process (`reminderScheduler.service.ts`).

## Medicine reference

| Method | Path | Query | Notes |
|---|---|---|---|
| GET | `/medicines/search` | `q` (≥2 chars), `limit?` | Relevance-ranked match against `medicine_reference` (exact > prefix > whole word > substring > fuzzy). Queries under 4 characters match only by prefix or whole word, so "zol" does not return "Testazole". Returns `{ query, count, medicines[] }` with `matchScore` and `matchedOn`. |
| GET | `/medicines/price` | `name` (≥2 chars), `strength?`, `form?` | Price lookup by name. Strength and form make the match **stricter**, never looser. Returns `VERIFIED` (with `priceType`, `packSize`, `priceBasis`, source and effective date) or `UNAVAILABLE` (with `nearMisses[]` and `manualCheck[]` outbound links). |
| GET | `/medicines/:id` | — | 404 if not found (never a fabricated fallback). Returns the record plus a live `information` lookup, a `price` lookup, a `formMismatch` flag, and the standing `disclaimer`. |

### Scripty (AI assistant)

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/scripty/status` | — | `{ configured, provider, model, setupInstructions?, emailDelivery }`. Never includes the key. |
| POST | `/scripty/message` | `{ message, conversationId?, prescriptionId? }` | Runs one Claude turn (with tool calls) and returns `{ conversationId, reply, results, tool, data, pendingAction?, toolsUsed, quickActions, modelComposed, conversationRestarted? }`. Omit `conversationId` to start a conversation. The transcript is held server-side; an unknown or foreign id starts a new one. `503 SCRIPTY_NOT_CONFIGURED` without a key; `429` when rate limited. |
| POST | `/scripty/message/stream` | same | Same turn as Server-Sent Events: `conversation`, `text` (deltas), `tool` (`running`/`done`/`error`), then `done` (the reply above) or `error`. Refusals that happen before streaming (auth, ownership, validation, configuration) are ordinary JSON errors. |
| POST | `/scripty/confirm` | `{ token, conversationId? }` | Executes a previously proposed mutating action. The token is HMAC-signed, bound to the issuing user, and expires in 15 minutes. It proves *which* action was proposed — it does not grant permission; the tool's own ownership and `CONFIRMED` checks still run. The outcome is added to the conversation so Scripty knows it was saved. |
| DELETE | `/scripty/conversations/:conversationId` | — | Ends a conversation early. Only the owner's conversation is affected. |

Scripty's tools: `summarize_prescription`, `list_my_medications`,
`get_medicine_information`, `check_medicine_price`,
`check_medicine_interactions`, `list_my_schedules`,
`check_reminder_delivery`, `propose_schedule`\*, `change_schedule_status`\*.
Starred tools are **proposed only** — they never execute on model output
alone.

## Health

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | No auth required. `{ status: "ok" }`. |
