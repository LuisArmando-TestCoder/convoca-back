// ── Runtime configuration ────────────────────────────────────────────────────
// Reads env once at startup and fails fast if a required secret is missing.

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

export const config = {
  jwtSecret: required("JWT_SECRET"),
  port: int("PORT", 8000),
  appBaseUrl: (Deno.env.get("APP_BASE_URL") ?? "http://localhost:3000").replace(/\/$/, ""),
  corsOrigins: (Deno.env.get("CORS_ORIGINS") ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  serviceAccountPath: Deno.env.get("SERVICE_ACCOUNT_PATH") || "./service-account.json",
  firestoreDatabase: Deno.env.get("FIRESTORE_DATABASE") || "(default)",
  otpTtlMs: int("OTP_TTL_MINUTES", 10) * 60 * 1000,
  sessionTtlSec: int("SESSION_TTL_DAYS", 7) * 24 * 60 * 60,
} as const;

