import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  nodeEnv: optional("NODE_ENV", "development"),
  port: Number(optional("PORT", "4000")),

  databaseUrl: required("DATABASE_URL", "postgresql://postgres:postgres@localhost:5433/prescription_db?schema=public"),

  // Auth / cookies
  jwtAccessSecret: required("JWT_ACCESS_SECRET", "dev-insecure-access-secret-change-me"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET", "dev-insecure-refresh-secret-change-me"),
  accessTokenTtlMinutes: Number(optional("ACCESS_TOKEN_TTL_MINUTES", "15")),
  refreshTokenTtlDays: Number(optional("REFRESH_TOKEN_TTL_DAYS", "30")),
  csrfSecret: required("CSRF_SECRET", "dev-insecure-csrf-secret-change-me"),
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  cookieSecure: optional("COOKIE_SECURE", "false") === "true",

  // CORS
  corsOrigin: optional("CORS_ORIGIN", "http://localhost:5173"),

  // Number of reverse proxies in front of the app, so req.ip (the rate
  // limiter's key) is the user's address, not a proxy's. 1 = one proxy
  // (e.g. Render's load balancer); 2 = Vercel's /api rewrite in front of it.
  trustProxy: Number(optional("TRUST_PROXY", "1")),

  // Uploads
  uploadDir: optional("UPLOAD_DIR", "uploads/prescriptions"),
  maxUploadSizeMb: Number(optional("MAX_UPLOAD_SIZE_MB", "10")),

  // Rate limiting
  rateLimitWindowMinutes: Number(optional("RATE_LIMIT_WINDOW_MINUTES", "15")),
  rateLimitMaxRequests: Number(optional("RATE_LIMIT_MAX_REQUESTS", "300")),
  authRateLimitMaxRequests: Number(optional("AUTH_RATE_LIMIT_MAX_REQUESTS", "20")),

  // --- AI extraction (vision) ------------------------------------------
  // "anthropic" — Claude vision via the Anthropic API; needs
  //               ANTHROPIC_API_KEY. NOTE: sends the prescription image
  //               to Anthropic.
  // "google"    — hosted Gemma 3 via Google AI Studio; needs GOOGLE_API_KEY;
  //               NOTE: this sends the prescription image to Google
  // "xai"       — Grok vision via the xAI API; needs XAI_API_KEY.
  //               NOTE: sends the prescription image to xAI
  // "ollama"    — local Gemma 3 via Ollama; no API key; image stays on device
  // "mock"      — fixed demo data, never reads the image. Automated tests
  //               ONLY: refused at startup outside NODE_ENV=test.
  // There is deliberately no default: which service sees a patient's
  // prescription is a decision the operator must make explicitly.
  aiProvider: optional("AI_PROVIDER", process.env.NODE_ENV === "test" ? "mock" : "") as
    | "anthropic"
    | "mock"
    | "ollama"
    | "google"
    | "xai"
    | "",
  // Optional second provider, tried only when the first one is out of
  // quota, rate limited, overloaded or unreachable. Naming one here is the
  // explicit decision that images may also be sent to that company.
  aiFallbackProvider: optional("AI_FALLBACK_PROVIDER", "") as "anthropic" | "google" | "xai" | "ollama" | "",
  // Must be a Claude model with image input — verified at runtime against
  // the Models API before the first image is sent (AnthropicVisionProvider).
  anthropicVisionModel: optional("ANTHROPIC_VISION_MODEL", "claude-opus-5-5"),

  ollamaBaseUrl: optional("OLLAMA_BASE_URL", "http://localhost:11434"),
  // Must be multimodal. Gemma 3 1B/270M are TEXT-ONLY and are rejected at
  // runtime — see OllamaVisionProvider.
  ollamaModel: optional("OLLAMA_MODEL", "gemma3:4b"),

  googleApiKey: process.env.GOOGLE_API_KEY,
  googleApiBaseUrl: optional("GOOGLE_API_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"),
  googleModel: optional("GOOGLE_MODEL", "gemma-3-4b-it"),

  // --- Medicine catalogue ----------------------------------------------
  // Synthetic medicine rows (seed data, test fixtures) are hidden from the
  // app unless this is "true" — set only by the automated test config.
  catalogueIncludeSynthetic: optional("CATALOGUE_INCLUDE_SYNTHETIC", "false") === "true",
  // Where scripts/importImages.ts stores verified product photos.
  medicineImageDir: optional("MEDICINE_IMAGE_DIR", "uploads/medicine-images"),

  xaiApiKey: process.env.XAI_API_KEY,
  xaiApiBaseUrl: optional("XAI_API_BASE_URL", "https://api.x.ai/v1"),
  // Must accept images — checked against xAI's model list before first use.
  xaiModel: optional("XAI_MODEL", "grok-4"),

  // Vision request limits. Local CPU inference is slow, so the default
  // timeout is generous; lower it if you're on hosted inference.
  visionTimeoutMs: Number(optional("VISION_TIMEOUT_MS", "120000")),
  visionMaxAttempts: Number(optional("VISION_MAX_ATTEMPTS", "3")),

  // Confidence thresholds the extraction pipeline uses to decide when to
  // add its own "needs scrutiny" warnings on top of whatever the provider
  // reports (see services/extraction/extractionService.ts). A field below
  // `low` is treated as needing professional clarification; between `low`
  // and `high` it's flagged for extra review; at/above `high` no
  // threshold-driven warning is added. These are a UX signal only — never
  // treated as proof that a value is medically correct, regardless of
  // how high they are.
  confidenceThresholdLow: Number(optional("CONFIDENCE_THRESHOLD_LOW", "0.5")),
  confidenceThresholdHigh: Number(optional("CONFIDENCE_THRESHOLD_HIGH", "0.8")),

  // How similar an extracted name must be (0..1, see medicineMatching
  // .service.ts) to a medicine_reference row before it counts as a
  // candidate at all. Below this, the field is simply "no verified
  // record" rather than a poor guess.
  medicineMatchMinScore: Number(optional("MEDICINE_MATCH_MIN_SCORE", "0.6")),

  // --- Scripty (in-app assistant) --------------------------------------
  // Scripty is a Claude conversation with tool calling (Anthropic API),
  // independent of the vision provider above. The key is read ONLY here,
  // on the server; it is never sent to the browser, logged, or returned
  // by any endpoint. Without it Scripty reports itself as not configured
  // rather than falling back to canned answers.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  anthropicModel: optional("ANTHROPIC_MODEL", "claude-opus-5-5"),
  // Reasoning depth. "medium" is the model's default and a sensible
  // balance of latency and care for health questions; "low" is faster
  // and cheaper, "high" more thorough.
  scriptyEffort: optional("SCRIPTY_EFFORT", "medium") as "low" | "medium" | "high",
  scriptyMaxOutputTokens: Number(optional("SCRIPTY_MAX_OUTPUT_TOKENS", "16000")),
  // Per request to the API. Thinking plus tool rounds can take a while.
  scriptyTimeoutMs: Number(optional("SCRIPTY_TIMEOUT_MS", "90000")),
  // Conversations are kept in server memory only (see
  // conversationStore.ts) — these bound how long and how large.
  scriptyMaxTurns: Number(optional("SCRIPTY_MAX_TURNS", "30")),
  scriptyConversationTtlMinutes: Number(optional("SCRIPTY_CONVERSATION_TTL_MINUTES", "120")),
  // Messages per user per minute; a cost and abuse backstop.
  scriptyRateLimitPerMinute: Number(optional("SCRIPTY_RATE_LIMIT_PER_MINUTE", "12")),

  // --- Medicine information lookup -------------------------------------
  // openFDA needs no API key at the volumes this app produces. Cached
  // monographs are refreshed only after this many days; a label does not
  // change often, and re-fetching on every page view would be rude to a
  // free public service.
  medicineInfoTimeoutMs: Number(optional("MEDICINE_INFO_TIMEOUT_MS", "15000")),
  monographCacheDays: Number(optional("MONOGRAPH_CACHE_DAYS", "30")),
  // A cached "no label found" is retried sooner than a hit, since upstream
  // coverage does genuinely improve over time.
  monographMissCacheDays: Number(optional("MONOGRAPH_MISS_CACHE_DAYS", "7")),

  // Email reminder delivery. "none" (default) means reminders are tracked
  // and surfaced in-app only — no external send is ever attempted, and
  // ReminderDelivery rows are explicitly marked SKIPPED_NOT_CONFIGURED
  // rather than silently doing nothing or falsely claiming success. "smtp"
  // requires SMTP_HOST/PORT/USER/PASS/FROM_EMAIL — see
  // services/notifications/SmtpEmailProvider.ts.
  emailProvider: optional("EMAIL_PROVIDER", "none") as "none" | "smtp",
  smtpHost: process.env.SMTP_HOST,
  smtpPort: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  smtpSecure: optional("SMTP_SECURE", "false") === "true",
  smtpFromEmail: process.env.SMTP_FROM_EMAIL,
  smtpFromName: optional("SMTP_FROM_NAME", "Scriptly"),

  // Default clock times for doses written relative to meals ("after
  // breakfast") or as dose positions ("1+0+1"). The prescription states
  // the meal; these only turn it into a clock time, which the user can
  // always change before saving. 24-hour HH:mm.
  mealTimeBreakfast: optional("MEAL_TIME_BREAKFAST", "08:00"),
  mealTimeLunch: optional("MEAL_TIME_LUNCH", "13:30"),
  mealTimeDinner: optional("MEAL_TIME_DINNER", "20:00"),
  mealTimeBedtime: optional("MEAL_TIME_BEDTIME", "22:30"),

  // How often the server-side reminder scheduler scans for due reminders,
  // and how many times it retries a failed send before giving up
  // (terminal FAILED status — see reminderScheduler.service.ts).
  reminderSchedulerIntervalSeconds: Number(optional("REMINDER_SCHEDULER_INTERVAL_SECONDS", "60")),
  reminderEmailMaxAttempts: Number(optional("REMINDER_EMAIL_MAX_ATTEMPTS", "5")),
};

export const isProduction = env.nodeEnv === "production";
