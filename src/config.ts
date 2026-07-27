// ── Runtime configuration ────────────────────────────────────────────────────
// Reads env once at startup and fails fast if a required secret is missing.
// Auto-loads `.env` from the CWD so the server works whether it's launched with
// `deno task start` (which also passes --env-file) or a bare `deno run -A
// main.ts`. Real environment variables always win (load never overrides them).
import "jsr:@std/dotenv@^0.225.2/load";

function required(name: string): string {
  const v = Deno.env.get(name);
  if (!v) {
    console.error(`FATAL: environment variable ${name} is not set.`);
    Deno.exit(1);
  }
  return v;
}

function int(name: string, fallback: number): number {
  const v = Deno.env.get(name);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

// The platform's own Gmail / Google Workspace sender (App Password auth). When
// set, it's the default sender for all outgoing mail; an org may still override
// it with its own Gmail. Whitespace in the App Password is stripped.
function appEmailFromEnv(): { user: string; pass: string } | null {
  const user = Deno.env.get("APP_GMAIL_USER")?.trim();
  const pass = (Deno.env.get("APP_GMAIL_PASS") ?? "").replace(/\s+/g, "");
  return user && pass ? { user, pass } : null;
}

export const config = {
  jwtSecret: required("JWT_SECRET"),
  port: int("PORT", 8000),
  appBaseUrl: (Deno.env.get("APP_BASE_URL") ?? "http://localhost:3000").replace(/\/$/, ""),
  appEmail: appEmailFromEnv(),
  serviceAccountPath: Deno.env.get("SERVICE_ACCOUNT_PATH") || "./service-account.json",
  firestoreDatabase: Deno.env.get("FIRESTORE_DATABASE") || "(default)",
  otpTtlMs: int("OTP_TTL_MINUTES", 10) * 60 * 1000,
  sessionTtlSec: int("SESSION_TTL_DAYS", 7) * 24 * 60 * 60,
  // Pause between each QR email in a bulk send, so a burst doesn't trip Gmail's
  // per-second/per-minute limits (which silently drop the overflow).
  sendDelayMs: int("SEND_DELAY_MS", 700),
} as const;

