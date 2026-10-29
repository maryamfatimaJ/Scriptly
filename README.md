# Scriptly

## Project Overview

Scriptly turns a photo of a paper prescription into a medicine list and a reminder schedule that the patient has checked for themselves. An AI model reads the prescription; the patient confirms or corrects every medicine before anything is saved; reminders are created only for what they confirmed. It is built for patients in Pakistan and understands local prescription shorthand (OD/BD/TDS, "1+0+1", SOS, "after meals").

Built for **Hacktoberfest Hack Day with MLH × Zeppelin Labs × DEV**.

> Scriptly gives general information and reminders. It does not replace a doctor or pharmacist.

## Live Demo

**Frontend:** https://scriptly0-one.vercel.app/

> **Note:** this link is the **frontend only**. The backend (Express API and PostgreSQL database) is not hosted yet, so signing in, prescription scanning, medicine search and Scripty do not work on it. To use the full app, run it locally (see [How to Run Locally](#how-to-run-locally)) or watch the [demo video](Demo%20video/demo.mp4).

## Key Features

- **Prescription scanning** — upload or photograph a JPG/PNG/WebP prescription. Progress is shown as it really happens (uploading → reading → ready to review), with a plain error and a retry if reading fails.
- **Simple review** — each medicine shows its name, timing, dose, duration and other instructions with **Confirm** and **Edit**. Unclear or unwritten details are flagged, never guessed. "Medicines saved and confirmed" appears only after the server has saved them.
- **Reminder schedules** — times are proposed from what the prescription says (labelled as suggestions where it gives none) and saved only when the user presses Save. Schedules can be edited, paused, limited to certain days, or have notifications turned off.
- **My medications and history** — view, edit and delete medicines (their reminders go with them) and delete prescriptions (with the uploaded image).
- **Scripty, the assistant** — answers questions about the user's own medicines, schedules and prices, and can change a schedule only after the user confirms.
- **Medicine information** — indexed, paginated search over **19 Pakistani products** whose official DRAP maximum retail price, pack size, registration number and manufacturer were each verified against DRAP's price index, with detail pages and FDA label information for the active ingredient. Any other medicine shows "Verified price unavailable" — no price is ever estimated.
- **Account security** — httpOnly cookie sessions, CSRF protection, rate limiting, upload signature checks, and per-user ownership checks on every record.

## Tech Stack

| Area | Technologies |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router, React Hook Form + Zod, Three.js (react-three-fiber) for the landing hero |
| Backend | Node.js, Express, TypeScript, Prisma, PostgreSQL 16 (Docker), Zod, sharp |
| AI | Google Gemini API (prescription reading; Gemma 4 optional), Anthropic Claude API via `@anthropic-ai/sdk` (Scripty; optional fallback reader) |
| Data | DRAP PharmaPrice Index (19 verified products), openFDA drug-label API |
| Testing | Vitest, Supertest |

## How AI Is Used

**Reading prescriptions (Google Gemini).**
1. The server checks the upload is a real image, applies its EXIF rotation and downsizes it.
2. It sends the image to Gemini (`gemini-3.5-flash` by default) with instructions written for Pakistani prescriptions, asking for JSON only.
   **Optional: Gemma 4.** Gemini is the main reader. The open-weight Gemma 4 model can be used instead, through the same Google API key, by setting `GOOGLE_MODEL=gemma-4-31b-it` (or `gemma-4-26b-a4b-it`). It is slower than Gemini (about 110 s per prescription in our testing).
3. For every medicine the model reports each field — name, active ingredient, strength, form, dose, frequency, timing, duration, quantity, instructions — with a confidence and whether it was **read**, **unclear**, **not written**, or (for the active ingredient of a clearly written brand only) **inferred**. The server discards any other inferred value and adds warnings for low-confidence fields.
4. Failures are reported honestly (quota used up, service busy, bad credentials) and can be retried. If `AI_FALLBACK_PROVIDER` is set (e.g. `anthropic`), Claude reads the image when Gemini is out of quota or unavailable.

Nothing the model returns is saved as fact until the user confirms it. Turning the confirmed instructions into reminder times is done by ordinary code, not AI.

**Scripty assistant (Anthropic Claude).** Scripty is a streaming Claude conversation with tool calling. Its tools read only the signed-in user's own prescriptions, medicines and schedules, look up openFDA label text, DRAP-verified prices and interaction mentions, and can *propose* schedule changes — which run only after the user presses Confirm. Without an API key it reports that it is not configured; there is no canned or mock fallback.

## How to Run Locally

**Prerequisites:** Node.js 20 or later, npm, and Docker (for PostgreSQL).

```bash
git clone https://github.com/maryamfatimaJ/Scriptly.git
cd Scriptly

# 1. Database (PostgreSQL on port 5433)
docker compose up -d

# 2. Backend — http://localhost:4000
cd server
npm install
cp ../.env.example .env        # then fill in the values below
npx prisma generate
npx prisma migrate deploy
npm run catalogue:import -- data/drap-verified-2026-10-29.csv --apply   # the 19 verified medicines
npm run dev

# 3. Frontend — http://localhost:5173 (in a second terminal)
cd client
npm install
echo "VITE_API_BASE_URL=http://localhost:4000/api" > .env
npm run dev
```

Values to set in `server/.env` (placeholders — never commit real keys):

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/prescription_db?schema=public"
JWT_ACCESS_SECRET=<random-string>
JWT_REFRESH_SECRET=<random-string>
CSRF_SECRET=<random-string>
# generate each with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

AI_PROVIDER=google
GOOGLE_API_KEY=<your-google-ai-studio-key>      # https://aistudio.google.com/apikey
GOOGLE_MODEL=gemini-3.5-flash                   # optional: gemma-4-31b-it (Gemma 4, slower)
AI_FALLBACK_PROVIDER=                           # optional: anthropic

ANTHROPIC_API_KEY=<your-anthropic-api-key>      # Scripty — https://console.anthropic.com/settings/keys

EMAIL_PROVIDER=none                             # reminders in-app only; "smtp" + SMTP_* to send email
```

`.env.example` documents every setting. Run the backend tests with `cd server && npm test` (needs the database running).

More detail: [`docs/api-reference.md`](docs/api-reference.md), [`docs/extraction-pipeline.md`](docs/extraction-pipeline.md), [`docs/medicine-data-sources.md`](docs/medicine-data-sources.md).

## Future Scope

Not yet built:

- A full Pakistani medicine catalogue, once DRAP (or a licensed provider) grants permission to reuse its complete price and registration data.
- Push and SMS reminders (today: in-app, plus email when SMTP is configured).
- Pakistani product leaflets for medicine information (today: U.S. FDA label text, labelled as such).
- Urdu language support.
- Accuracy measurement on real, consented prescription photos (testing so far used generated sample prescriptions).
- Hosting the backend so the live demo works end to end, and a mobile app.

## Team

- **Maryam Fatima**
- **Muhammad Rehan**

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 Scriptly team.


## Screenshot 
![alt text](image.png)