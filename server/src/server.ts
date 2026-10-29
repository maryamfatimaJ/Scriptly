import { createApp } from "@/app";
import { env, isProduction } from "@/config/env";
import { startReminderScheduler } from "@/services/reminderScheduler.service";
import { validateExtractionConfig } from "@/services/extraction/extractionService";
import { scriptyStatus } from "@/services/scripty/scripty.service";

const INSECURE_DEFAULTS = [
  "dev-insecure-access-secret-change-me",
  "dev-insecure-refresh-secret-change-me",
  "dev-insecure-csrf-secret-change-me",
];

if (isProduction) {
  const usingDefaults = [env.jwtAccessSecret, env.jwtRefreshSecret, env.csrfSecret].some((secret) =>
    INSECURE_DEFAULTS.includes(secret)
  );
  if (usingDefaults) {
    throw new Error(
      "Refusing to start in production with default development secrets. Set JWT_ACCESS_SECRET, " +
        "JWT_REFRESH_SECRET, and CSRF_SECRET to strong, unique values."
    );
  }
}

// Fail fast on a misconfigured vision provider: far better to refuse to
// boot with an actionable message than to let a user upload a prescription
// and only then discover the model was never reachable.
let extractionSummary: string;
try {
  extractionSummary = validateExtractionConfig();
} catch (err) {
  console.error(`\n[config] Prescription extraction is misconfigured:\n  ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
}

const app = createApp();

app.listen(env.port, () => {
  console.log(`Scriptly API listening on http://localhost:${env.port} (${env.nodeEnv})`);
  console.log(`  extraction : ${extractionSummary}`);
  const scripty = scriptyStatus();
  console.log(
    `  scripty    : ${
      scripty.configured
        ? `Claude ${scripty.model} via the Anthropic API`
        : "NOT CONFIGURED — set ANTHROPIC_API_KEY in server/.env to enable Scripty"
    }`
  );
  console.log("  medicines  : openFDA label lookup (no API key required)");
  console.log(
    `  reminders  : EMAIL_PROVIDER=${env.emailProvider}${
      env.emailProvider === "none" ? " (in-app only; no email will be sent)" : ""
    }`
  );
});

// Persistent, DB-backed — survives restarts because it has nothing to
// "remember" in memory; see reminderScheduler.service.ts.
startReminderScheduler();
