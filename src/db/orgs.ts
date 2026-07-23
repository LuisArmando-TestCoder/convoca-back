// ── Org / collaborator / OTP repository (Firestore) ──────────────────────────

import { fsCreate, fsDelete, fsGet, fsList, fsSet } from "./firestore.ts";
import { paths } from "./paths.ts";
import { emailKey } from "../lib/hash.ts";
import type { Collaborator, Organization, Role } from "../types.ts";

// ---- Organizations ----------------------------------------------------------
// orgId === sha256(email), so email-uniqueness comes for free from the doc id.

export async function createOrg(org: Organization): Promise<void> {
  const ok = await fsCreate(paths.orgsCol(), org.id, org as unknown as Record<string, unknown>);
  if (!ok) throw new Error("ORG_EXISTS");
}

export function getOrg(orgId: string): Promise<Organization | null> {
  return fsGet<Organization>(paths.org(orgId));
}

export async function getOrgByEmail(email: string): Promise<Organization | null> {
  return getOrg(await emailKey(email));
}

export async function updateOrg(org: Organization): Promise<void> {
  await fsSet(paths.org(org.id), org as unknown as Record<string, unknown>);
}

// ---- Collaborators ----------------------------------------------------------

export async function addCollaborator(c: Collaborator): Promise<void> {
  const key = await emailKey(c.email);
  await fsSet(paths.collaborator(c.orgId, key), c as unknown as Record<string, unknown>);
  await fsSet(paths.collaboratorIndex(key), { orgId: c.orgId });
}

export async function removeCollaborator(orgId: string, email: string): Promise<void> {
  const key = await emailKey(email);
  await fsDelete(paths.collaborator(orgId, key));
  await fsDelete(paths.collaboratorIndex(key));
}

export async function listCollaborators(orgId: string): Promise<Collaborator[]> {
  const rows = await fsList<Collaborator>(paths.collaboratorsCol(orgId));
  return rows.map(({ _id: _drop, ...c }) => c as Collaborator);
}

/**
 * Resolves who may sign in with `email` and under which org/role.
 * An org owner outranks a collaborator with the same address.
 */
export async function resolveLogin(email: string): Promise<{ orgId: string; role: Role } | null> {
  const owner = await getOrgByEmail(email);
  if (owner) return { orgId: owner.id, role: "owner" };

  const key = await emailKey(email);
  const idx = await fsGet<{ orgId: string }>(paths.collaboratorIndex(key));
  if (idx?.orgId) return { orgId: idx.orgId, role: "collaborator" };

  return null;
}

// ---- OTP --------------------------------------------------------------------

interface OtpRecord {
  code: string;
  expiresAt: number;
}

export async function saveOtp(email: string, code: string, ttlMs: number): Promise<void> {
  const key = await emailKey(email);
  await fsSet(paths.otp(key), { code, expiresAt: Date.now() + ttlMs });
}

/** Verifies + consumes the OTP (single use). Returns true on match. */
export async function consumeOtp(email: string, code: string): Promise<boolean> {
  const key = await emailKey(email);
  const rec = await fsGet<OtpRecord>(paths.otp(key));
  if (!rec) return false;
  const ok = rec.code === code && rec.expiresAt > Date.now();
  if (ok) await fsDelete(paths.otp(key));
  return ok;
}
