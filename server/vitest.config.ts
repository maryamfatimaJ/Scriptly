import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests share one real Postgres; under a full parallel run a
    // DB-heavy test can exceed the 5s default without anything being wrong.
    testTimeout: 20000,
    // These are integration tests against one real, shared Postgres
    // database (see tests/helpers/testClient.ts) — including background
    // functions like processDueReminders() that intentionally scan the
    // *entire* reminders table, as they must in production. Running test
    // FILES in parallel (vitest's default) puts them in separate
    // processes that still hit the same database, so one file's global
    // scan can pick up — and in reminderDeliveryFailure.test.ts's case,
    // apply a MOCKED always-failing email provider to — another file's
    // in-flight reminder. Disabling file parallelism serializes all test
    // files into one process, which is what makes this suite
    // deterministic; it was flaky (not broken) without this.
    fileParallelism: false,
    // Pinned for every test run, whatever server/.env says: the suite must
    // never send an image to a real AI provider or a real email. dotenv
    // does not override variables that are already set, so these win.
    // Tests that exercise a real provider live in scripts/ and say so.
    env: {
      AI_PROVIDER: "mock",
      EMAIL_PROVIDER: "none",
      // Real credentials are blanked so no test can ever reach a paid API.
      ANTHROPIC_API_KEY: "",
      GOOGLE_API_KEY: "",
      XAI_API_KEY: "",
      AI_FALLBACK_PROVIDER: "",
      // Tests create clearly-marked synthetic medicines and must see them.
      CATALOGUE_INCLUDE_SYNTHETIC: "true",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
