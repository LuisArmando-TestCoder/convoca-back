// ── Session tokens ───────────────────────────────────────────────────────────
// Stateless JWT sessions signed with the server secret. Reuses Hono's crypto
// so there is no extra dependency.

import { sign, verify } from "hono/jwt";
import { config } from "../config.ts";
import type { Role, SessionClaims } from "../types.ts";

export async function issueSession(email: string, orgId: string, role: Role): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + config.sessionTtlSec;
  return await sign({ email, orgId, role, exp }, config.jwtSecret, "HS256");
}

export async function readSession(token: string): Promise<SessionClaims | null> {
  try {
    const payload = await verify(token, config.jwtSecret, "HS256");

    return payload as unknown as SessionClaims;
  } catch {
    return null;
  }
}
