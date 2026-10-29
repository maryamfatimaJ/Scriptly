# Scriptly

Scriptly turns a photo of a paper prescription into a medicine list and
reminder schedule you have checked yourself. Upload the prescription, let
the AI read it, confirm or correct what it found, and Scriptly sets up
reminders only for what you confirmed. Built for patients in Pakistan:
it understands local prescription shorthand (OD/BD/TDS, "1+0+1", SOS,
"after meals").

Built for **Hacktoberfest Hack Day with MLH × Zeppelin Labs × DEV**.

**This tool does not replace your doctor or pharmacist.**

## At a glance

**Working (tested):**

- **Scan a prescription** — upload a JPG/PNG/WebP photo; Google Gemini
  (`gemini-3.5-flash`, configurable; Claude and local Gemma also supported)
  reads each medicine's name, dose, frequency, timing, duration and other
  instructions, and says when something is unclear or not written.
- **Simple review** — each medicine shows what was read, with **Confirm**
  and **Edit**. Unclear names or timing are flagged for you to check;
  nothing is guessed. Nothing is saved as confirmed until you confirm it.
- **Reminders** — after confirming, Scriptly proposes times from what was
  written (labelled as suggestions where the paper gave none) and saves a
  schedule only when you press Save. Pause, edit, or turn notifications off.
- **Your medicines and history** — view, edit, and delete medicines
  (their reminders go with them) and delete prescriptions (with their image).
- **Scripty** — an in-app assistant (Claude via the Anthropic API) that
  answers from your own records and sourced medicine information.
- **Medicine search** — indexed, paginated catalogue search with detail
  pages and honest "unavailable" states.

**Honest limitations:**

- **The Pakistani medicine catalogue is empty.** No source with permission
  to reuse its data has been imported (DRAP's index is "All rights
  reserved"; DawaCheck's terms forbid it). See
  `docs/medicine-data-sources.md`. Search works but returns nothing until
  permitted data is imported with `npm run catalogue:import`.
- **No verified prices** — every price lookup says "Verified price
  unavailable" and links to DRAP. No price is ever estimated.
- **Reminders are in-app only** unless SMTP email is configured; there are
  no push notifications.
- Live AI tests used **generated** prescription images, not real patients'.

## Tech stack

React 18, TypeScript, Vite, Tailwind CSS, TanStack Query · Node.js,
Express, Prisma, PostgreSQL 16 (Docker) · Google Gemini API (vision),
Anthropic Claude API (Scripty, optional vision), openFDA (label text) ·
Vitest + Supertest.

## Quick start

```bash
docker compose up -d                       # PostgreSQL on :5433
cp .env.example server/.env                # then fill in secrets (see §2)
cd server && npm install && npx prisma migrate deploy && npm run dev   # API :4000
cd client && npm install && npm run dev    # app :5173
```

`server/.env` needs `JWT_*`/`CSRF_SECRET`, `AI_PROVIDER=google` with
`GOOGLE_API_KEY` (or `anthropic` with `ANTHROPIC_API_KEY`), and optionally
`ANTHROPIC_API_KEY` for Scripty. Keys stay on the server only.

The rest of this README has grown across several build stages; section
numbers are stable. See `docs/api-reference.md` for every endpoint and
`docs/extraction-pipeline.md` for how extraction works.

---

## 1. Project structure

```
/client     React + TypeScript + Vite + Tailwind frontend
/server     Node + Express + TypeScript + Prisma + PostgreSQL backend
/docs       Research notes (medicine data sources)
docker-compose.yml   Local PostgreSQL only — app itself runs via npm, not Docker
.env.example         Copy into server/.env and client/.env
```

### client/src
```
api/            fetch wrapper + one module per resource (auth, prescriptions, medications, schedule, medicines)
animations/     CapsuleIntro.tsx — isolated intro animation component
components/     Shared UI (Button, Navbar, MobileNav, StatusBadge, MedicationReviewCard, ...)
hooks/          useAuth, usePrefersReducedMotion
layouts/        MainLayout (navbar + footer shell)
lib/validation/ Zod schemas mirroring the backend's validation (fast client-side feedback)
pages/          One component per route
types/          Shared TS types matching the API's JSON shapes
```

### server/src
```
config/env.ts        All environment variables, with safe dev defaults
routes/ → controllers/ → services/ → db (prisma)   strict layering, see below
middleware/           auth, csrf, rate limiting, upload (multer), validation, error handling
validation/           Zod schemas (source of truth — client schemas mirror these)
services/extraction/  Vision providers: Gemini/Gemma (Google), Claude (Anthropic), Grok (xAI), Ollama (local); Mock for tests only
services/medicineInfo/ openFDA label lookup, monograph cache, Pakistan price lookup
services/scripty/     Scripty: Claude tool-use loop, validated tool layer, conversation store
```

Request flow: `routes` wire HTTP verbs + middleware → `controllers` parse
req/res and call a service → `services` hold all business logic and talk to
Prisma directly → nothing outside `services/` imports `@/db/prisma`.

---

## 2. Setup — exact commands

### Prerequisites
- Node.js 20+ (tested on Node 24)
- Docker Desktop (for local PostgreSQL) — or point `DATABASE_URL` at any
  Postgres instance you already have.

### 2.1 Database
```bash
docker compose up -d
```
This starts Postgres on `localhost:5433` (db `prescription_db`, user/pass
`postgres`/`postgres` — see `docker-compose.yml`). **Host port 5433, not
5432**: on the machine this was built on, a native Windows PostgreSQL
service already owned 5432, which silently captured connections meant for
the container (showing up as an `Authentication failed` error, not a port
conflict error) — remapped to 5433 to avoid that class of bug entirely.
If 5433 is also taken on your machine, change the port mapping in
`docker-compose.yml` and both `DATABASE_URL`s (`.env.example` and
`server/.env`) to match.

> **Verified end-to-end, not just typechecked.** The full stack was
> actually run against this container: `prisma migrate dev` created the
> schema, `prisma:seed` populated it, and then every API endpoint in the
> brief was driven live via curl (register → login → CSRF → upload →
> extract → confirm/reject → approve → create schedule → mark a reminder
> taken → logout, including the negative case: creating a schedule for an
> *unconfirmed* medication correctly fails). The frontend was rendered in
> a real headless browser (desktop + mobile viewports, mobile nav open,
> the full capture → review → confirm → schedule flow) and its console
> was checked for errors. Two real bugs were caught and fixed this way
> (see §6) that typechecking alone would never have found.

### 2.2 Backend
```bash
cd server
npm install
cp ../.env.example .env   # already done for you in this repo with generated dev secrets — see server/.env
npm run prisma:generate
npm run prisma:migrate     # creates the schema in Postgres
npm run prisma:seed        # demo user + ~10 unverified sample medicines
npm run dev                 # http://localhost:4000
```
Demo login after seeding: `demo@example.com` / `DemoPass123!` (printed by
the seed script too).

Starting the server also starts the reminder scheduler (one
`setInterval`, scanning for due reminders every
`REMINDER_SCHEDULER_INTERVAL_SECONDS`, default 60) — you'll see
`EMAIL_PROVIDER=none (reminders are in-app only; no email will be sent)`
in the startup log until SMTP credentials are configured (§8).

Other useful scripts: `npm run build` (compiles to `dist/`, resolving the
`@/` path alias via `tsc-alias`), `npm start` (runs the compiled build),
`npm run typecheck`, `npm test` (71 tests across 10 files — requires the
Postgres container from §2.1 to be running; `npm run test:watch` for
interactive runs). Test files run sequentially, not in parallel
(`fileParallelism: false` in `vitest.config.ts`) — they share one real
database rather than mocking Prisma, including background functions like
the reminder scheduler that intentionally scan the whole table, so
parallel file execution caused real cross-test contamination (see §6,
bug 7). Each test registers its own uniquely-emailed user, so re-running the
suite repeatedly is safe but does accumulate `@example.test` users (and
their cascade-deleted data) in your dev database over time — harmless,
but easy to clear when it bothers you:
```bash
node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.user.deleteMany({where:{email:{contains:'@example.test'}}}).then(r=>console.log('deleted',r.count)).finally(()=>p.\$disconnect())"
```
or for a fully clean slate, `docker compose down -v && docker compose up -d`
followed by `npm run prisma:migrate` and `npm run prisma:seed` again.

### 2.3 Frontend
```bash
cd client
npm install
npm run dev   # http://localhost:5173
```
`npm run build` / `npm run typecheck` also available.

### 2.4 Capsule intro animation (your file, not a placeholder)
This project does **not** ship a fake intro animation. To add yours:
1. Export it as a **Lottie-compatible JSON** file.
2. Save it as `client/public/animations/capsule-intro.json` (see
   `client/public/animations/README.md`).
3. Nothing else changes — `client/src/animations/CapsuleIntro.tsx` fetches
   that exact path at runtime. If the file is missing or invalid, the
   intro is skipped automatically and the homepage loads normally.
4. To replace it later, just overwrite that same file.

If your animation isn't Lottie JSON (e.g. it's a video or a Rive file),
say so before dropping it in — the current player is Lottie-specific.

---

## 3. What's actually working vs. demo vs. pending

**Part 2 update:** the capture → extraction → review → approval pipeline
described below was substantially deepened — richer per-field extraction
schema (brand, generic name, route, special instructions, per-field
confidence), automated medicine-reference matching with explicit
Verified/Possible/Multiple/No-record states, idempotent/retry-safe
extraction, a field-level audit trail on medication edits, configurable
confidence thresholds, and a 39-test integration suite covering the whole
flow against a live database. See §6 for two real bugs this caught (one
app bug, one test-helper bug) and §4 for exactly what's still needed
before Gemma can replace the mock provider.

**Part 3 update:** the schedule preview → explicit-activation workflow,
pause/resume/discontinue, a real server-side reminder-delivery system
(persistent, restart-safe, retry-aware, with an email channel pending your
SMTP credentials — see §8), per-user timezones, correctable reminder
statuses with full audit history, and a History page tying prescriptions
to their complete event trail. Test suite grew to 71 tests across 10
files; §6 has three more real bugs this stage's testing/QA caught
(one stale-cache UI bug, one actual scheduling logic bug, one DB
concurrency bug in the delivery scheduler).

### Working (built, typechecked, tested)
- Full page structure and routing: Home, How It Works, Capture, Review,
  My Medications, Schedule, Medicine Information, Login/Register/Account,
  responsive mobile nav.
- Scriptly's capsule-motif brand system (colors, type, the `CapsuleMotif` mark) applied
  consistently via Tailwind tokens.
- `CapsuleIntro` component: fetches your JSON if present, degrades
  gracefully if absent, respects `prefers-reduced-motion`, has a visible
  skip control, won't replay on route navigation (mounted once above the
  router), uses sessionStorage so it doesn't replay on every reload within
  a tab (see the long comment at the top of `CapsuleIntro.tsx` for the
  three alternatives considered).
- Backend: Express app with helmet, CORS (credentialed, explicit origin),
  rate limiting (general + stricter on auth), httpOnly cookie auth
  (short-lived access JWT + rotating opaque refresh token stored hashed in
  a `Session` table so logout actually revokes it), double-submit-cookie
  CSRF protection on all mutating routes, Multer upload validation
  (MIME allowlist + size cap), centralized error handling that never
  leaks stack traces/file paths to the client.
- Prisma schema: users, sessions, prescriptions, medications, schedules,
  schedule_slots, reminders, medicine_reference,
  medicine_reference_sources, prescription_events (audit log) — with the
  extracted-vs-confirmed field separation and the
  confirmed-before-schedulable rule enforced in `schedule.service.ts`
  (not just in the UI).
- Full API surface from the brief: auth (register/login/refresh/logout/me
  + csrf-token), prescriptions (create/list/get/extract/approve/
  reject/request-clarification + an authenticated image-streaming
  endpoint not in the original list, added because the Review page needs
  to show the original image without exposing it publicly), medications
  (list/update), schedule (get by date/create), reminders (update),
  medicines (search/get).
- `AI_PROVIDER=mock`: a fully working mock extraction provider that
  returns clearly-labeled demo medication candidates with confidence
  scores and warnings, end-to-end through upload → extract → review →
  confirm → schedule → reminders.
- Backend tests: **140 tests across 15 files, all passing** (`npm test`).
  `tests/validation.test.ts` + `tests/health.test.ts` (10 tests, no DB
  needed). `tests/extractionProviders.test.ts` (4 tests): the mock
  provider's demo labeling and "never guess an unreadable field" behavior,
  and that the hosted provider refuses to run unconfigured.
  `tests/visionImageForwarding.test.ts` (7 tests): proves the REAL image
  bytes from disk reach the provider's HTTP body, that the API key goes in
  a header and never the URL, and that auth/blocked/unparsable responses
  fail loudly instead of returning invented data.
  `tests/medicineInformation.test.ts` (15 tests): openFDA label selection
  (never a combination product for a single ingredient), strict strength
  matching, and dosage-form mismatch detection.
  `tests/medicineApi.test.ts` (16 tests): search auth, relevance, detail,
  and price matching that refuses to quote a different strength or form.
  `tests/scriptyAssistant.test.ts` (35 tests, **mocked model**): the
  Claude tool loop, ownership isolation, conversation continuity and
  isolation, API failure handling, streaming, and that a proposed
  schedule creates nothing until confirmed.
  `tests/medicineMatching.test.ts` (6 tests): Verified/Possible/Multiple/
  No-record states against real seeded reference rows. 
  `tests/prescriptionWorkflow.test.ts` (19 tests, against a real Postgres
  instance via `tests/helpers/testClient.ts`): upload validation (MIME,
  size, auth), the full extract→review→confirm→approve flow, idempotent
  retry (no duplicate medications), retry blocked once reviewed or once
  finalized, ownership isolation (404s, not another user's data),
  approval gating, and reject/clarification flows.
- **Medicine reference matching** (`medicineMatching.service.ts`): runs
  automatically after extraction. Never auto-selects an uncertain match —
  `VERIFIED_MATCH` (auto-linked) requires name *and* strength *and*
  formulation to agree; `POSSIBLE_MATCH`/`MULTIPLE_MATCHES` surface
  candidates for the user to pick from (`MedicineMatchPanel.tsx`);
  `NO_VERIFIED_RECORD` when nothing clears the minimum similarity bar
  (`MEDICINE_MATCH_MIN_SCORE`, configurable).
- **Idempotent, retry-safe extraction**: calling `/extract` twice before
  anything is reviewed is safe (old draft medications are cleared, not
  duplicated); re-extraction is refused once any medication has been
  reviewed or the prescription is finalized, and a DB-level atomic claim
  (`status: EXTRACTING`) stops two concurrent calls from racing.
- **Field-level audit trail**: editing a medication's confirmed fields
  records a before/after diff on the `PrescriptionEvent` log
  (`MEDICATION_UPDATED`), not just "something changed".
- **Configurable confidence thresholds** (`CONFIDENCE_THRESHOLD_LOW`/
  `_HIGH` in `.env`): the pipeline (not any one provider) adds its own
  "needs scrutiny"/"needs clarification" warning when a field's
  confidence falls below the configured bar — documented in
  `extraction/types.ts` and applied in `extractionService.ts`.
- Both `client` and `server` typecheck and build cleanly.
- **Schedule preview → explicit activation** (`frequencyParser.ts`,
  `GET /medications/:id/schedule-preview`): derives a suggested slot
  *count* from the confirmed frequency ("3x daily" → 3 suggested slots)
  — never exact clock times, which the user always enters themselves.
  "As needed"/PRN or unrecognized phrasing explicitly says scheduling
  needs the user's own judgment rather than guessing a routine.
  Activation (`POST /schedule`) re-validates `CONFIRMED` server-side
  independently of the preview step.
- **Pause / resume / discontinue** (`PATCH /schedule/:id`): pausing marks
  future `PENDING` reminders `SKIPPED` (kept, not deleted); resuming
  un-skips them (not a parallel regenerate — an earlier version of this
  regenerated instead of un-skipping and silently left every paused day
  stuck as skipped forever, see §6); `CANCELLED` is terminal.
- **Real, persistent reminder delivery system**
  (`reminderScheduler.service.ts`): a server-side background scan (not a
  frontend timer) that is restart-safe (re-derives everything from
  Postgres every tick, nothing kept in memory), duplicate-safe (a
  `(reminderId, channel)` unique constraint plus an atomic upsert-based
  claim), and retry-aware (`REMINDER_EMAIL_MAX_ATTEMPTS`, a terminal
  `FAILED` status once exhausted — never an infinite silent retry loop).
  See §8 for the channel options considered and what's actually
  configured vs. pending.
- **Per-user timezones** (`User.timezone`, IANA name, detected at
  registration via the browser, editable in Account settings): every
  reminder's `scheduledFor` and every day/week view's day boundaries are
  computed in the user's own timezone via Luxon (DST-correct), not the
  server's local time or raw UTC midnight.
- **Reminder status corrections with audit history**
  (`PATCH /reminders/:id`, including `PENDING` to undo a mistaken mark):
  every change logs its previous AND new status, so a correction is a
  visible event, not a silent overwrite. Delivery status (`emailStatus`:
  `NOT_ATTEMPTED`/`PENDING`/`SENT`/`FAILED`/`SKIPPED_NOT_CONFIGURED`) is
  tracked independently of dose status (`TAKEN`/`MISSED`/etc.) — a dose
  can be taken without ever being emailed, and an email can be sent for a
  dose still marked pending.
- **History page** (`GET /prescriptions/:id/events`): the full
  chronological `PrescriptionEvent` trail per prescription — upload,
  extraction, matching, every medication edit (with the field-level diff),
  approval/rejection, schedule activation/pause/resume, and every reminder
  status change.
- **"Already scheduled" detection** (the Part 2 "pending" gap): `GET
  /medications` now reports each medication's `schedules[]`, so the
  Schedule page correctly stops offering "set up reminders" once an
  active/paused schedule exists — closed in this stage, see §6 for the
  stale-cache bug that initially masked the fix.

### Clearly-labeled demo data (not real)
- The ~10 medicines in `prisma/seed.ts`: real generic names, but no
  prices, no registration numbers, `verificationStatus: UNVERIFIED`,
  `dataProvenance: MANUAL`. See `docs/medicine-data-sources.md` for the
  actual research and a concrete plan to replace this with verified data.
- `MockExtractionProvider`'s output: tagged `provider: "mock"` with an
  explicit "DEMO DATA" warning surfaced in the Review UI.
- The hero/how-it-works photography is a stock Unsplash placeholder (see
  the comment in `client/src/components/HeroPhoto.tsx`) standing in for
  real product photography, with a graceful fallback if the URL is ever
  unreachable.

### Explicitly pending (not implemented, not faked)
- **A real prescription image tested against the live model**: the vision
  pipeline is implemented and unit-tested against a mocked provider, but
  no actual photo has been sent to Google yet because that needs
  `GOOGLE_API_KEY`. See §4.1. Until that test is run, do not describe
  real-image extraction as proven.
- **Pakistani price data**: no permitted source secured. `price.service.ts`
  imports nothing and returns an honest "Verified price unavailable" with
  links out to DRAP. `docs/medicine-data-sources.md` records the full
  investigation of medira.pk and dawacheck.pk and why neither is scraped.
- **Pakistani product leaflets**: same — openFDA supplies US labelling,
  clearly marked as such, because no permitted local source exists.
- **Background reminder extension job**: reminders are generated up to 30
  days ahead at schedule-creation time; nothing yet extends an
  open-ended schedule's reminders past that window as time passes.
- **Per-field "Confirm Field" granularity**: the review UI confirms/
  rejects a medication as a whole (with per-field confidence indicators
  and inline edits), not each field independently with its own confirm
  action. Scoped down deliberately for this stage — flag if you need true
  field-by-field confirmation and it can be built out.
- **A real image-quality/unreadable-region signal from the provider**:
  `CapturePrescription.tsx` does a basic client-side resolution check
  (warns below ~600px on the short edge) and the Review page can display
  prescription-level warnings, but no provider yet returns *which region*
  of the image was unreadable — that needs real OCR/vision output to be
  meaningful, not something to fake with the mock provider.
- **OCR vs. vision-direct decision for handwriting**: still open — see §4.
- **Password reset / email verification**: not built.
- **Actual email reminder delivery**: `SmtpEmailProvider` is implemented
  and the whole delivery pipeline (persistence, retries, dedup) is tested
  against a *mocked* transport, but it has not been exercised against a
  real mailbox — no SMTP credentials have been provided. `EMAIL_PROVIDER`
  stays `none` (in-app only) until you supply them. See §8 — do not take
  "implemented" as "proven to send email".
- **Browser push notifications**: not built in this pass (see §8 for why,
  and what it would take) — reminders don't reach a closed tab/app yet.
- **Background reminder extension + horizontal scaling of the scheduler**:
  the scheduler is a single `setInterval` in one process, which is correct
  for this deployment; running multiple instances concurrently would need
  an explicit claim/lock step beyond the current upsert-based one (see the
  comment in `reminderScheduler.service.ts`) to fully rule out a duplicate
  send in the race window — not needed until/unless this scales out.
- **Rate-limit/CSRF/cookie settings tuned for a real production domain**
  (currently dev-appropriate defaults — see `.env.example` comments on
  `COOKIE_SECURE`, `COOKIE_DOMAIN`).
- **npm audit findings**: `npm audit` reports some moderate/high/critical
  advisories in dev-only tooling transitive deps (vitest's `tinypool`,
  vite's bundled `esbuild`, and zod 3.x has a since-patched DoS advisory
  fixed in zod 4). Fixing these means breaking-change upgrades
  (vitest 2→5, zod 3→4) that would touch every validation schema and test
  file in this repo — left as a deliberate, flagged follow-up rather than
  rushed through untested in this same session. Re-run `npm audit` in
  `client/` and `server/` to see current state before shipping.

---

## 4. AI configuration — vision extraction and Scripty

Scriptly uses AI for two separate jobs, each with its own server-side
key: reading a prescription photo (Gemma, section 4.1) and the Scripty
assistant (Claude, section 4.2).

### 4.1 Prescription reading (vision)

Choose the provider in `server/.env` (never in `client/.env`, never in git).
There is no default and no demo fallback — the server refuses to start
until one is chosen, because which company sees a patient's prescription
is a decision, not a setting:

```
AI_PROVIDER=anthropic          # Claude vision — uses ANTHROPIC_API_KEY
# or
AI_PROVIDER=google             # Gemini — uses GOOGLE_API_KEY and GOOGLE_MODEL
# or
AI_PROVIDER=ollama             # local Gemma 3, image never leaves the machine
```

The startup banner says exactly what is active:

```
Scriptly API listening on http://localhost:4000 (development)
  extraction : anthropic (claude-opus-5-5) — prescription images are sent to Anthropic
  scripty    : Claude claude-opus-5-5 via the Anthropic API
  medicines  : openFDA label lookup (no API key required)
  reminders  : EMAIL_PROVIDER=none (in-app only; no email will be sent)
```

`AI_PROVIDER=mock` (fixed demo medicines, never reads the image) exists for
the automated test suite only and is refused everywhere else.

**What happens to an upload**

1. The file's signature bytes are checked (not just its declared type);
   only real JPG/PNG/WebP images are accepted, up to `MAX_UPLOAD_SIZE_MB`.
2. EXIF orientation is applied (phone photos are often stored sideways)
   and large photos are downsized before sending.
3. The model transcribes each medicine: name, brand, active ingredient,
   strength, form, route, dose, frequency, timing, duration, quantity and
   other instructions, each with a confidence and a provenance —
   `READ`, `UNCERTAIN` (shown with the visible text, e.g. "Klar..."),
   `NOT_VISIBLE`, or `INFERRED` (allowed only for the active ingredient of
   a clearly written brand). The parser discards any other inferred value
   and any value marked not visible, and adds a critical warning.
4. The page's legibility (GOOD / PARTIAL / POOR) is recorded and shown.
5. On failure the user sees the real reason (quota exhausted, provider
   busy, unreadable image, bad credentials) and a retry button. No
   medicines are stored from a failed attempt.

**Model capability is enforced, not assumed.** The Claude model is checked
against the Models API (`capabilities.image_input`) before the first image
is sent. Gemma 1B/270M are text-only and are rejected before sending.

**Live-tested on real images, not only mocks.** `npm run extraction:live --
<anthropic|google> <folder>` runs four generated test prescriptions
(printed, blurred handwriting stored sideways, an ink-blotted name, missing
instructions) through the real provider and the full workflow. Results on
29 October 2026: Claude passed every check on its first run with no failed
requests; Gemini (`gemini-3.5-flash`, this project's key) read the images
equally well when it answered, but returned HTTP 503 "overloaded" on many
first attempts and failed checks in two of three runs before retries were
added.

### 4.2 Scripty (Claude)

Add your Anthropic key to `server/.env` (there is a marked line for it),
then restart the backend:

```
ANTHROPIC_API_KEY=<your key>
```

Create a key at <https://console.anthropic.com/settings/keys>. Optional
settings (model, effort, limits) are documented in `.env.example`. The key
stays on the server: it is never sent to the browser, logged, or returned
by any endpoint. Without it, Scripty answers `503 SCRIPTY_NOT_CONFIGURED`
with these setup steps — there is no canned or mock fallback.

How a turn works:

```
user message
  -> Claude (adaptive thinking) replies, calling tools when it needs data
  -> OUR code validates each call (Zod) and runs it with the SESSION's
     userId and our ownership checks                         [the facts]
  -> results go back to Claude, which continues or answers   [the wording]
```

- **Tools:** the user's prescriptions, medicines and schedules (today's
  reminders included), openFDA label information, an openFDA label-based
  interaction check, verified Pakistani prices, reminder-delivery status,
  and two proposal-only schedule tools.
- **Schedule changes always require a human click.** The two mutating
  tools return a *proposal* plus an HMAC-signed, 15-minute, user-bound
  token. Nothing is written until the user presses "Confirm and save".
- **Conversations are held in server memory only**, keyed by conversation
  id AND user id, and expire after 2 idle hours. They are never written to
  the database. A server restart starts a new conversation.
- **Replies stream** to the browser over Server-Sent Events
  (`POST /api/scripty/message/stream`).
- If Claude declines a request on policy grounds, the API's server-side
  fallback (`fallbacks: "default"`) retries it on a fallback model.

`npm test` covers the loop with a **mocked** model. `npm run scripty:live`
(server running, key set) drives every scenario against the **real** API
and prints Scripty's actual replies.

### 4.3 Medicine catalogue, information and prices

**Catalogue search** (`GET /api/medicines/search?q=&page=&pageSize=`) runs in
PostgreSQL over `pg_trgm` GIN indexes on brand, generic name and active
ingredient. One character is enough ("P" lists everything whose name, or a
word in it, starts with P); results are ranked (exact → prefix → word start →
substring/misspelling for 4+ characters) and paginated, with a total count.
A strength or form typed into the query ("panadol 500 mg tab") is recognised
and applied as a filter. Nothing is searched from a list in the browser.

**What is in it today: nothing real.** The catalogue only holds records
imported from a source that permits reuse, and none has been imported yet
(`npm run catalogue:report` measures it from the database). The ten generic
medicines an old seed created are flagged `isSynthetic` and hidden from
search, detail pages, prescription matching, prices and Scripty; test
fixtures are synthetic too and are visible only under
`CATALOGUE_INCLUDE_SYNTHETIC=true` (set by the test config only).

**Detail pages** show brand, generic, ingredient, strength, form, pack,
manufacturer, DRAP registration number, other packs of the same product,
sources with their permission basis, and last-verified dates — and
"Information unavailable" for any field not recorded. Label text comes live
from **openFDA** (U.S. labelling for the ingredient, labelled as such). An
"Ask Scripty about this medicine" button opens Scripty with that record's
stored details, loaded and validated on the server, including whether it is
verified; unknown fields are passed as unknown.

**Product photos** are shown only when a person has confirmed the photo shows
that exact product, strength and form, with its source, licence and
attribution; otherwise a "Product image unavailable" placeholder. There is no
stock or look-alike image, and the importer refuses to attach one photo to
two products.

**Prices** are shown only for an exact product + pack match with a recorded
source, type (official MRP vs retailer) and last-verified date; otherwise
"Verified price unavailable" with links to check DRAP yourself.

**Loading real data** (dry run by default, `--apply` to write; one invalid
row aborts the whole file):

- `npm run catalogue:import -- catalogue.csv` — products/packs, optional
  prices (template `docs/catalogue-import-template.csv`). Every row needs a
  source, https URL, `permission_basis` and the date a person verified it.
  Normalizes forms ("Tab." → tablet), rejects duplicate packs, upserts per
  source and keeps a provenance row per import.
- `npm run catalogue:images -- images.csv` — verified product photos
  (template `docs/catalogue-images-template.csv`), re-encoded to JPEG
  (metadata stripped) into `MEDICINE_IMAGE_DIR`.
- `npm run catalogue:report` — real vs synthetic rows, Pakistan coverage,
  verified prices, packs, photos and duplicate rate.

Which sources may be used, and why most cannot yet, is in
`docs/medicine-data-sources.md`.

### 4.4 Schedules and reminders

After a prescription is confirmed, each confirmed medicine gets a
**proposed** schedule built only from what was written:

- clock times written on the prescription are used as-is;
- meal timing ("after breakfast and dinner") and dose positions ("1+0+1")
  become meal-anchored times (defaults `MEAL_TIME_*`, adjustable);
- a bare frequency ("TDS") gets evenly spaced times **labelled as
  suggestions**;
- as-needed (SOS/PRN), missing, unrecognised or contradictory instructions
  get **no** proposed times — the reasons are shown instead;
- a missing duration must be chosen by the user (a number of days, or
  "ongoing" only if the prescriber said so).

Nothing is saved until the user reviews the times and presses Save. Users
can also add a medicine and schedule **without a prescription** (Schedule →
Add a medicine), and edit any schedule's times, days of the week, end date
and dose, pause/resume/discontinue it, or turn its notifications off.
Editing replaces only future, open doses; taken/missed/skipped doses are
never changed. A unique `(slot, time)` constraint makes duplicate doses
impossible however generation overlaps (creation, resume, edit, and the
6-hourly rolling top-up).

**Delivery, stated plainly.** Reminders are always shown in the app on the
Schedule page. Email is sent only with `EMAIL_PROVIDER=smtp` and SMTP
settings; with `EMAIL_PROVIDER=none` (the default) each due dose is
recorded as `SKIPPED_NOT_CONFIGURED`, never as sent. A dose whose time had
already passed when its schedule was created is never notified, a schedule
with notifications off records `SKIPPED_DISABLED`, and a reminder more than
24 hours late is not sent. There is no push-notification channel.

### 4.5 Still open

- **Catalogue, prices and photos** are empty until a permitted source is imported (see `docs/medicine-data-sources.md`).
- **Push notifications** are not implemented; email requires SMTP settings.
- **Live tests use generated test images**, not real patients'
  prescriptions. Real-world accuracy on genuinely messy handwriting should
  be measured on consented samples before relying on it.

## 5. Security notes

- Auth cookies are httpOnly; CSRF tokens are double-submit-cookie style
  and required on every POST/PATCH/DELETE (`x-csrf-token` header, fetched
  once via `GET /api/auth/csrf-token` — the frontend's `api/client.ts`
  handles this automatically).
- Prescription images are never served from a public/static path — only
  through `GET /api/prescriptions/:id/image`, which is behind auth and an
  ownership check in `prescription.service.ts`.
- Every service function that reads/writes user data filters by
  `userId` — there is no endpoint that returns another user's records.
- Uploads are restricted by MIME type AND file signature (JPG/PNG/WebP only) and size
  (`MAX_UPLOAD_SIZE_MB`, default 10MB).
- The server refuses to start in production (`NODE_ENV=production`) if
  the JWT/CSRF secrets are still the insecure dev defaults.

---

## 6. Bugs the visual QA pass caught (that typechecking couldn't)

Typechecking and `npm run build` succeeding only proves the code compiles
— it says nothing about what actually renders. A headless-browser pass
(desktop + mobile, console-error checked, and the full capture → review →
confirm → schedule flow actually clicked through) caught two real UI bugs
that were fixed before calling this done:

1. **Mobile nav covered only the header's height, not the full screen.**
   `MobileNav`'s full-screen overlay (`position: fixed; inset: 0`) was
   nested inside `Navbar`'s `<header>`, which has `backdrop-blur`
   (CSS `backdrop-filter`). `backdrop-filter` establishes a new containing
   block for `position: fixed` descendants — so the overlay was being
   sized relative to the header, not the viewport. Fixed by moving
   `<MobileNav>` to be a sibling of `<header>`, not a child, in
   `components/Navbar.tsx`.
2. **The mobile nav's "Scan prescription" button had invisible text.**
   `Button`'s variant classes (e.g. `bg-forest text-offwhite`) and a
   caller's override (`className="bg-offwhite text-forest"`) were merged
   with plain `clsx`, which just concatenates class strings — which
   same-property utility class actually wins in the browser depends on
   each utility's position in Tailwind's *compiled stylesheet*, not the
   order they appear in the `className` string. That produced an
   off-white-on-off-white (invisible) or forest-on-forest button
   depending on build order. Fixed by adding `tailwind-merge` and a
   shared `cn()` helper (`client/src/lib/cn.ts`) that every shared
   component (`Button`, `StatusBadge`, `CapsuleMotif`, `Disclaimer`,
   `HeroPhoto`) now uses instead of raw `clsx` wherever a prop is meant to
   override the component's own classes.

Both are the kind of bug that only shows up when the thing is actually
rendered and looked at — worth knowing about if you add new components
with overridable Tailwind classes: use `cn()` from `client/src/lib/cn.ts`,
not raw `clsx`.

**Part 2's integration-test pass caught two more, both CSRF-related:**

3. **A real app bug**: a failed CSRF check was surfacing as an opaque
   `500 Internal Server Error` instead of a `403`. `csrf-csrf` throws an
   `http-errors` instance with `code: "EBADCSRFTOKEN"` (not a custom class
   you can `instanceof`-check), and `error.middleware.ts` had no case for
   it, so it fell through to the generic handler. Fixed by matching on
   `err.code === "EBADCSRFTOKEN"` and returning a proper 403 with an
   actionable message. This would have affected a real user too — e.g.
   anyone whose CSRF token genuinely expired would have seen a confusing
   "something went wrong" instead of being told to refresh.
4. **A test-helper bug, not an app bug**: the integration test suite
   intermittently got that same CSRF error on an agent's *first-ever*
   mutating call. Root cause: `tests/helpers/testClient.ts`'s `post()`/
   `patch()` helpers built the request as `this.agent.post(path).set(await
   this.csrfHeader())...` — supertest/superagent snapshots the cookie jar
   when `.post(path)` is *constructed*, which happens before an argument
   expression like `await this.csrfHeader()` is evaluated. So the
   freshly-set CSRF cookie wasn't in the jar yet at construction time on a
   brand-new agent. Fixed by resolving the header to a plain object first,
   then constructing the request. The real frontend (`client/src/api/
   client.ts`) never had this problem — it already resolves the token
   before calling `fetch()` — this was purely an artifact of how the test
   helper was first written. Documented in the helper itself so it isn't
   reintroduced.

**Part 3's QA pass (browser walkthrough + test suite) caught three more —
one UI cache bug, one real scheduling-logic bug, and one real concurrency
bug:**

5. **Stale cache after activating a schedule.** After activating a
   schedule, "Amoxicillin" kept appearing under "set up reminders for a
   confirmed medication" even though it now had an active schedule —
   `CreateScheduleForm`'s mutation invalidated `["schedule"]` and
   `["schedules"]` but not `["medications"]`, so the medications list (now
   carrying a `schedules[]` field used to filter this section) stayed
   stale. Fixed by also invalidating `["medications"]` on schedule
   create/pause/resume/cancel. Caught by screenshotting the actual page
   after activation, not by any unit test (the API was already returning
   correct data).
6. **Resuming a paused schedule left future doses stuck as skipped
   forever.** The first version of `updateScheduleStatus`'s resume branch
   regenerated the forward window and de-duplicated by "does a reminder
   already exist for this slot+day" — true regardless of that reminder's
   status. Since pausing had already marked those future reminders
   `SKIPPED` (not deleted), the dedup check saw them as "already there"
   and never created a live one, so every day after a pause stayed
   permanently skipped even after resuming. Fixed by having resume
   *un-skip* the existing future `SKIPPED` rows directly (reversing
   exactly what pause did) instead of trying to regenerate around them;
   only genuinely missing slot/day combinations get new rows. Caught by
   actually clicking Pause → Resume → Week view in a browser and reading
   the result, then locked in with a regression test asserting future
   reminders are `PENDING` after resume (the old, buggy code also passed
   a weaker "no duplicate timestamps" assertion — that test wasn't wrong,
   it just wasn't checking the thing that actually mattered).
7. **A real concurrency bug in the reminder scheduler, found via a flaky
   test.** `processDueReminders()` used a find-then-create pattern for
   each reminder's `ReminderDelivery` row. Two scheduler ticks racing on
   the same due reminder (e.g. two overlapping ticks, or — concretely —
   two different test files' calls hitting the same shared test database
   concurrently) could both see "no delivery row yet" and both try to
   `create()` one, crashing on the `(reminderId, channel)` unique
   constraint. Fixed by switching to an atomic `upsert`. This is a real
   robustness fix (not just a test artifact) for the current
   single-process scheduler design, though fully eliminating a duplicate
   *send* under true multi-instance concurrency would need a proper
   claim/lock step beyond this — noted as a pending item in §3 for if/when
   this scales to multiple server instances. Separately, the *test suite*
   also needed `fileParallelism: false` in `vitest.config.ts`, because
   vitest running test files in parallel processes — all against one
   shared Postgres database — let one file's mocked (always-failing)
   email provider leak into another file's reminder via the scheduler's
   intentionally-global scan.

---

## 7. External services & credentials

| Service | Needed for | Status | Cost |
|---|---|---|---|
| PostgreSQL | Core data storage | You run it locally via `docker-compose.yml` | Free (self-hosted) |
| Gemma (or another vision-capable model) | Real prescription extraction | **Not configured** — see §4 | Depends on provider; ask before committing to a paid one |
| DRAP / OpenFDA / WHO EML / RxNorm | Medicine reference data | Researched, not yet integrated — see `docs/medicine-data-sources.md` | OpenFDA & RxNorm are free; DRAP has no paid API (no API at all, in fact) |
| SMTP provider (Gmail app password, Resend, SendGrid, Mailgun, Postmark, etc.) | Real reminder emails | **Not configured** — see §8 | Free tiers exist (Gmail for dev; most transactional providers have a free tier); ask before committing to a paid plan |

No API keys are present in any frontend code or committed `.env` file
beyond the locally-generated dev secrets in `server/.env` (gitignored).
`.env.example` contains placeholders only.

---

## 8. Reminder delivery — options considered, and what's actually wired up

The brief asked for a real reminder-delivery mechanism, not a static
dashboard, and asked me to lay out the choices before picking one. These
were the options:

**A. In-app reminders while the app is open.** Zero new infrastructure —
the Schedule page already polls and can show "due now"/"overdue" clearly.
Limitation: reaches you only while you have a tab open.

**B. Browser push notifications (Web Push + a service worker).**
Technically free — the Web Push protocol itself needs no paid account,
just a generated VAPID keypair — and reaches a closed tab. Real scope
beyond A, though: a service worker, a `PushSubscription` table, a
permission-request UI, and subscription lifecycle handling (expiry,
unsubscribe). Not built in this pass — flagged as the natural next step
if you want delivery to a closed app without any external account.

**C. Server-side scheduled notifications via a third-party push/SMS
provider** (e.g. OneSignal, Twilio). Most capable, but means a paid
account and a new external dependency — not something to commit to
without asking first.

**D. Email.** A real, asynchronous channel that reaches you outside the
app, implementable today against any SMTP provider (including a free
Gmail app password for local testing), and the one you chose when I asked
(see the three options above were presented, plus this one, and you
picked "also plan for email").

**What's actually built:** the full persistent, restart-safe, retry-aware
delivery *infrastructure* (§3, `reminderScheduler.service.ts`), with
Option A (in-app "due now") fully working today, and Option D (email) with
a complete, tested `SmtpEmailProvider` (`nodemailer`-based, provider-
agnostic SMTP — works with Gmail, Resend, SendGrid, Mailgun, Postmark,
etc.) that's wired into the same delivery pipeline. `EMAIL_PROVIDER=none`
is the default, which means **no email has actually been sent** — the
scheduler explicitly records `SKIPPED_NOT_CONFIGURED` rather than
pretending. Options B and C are not built.

### To turn on real email reminders

1. Pick an SMTP provider. For local testing, a Gmail account with an
   [app password](https://myaccount.google.com/apppasswords) works
   (`SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`). For
   production, a transactional provider (Resend, SendGrid, Mailgun,
   Postmark — all have free tiers) is more reliable and won't look like
   spam. **Tell me which one and I'll help wire up the specifics if
   they differ from plain SMTP.**
2. Add to `server/.env` (never commit real values — `.env.example` has
   placeholders only):
   ```
   EMAIL_PROVIDER=smtp
   SMTP_HOST=...
   SMTP_PORT=587
   SMTP_USER=...
   SMTP_PASS=...
   SMTP_FROM_EMAIL=...
   SMTP_FROM_NAME=Scriptly
   ```
3. Restart the server and activate a schedule with a reminder time a
   minute or two in the future. Watch the server log and check
   `reminder_deliveries` (`npx prisma studio`) for a `SENT` row — **don't
   take "configured" as "working" until you've actually seen a real email
   land.**
