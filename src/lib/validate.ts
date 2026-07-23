// ── Input validation ─────────────────────────────────────────────────────────
// Small, dependency-free validators. Every route trusts NOTHING from the client.

import { HTTPException } from "hono/http-exception";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function fail(status: number, message: string): never {
  throw new HTTPException(status as any, { message });
}

/** Random cryptographically-strong numeric OTP (default 6 digits). */
export function generateCode(length = 6): string {
  const max = 10 ** length;
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % max;
  return n.toString().padStart(length, "0");
}

/** Opaque URL-safe id for links/tokens. */
export function randomId(bytes = 16): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function isEmail(v: unknown): v is string {
  return typeof v === "string" && EMAIL_RE.test(v.trim());
}

export function requireString(v: unknown, field: string, max = 300): string {
  if (typeof v !== "string" || v.trim().length === 0) {
    fail(400, `${field} is required.`);
  }
  const s = (v as string).trim();
  if (s.length > max) fail(400, `${field} is too long (max ${max}).`);
  return s;
}

export function requireEmail(v: unknown, field = "email"): string {
  const s = requireString(v, field);
  if (!isEmail(s)) fail(400, `${field} is not a valid email.`);
  return s.toLowerCase();
}

export function optionalString(v: unknown, max = 2000): string {
  if (v == null) return "";
  if (typeof v !== "string") fail(400, "Expected a string.");
  const s = v.trim();
  if (s.length > max) fail(400, `Value is too long (max ${max}).`);
  return s;
}
