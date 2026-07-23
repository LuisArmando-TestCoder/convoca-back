// ── Authentication middleware ────────────────────────────────────────────────
// Validates the Bearer session token, loads the org once, and attaches both to
// the request context. Every dashboard route mounts this.

import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../context.ts";
import { readSession } from "../lib/jwt.ts";
import { getOrg } from "../db/orgs.ts";

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HTTPException(401, { message: "Missing session token." });

  const claims = await readSession(token);
  if (!claims) throw new HTTPException(401, { message: "Invalid or expired session." });

  const org = await getOrg(claims.orgId);
  if (!org) throw new HTTPException(401, { message: "Organization no longer exists." });
  if (!org.verified) throw new HTTPException(403, { message: "Organization not verified." });

  c.set("session", claims);
  c.set("org", org);
  await next();
});

/** Restricts a route to org owners (e.g. billing, collaborator management). */
export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("session").role !== "owner") {
    throw new HTTPException(403, { message: "Owner access required." });
  }
  await next();
});
