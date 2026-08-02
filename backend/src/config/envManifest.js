'use strict';

/**
 * The environment contract.
 *
 * WHY THIS EXISTS. Acureal reads 90+ environment variables across the backend
 * and 4 in the browser bundle, and until now nothing wrote down what any of
 * them were for, who may see them, or whether they were still used. That gap is
 * not academic — it has already produced real defects:
 *
 *   • `Acureal_SKIP_CHART_INJECTION` — a rebrand sweep renamed the VARIABLE
 *     ITSELF from `REDIP_SKIP_*`. Environment names are case-sensitive, so any
 *     operator who had the old switch set was left holding a dead kill switch,
 *     silently. A naming rule would have caught it in review.
 *   • `VITE_GOOGLE_MAPS_API_KEY` is compiled into the shipped bundle and is
 *     public by construction, regardless of what a hosting dashboard labels it.
 *     Nothing in the codebase said so.
 *   • Several Supabase keys appear in the deployment but are referenced nowhere
 *     in code. Unused credentials are attack surface.
 *
 * WHAT IT ENFORCES. `scripts/check-env-manifest.js` runs in CI and fails on:
 *   1. a variable referenced in code but not registered here;
 *   2. a name that is not SCREAMING_SNAKE_CASE;
 *   3. a `secret` marked readable by the browser;
 *   4. scope and prefix disagreeing (`client` must be `VITE_`, `server` must not).
 *
 * It cannot see the hosting dashboard, so it cannot prove a variable is SET —
 * `validateEnv` owns that at boot, and derives its own required/recommended
 * lists from this file so the two can never drift.
 *
 * FIELDS
 *   scope        server   — read only in the Node process
 *                client   — compiled into the browser bundle; PUBLIC, always
 *                platform — injected by Vercel/Node; we never set it
 *   sensitivity  secret   — a credential; leaking it is an incident
 *                config   — behavioural, not a credential
 *                public   — safe for anyone to read
 *   requirement  critical — the app must refuse to boot without it
 *                recommended — a feature degrades without it
 *                optional — a tuning knob or an escape hatch
 */

const SCOPE = Object.freeze({ SERVER: 'server', CLIENT: 'client', PLATFORM: 'platform' });
const SENSITIVITY = Object.freeze({ SECRET: 'secret', CONFIG: 'config', PUBLIC: 'public' });
const REQUIREMENT = Object.freeze({ CRITICAL: 'critical', RECOMMENDED: 'recommended', OPTIONAL: 'optional' });

const { SERVER, CLIENT, PLATFORM } = SCOPE;
const { SECRET, CONFIG, PUBLIC } = SENSITIVITY;
const { CRITICAL, RECOMMENDED, OPTIONAL } = REQUIREMENT;

/** @type {Array<{name:string,scope:string,sensitivity:string,requirement:string,why:string,note?:string}>} */
const ENV_MANIFEST = [
  // ── Core platform (injected — we never set these) ────────────────────────
  { name: 'NODE_ENV', scope: PLATFORM, sensitivity: CONFIG, requirement: OPTIONAL, why: 'production / development / test switch' },
  { name: 'PORT', scope: PLATFORM, sensitivity: CONFIG, requirement: OPTIONAL, why: 'local listen port; Vercel assigns its own' },
  { name: 'VERCEL', scope: PLATFORM, sensitivity: CONFIG, requirement: OPTIONAL, why: 'present on any Vercel deployment; gates serverless-only behaviour' },
  { name: 'VERCEL_ENV', scope: PLATFORM, sensitivity: CONFIG, requirement: OPTIONAL, why: 'production / preview / development' },
  { name: 'VERCEL_URL', scope: PLATFORM, sensitivity: CONFIG, requirement: OPTIONAL, why: 'the deployment host, used to build absolute links' },
  { name: 'VERCEL_GIT_COMMIT_SHA', scope: PLATFORM, sensitivity: CONFIG, requirement: OPTIONAL, why: 'release stamp for Sentry' },

  // ── Database ─────────────────────────────────────────────────────────────
  { name: 'DATABASE_URL', scope: SERVER, sensitivity: SECRET, requirement: CRITICAL, why: 'the Postgres connection, including the role password' },
  { name: 'DATABASE_SSL_MODE', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'relaxed | verify-full | disable — how the server certificate is checked' },
  { name: 'DATABASE_CA_CERT', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'PEM of the provider CA; REQUIRED when DATABASE_SSL_MODE=verify-full, because Supabase signs the pooler with a private CA' },
  { name: 'RLS_ENFORCED', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'historical kill-switch for the M1 auth-definer rollout', note: 'DEAD: authDefiners now gates on the live rolbypassrls probe and nothing reads this. Slated for removal with M1 Phase 6.' },

  // ── Auth + signing ───────────────────────────────────────────────────────
  { name: 'JWT_SECRET', scope: SERVER, sensitivity: SECRET, requirement: CRITICAL, why: 'signs session tokens' },
  { name: 'JWT_EXPIRES_IN', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'access-token lifetime' },
  { name: 'DEAL_EVENTS_HMAC_KEY', scope: SERVER, sensitivity: SECRET, requirement: CRITICAL, why: 'signs the tamper-evident audit trail; an unsigned trail is not an audit trail' },
  { name: 'AUDIT_HMAC_KEY', scope: SERVER, sensitivity: SECRET, requirement: OPTIONAL, why: 'legacy audit signing key' },
  { name: 'PARCEL_SIGNING_SECRET', scope: SERVER, sensitivity: SECRET, requirement: OPTIONAL, why: 'signs parcel-intelligence snapshots so an export can be replayed' },
  { name: 'GOOGLE_OAUTH_CLIENT_ID', scope: SERVER, sensitivity: CONFIG, requirement: RECOMMENDED, why: 'verifies Google sign-in ID tokens' },
  { name: 'PLATFORM_ADMIN_EMAILS', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'break-glass operator allowlist; the persisted users.is_platform_admin flag is the primary gate' },
  { name: 'REFRESH_ROTATION_GRACE_MS', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'tolerates a racing refresh from a second tab' },
  { name: 'REFRESH_TOKEN_FORENSIC_DAYS', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'how long revoked token families are kept for forensics' },
  { name: 'SKIP_PASSWORD_BREACH_CHECK', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'test-only escape hatch for the k-anonymity breach lookup' },
  { name: 'LOGIN_ATTEMPTS_RETENTION_DAYS', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'lockout-table retention' },

  // ── AI providers ─────────────────────────────────────────────────────────
  { name: 'GEMINI_API_KEY', scope: SERVER, sensitivity: SECRET, requirement: RECOMMENDED, why: 'document extraction and classification' },
  { name: 'OPENAI_API_KEY', scope: SERVER, sensitivity: SECRET, requirement: RECOMMENDED, why: 'reasoning and embeddings' },
  { name: 'ANTHROPIC_API_KEY', scope: SERVER, sensitivity: SECRET, requirement: RECOMMENDED, why: 'narrative synthesis' },
  { name: 'GEMINI_MODEL', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'overrides the registry default without a deploy' },
  { name: 'OPENAI_MODEL', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'overrides the registry default without a deploy' },
  { name: 'CLAUDE_MODEL', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'overrides the registry default without a deploy' },
  { name: 'OPENAI_EMBEDDING_MODEL', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'overrides the embedding model; changing it re-embeds into a different vector space' },
  { name: 'AI_DAILY_COST_CAP_USD', scope: SERVER, sensitivity: CONFIG, requirement: RECOMMENDED, why: 'hard daily ceiling on AI spend; calls are NOT capped until this is set' },
  { name: 'AI_COST_OVERRIDES_JSON', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'live price-table overrides for negotiated rates' },
  { name: 'AI_CALL_LOGS_RETENTION_DAYS', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'AI telemetry retention' },
  { name: 'AI_TRACE_ENABLED', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'per-call AI tracing spans' },
  { name: 'AI_MARKET_CONTEXT_ENABLED', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'feature flag for AI market context' },
  { name: 'AI_PROVIDER_DOCUMENT_CLASSIFICATION', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'per-task provider override' },
  { name: 'AI_PROVIDER_DOCUMENT_EXTRACTION', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'per-task provider override' },
  { name: 'AI_PROVIDER_TRANSLATION', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'per-task provider override' },
  { name: 'AI_PROVIDER_REASONING', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'per-task provider override' },
  { name: 'AI_PROVIDER_MARKET_SYNTHESIS', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'per-task provider override' },
  { name: 'AI_PROVIDER_NARRATIVE_SYNTHESIS', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'per-task provider override' },
  { name: 'TONE_CLASSIFIER_USE_AI', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'opts the Deal Doctor tone gate into a second AI pass' },
  { name: 'RECOMMENDATION_NARRATOR_ENABLED', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'feature flag for AI-narrated recommendations' },

  // ── Storage ──────────────────────────────────────────────────────────────
  // Requirement is `optional` only because validateEnv has a dedicated
  // "no document storage configured" check spanning Blob AND Supabase — marking
  // these recommended too would warn twice for one problem.
  { name: 'SUPABASE_URL', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'Supabase project endpoint for Storage' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', scope: SERVER, sensitivity: SECRET, requirement: OPTIONAL, why: 'server-side Storage access; bypasses RLS, never goes near a browser' },
  { name: 'SUPABASE_KEY', scope: SERVER, sensitivity: SECRET, requirement: OPTIONAL, why: 'legacy alias for SUPABASE_SERVICE_ROLE_KEY', note: 'Alias kept for compatibility. Prefer the explicit name; retire once the deployment is confirmed to use it.' },
  { name: 'SUPABASE_STORAGE_BUCKET', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'document bucket name' },
  { name: 'BLOB_READ_WRITE_TOKEN', scope: SERVER, sensitivity: SECRET, requirement: OPTIONAL, why: 'Vercel Blob storage; preferred over Supabase Storage when set' },
  { name: 'BLOB_ACCESS', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'Blob visibility setting' },
  { name: 'STORAGE_PROVIDER', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'forces a storage backend instead of auto-detecting' },
  { name: 'MAX_FILE_SIZE_MB', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'upload ceiling' },
  { name: 'DOCUMENT_EXTRACTION_MAX_FILE_SIZE_MB', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'extraction ceiling, separate from the upload ceiling' },

  // ── Email ────────────────────────────────────────────────────────────────
  { name: 'RESEND_API_KEY', scope: SERVER, sensitivity: SECRET, requirement: RECOMMENDED, why: 'transactional email; verification and password reset silently do not send without it' },
  { name: 'MAIL_FROM', scope: SERVER, sensitivity: CONFIG, requirement: RECOMMENDED, why: 'sender identity on outbound mail' },
  { name: 'APP_BASE_URL', scope: SERVER, sensitivity: CONFIG, requirement: RECOMMENDED, why: 'origin used to build verification and reset links; email links are DEAD without it' },
  { name: 'APP_URL', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'fallback origin for export links' },
  { name: 'FRONTEND_URL', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'fallback origin for export links' },
  { name: 'NEXT_PUBLIC_APP_URL', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'last fallback in the export-link chain', note: 'A Next.js naming convention in a Vite + Express app — almost certainly never set. Harmless as a final fallback; delete once confirmed absent from every environment.' },
  { name: 'CORS_ORIGINS', scope: SERVER, sensitivity: CONFIG, requirement: RECOMMENDED, why: 'browser origins allowed to call the API' },

  // ── External data providers ──────────────────────────────────────────────
  { name: 'GOOGLE_MAPS_API_KEY', scope: SERVER, sensitivity: SECRET, requirement: RECOMMENDED, why: 'server-side geocoding and static maps', note: 'MUST be a different key from VITE_GOOGLE_MAPS_API_KEY. The browser key is public; this one is not.' },
  { name: 'LANDEED_API_KEY', scope: SERVER, sensitivity: SECRET, requirement: OPTIONAL, why: 'title/guidance vendor lookups' },
  { name: 'LANDEED_GUIDANCE_VALUE_ENDPOINT', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'vendor endpoint override' },
  { name: 'LANDEED_TIMEOUT_MS', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'vendor timeout' },
  { name: 'KGIS_BASE_URL', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'Karnataka GIS cadastral endpoint' },
  { name: 'KGIS_TIMEOUT_MS', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'K-GIS timeout' },
  { name: 'OSM_OVERPASS_URL', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'Overpass endpoint for road-width lookups' },
  { name: 'OSM_OVERPASS_TIMEOUT_MS', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'Overpass timeout' },
  { name: 'OSM_ROAD_SEARCH_RADIUS_M', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'road search radius' },
  { name: 'MASTER_PLAN_RMP2015_TILE_BASE', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'RMP-2015 raster tile source' },
  { name: 'MASTER_PLAN_MIRROR_MAX_Z', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'tile mirror depth' },

  // ── Ingestion + cron ─────────────────────────────────────────────────────
  { name: 'CRON_SECRET', scope: SERVER, sensitivity: SECRET, requirement: RECOMMENDED, why: 'authenticates Vercel cron calls; without it the cron routes are open' },
  { name: 'INGEST_WEBHOOK_HMAC_KEY', scope: SERVER, sensitivity: SECRET, requirement: OPTIONAL, why: 'verifies inbound ingest webhooks' },
  { name: 'INGEST_WEBHOOK_BASIC_USER', scope: SERVER, sensitivity: SECRET, requirement: OPTIONAL, why: 'basic-auth user for the ingest webhook' },
  { name: 'INGEST_WEBHOOK_BASIC_PASS', scope: SERVER, sensitivity: SECRET, requirement: OPTIONAL, why: 'basic-auth password for the ingest webhook' },
  { name: 'DEFAULT_INGEST_ORGANIZATION_ID', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'workspace that un-attributed ingests land in' },

  // ── Platform data + retention ────────────────────────────────────────────
  { name: 'PLATFORM_ORG_ID', scope: SERVER, sensitivity: CONFIG, requirement: RECOMMENDED, why: 'pins the shared comps/benchmark workspace; platform data renders EMPTY for other users without it' },
  { name: 'ACCOUNT_ERASURE_GRACE_DAYS', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'DPDP erasure grace window' },
  { name: 'SOFT_DELETE_RETENTION_DAYS', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'soft-delete sweep window' },
  { name: 'PARCEL_SNAPSHOT_STALE_DAYS', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'parcel cache staleness' },
  { name: 'DEAL_WORKSPACE_CACHE_ENABLED', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'deal read-model cache flag' },
  { name: 'DEAL_WORKSPACE_CACHE_TTL_MS', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'deal read-model cache TTL' },

  // ── Observability ────────────────────────────────────────────────────────
  { name: 'SENTRY_DSN', scope: SERVER, sensitivity: PUBLIC, requirement: OPTIONAL, why: 'error reporting endpoint; a DSN only sends, it cannot read' },
  { name: 'LOG_LEVEL', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'log verbosity' },
  { name: 'LOG_FORMAT', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'json or pretty' },
  { name: 'LIVENESS_WINDOW_HOURS', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'watchdog detection window' },
  { name: 'LIVENESS_AI_ERROR_THRESHOLD', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'watchdog AI error-share threshold' },
  { name: 'LIVENESS_AI_MIN_SAMPLE', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'watchdog minimum sample before alerting' },
  { name: 'LIVENESS_STUCK_EXTRACTION_MINUTES', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'watchdog stuck-extraction threshold' },

  // ── Feature flags + escape hatches ───────────────────────────────────────
  { name: 'DOCX_REPORT_ENABLED', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'gates the DOCX underwriting report' },
  { name: 'XLSX_V1_FORCE', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'forces the legacy workbook builder' },
  { name: 'DEBT_ENGINE_KILL', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'kill switch for the debt engine' },
  { name: 'DEBT_ENGINE_V2_KILL', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'kill switch for the v2 debt engine' },
  { name: 'ACUREAL_SKIP_CHART_INJECTION', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'skips native-chart XML splicing when diagnosing a corrupt workbook' },
  { name: 'ACUREAL_SKIP_SPARKLINE_INJECTION', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'skips sparkline splicing when diagnosing a corrupt workbook' },
  { name: 'ACUREAL_SKIP_ALL_POST_INJECTION', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'skips both post-injection passes' },
  { name: 'REDIP_SKIP_CHART_INJECTION', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'pre-rebrand name, still honoured', note: 'Legacy. The rebrand renamed the variable itself; reading both means an operator who set the old one keeps working.' },
  { name: 'REDIP_SKIP_SPARKLINE_INJECTION', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'pre-rebrand name, still honoured', note: 'Legacy — see REDIP_SKIP_CHART_INJECTION.' },
  { name: 'REDIP_SKIP_ALL_POST_INJECTION', scope: SERVER, sensitivity: CONFIG, requirement: OPTIONAL, why: 'pre-rebrand name, still honoured', note: 'Legacy — see REDIP_SKIP_CHART_INJECTION.' },

  // ── Browser bundle — PUBLIC BY CONSTRUCTION ──────────────────────────────
  // Vite inlines every VITE_* value into the built JavaScript. Whatever a
  // hosting dashboard calls it, anyone who loads the site can read it.
  { name: 'VITE_API_URL', scope: CLIENT, sensitivity: PUBLIC, requirement: OPTIONAL, why: 'API origin; same-origin by default' },
  { name: 'VITE_SENTRY_DSN', scope: CLIENT, sensitivity: PUBLIC, requirement: OPTIONAL, why: 'browser error reporting; a DSN only sends' },
  { name: 'VITE_MASTER_PLAN_TILE_URL', scope: CLIENT, sensitivity: PUBLIC, requirement: OPTIONAL, why: 'master-plan raster tiles, fetched client-side' },
  { name: 'VITE_GOOGLE_MAPS_API_KEY', scope: CLIENT, sensitivity: PUBLIC, requirement: OPTIONAL, why: 'Maps JS API in the browser', note: 'Verified present as a literal in dist/assets/CompsMap-*.js. Must be HTTP-referrer restricted in Google Cloud and must NOT be the same key as GOOGLE_MAPS_API_KEY.' },
];

// Vite injects these into `import.meta.env`; they are not ours to register.
const VITE_BUILTINS = new Set(['DEV', 'PROD', 'MODE', 'SSR', 'BASE_URL']);

const byName = new Map(ENV_MANIFEST.map((entry) => [entry.name, entry]));

const getEnvEntry = (name) => byName.get(name) || null;
const isRegistered = (name) => byName.has(name);

const namesWhere = (predicate) => ENV_MANIFEST.filter(predicate).map((e) => e.name);

/** Variables the app must refuse to boot without. */
const criticalVars = () => ENV_MANIFEST.filter((e) => e.requirement === CRITICAL);
/** Variables whose absence degrades a feature but must not stop the boot. */
const recommendedVars = () => ENV_MANIFEST.filter((e) => e.requirement === RECOMMENDED);
/** Anything a leak of which is an incident. */
const secretVars = () => namesWhere((e) => e.sensitivity === SECRET);

module.exports = {
  ENV_MANIFEST,
  SCOPE,
  SENSITIVITY,
  REQUIREMENT,
  VITE_BUILTINS,
  getEnvEntry,
  isRegistered,
  criticalVars,
  recommendedVars,
  secretVars,
};
