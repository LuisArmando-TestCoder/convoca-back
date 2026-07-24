// ── Participants repository (Firestore) ──────────────────────────────────────

import {
  fsCasUpdate,
  fsCreate,
  fsDelete,
  fsGet,
  fsGetWithMeta,
  fsList,
  fsSet,
} from "./firestore.ts";

import { paths } from "./paths.ts";
import type { CheckinResult, Participant } from "../types.ts";

/**
 * Idempotent create: the doc id is the identity hash, so re-adding the exact
 * same person is a no-op create (`created:false`) and preserves their existing
 * attendance state. Uses create-if-absent so two racing adds can't clobber.
 */
export async function upsertParticipant(
  p: Participant,
): Promise<{ created: boolean; participant: Participant }> {
  const col = paths.participantsCol(p.orgId, p.eventId);
  const created = await fsCreate(col, p.hash, p as unknown as Record<string, unknown>);
  if (created) return { created: true, participant: p };
  const existing = await getParticipant(p.orgId, p.eventId, p.hash);
  return { created: false, participant: existing ?? p };
}

export function getParticipant(
  orgId: string,
  eventId: string,
  hash: string,
): Promise<Participant | null> {
  return fsGet<Participant>(paths.participant(orgId, eventId, hash));
}

export async function updateParticipant(p: Participant): Promise<void> {
  await fsSet(
    paths.participant(p.orgId, p.eventId, p.hash),
    p as unknown as Record<string, unknown>,
  );
}

export async function deleteParticipant(
  orgId: string,
  eventId: string,
  hash: string,
): Promise<void> {
  await fsDelete(paths.participant(orgId, eventId, hash));
}

export async function listParticipants(orgId: string, eventId: string): Promise<Participant[]> {
  const rows = await fsList<Participant>(paths.participantsCol(orgId, eventId));
  return rows
    .map(({ _id: _drop, ...p }) => p as Participant)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Race-safe check-in via compare-and-set on the doc's updateTime. Concurrent
 * scans of the same code resolve to exactly one `success`; the loser gets
 * `duplicate`.
 */
export async function checkIn(
  orgId: string,
  eventId: string,
  hash: string,
): Promise<CheckinResult> {
  const path = paths.participant(orgId, eventId, hash);
  const entry = await fsGetWithMeta<Participant>(path);

  if (!entry) {
    return {
      outcome: "not_found",
      participant: null,
      registeredAt: null,
      message: "This code is not registered for this event.",
    };
  }

  const p = entry.data;
  if (p.registered) {
    return {
      outcome: "duplicate",
      participant: { name: p.name, email: p.email, country: p.country },
      registeredAt: p.registeredAt,
      message: "Already checked in.",
    };
  }

  const now = new Date().toISOString();
  const updated: Participant = { ...p, registered: true, registeredAt: now };
  const won = await fsCasUpdate(
    path,
    updated as unknown as Record<string, unknown>,
    entry.updateTime,
  );

  if (!won) {
    return {
      outcome: "duplicate",
      participant: { name: p.name, email: p.email, country: p.country },
      registeredAt: now,
      message: "Already checked in.",
    };
  }

  return {
    outcome: "success",
    participant: { name: p.name, email: p.email, country: p.country },
    registeredAt: now,
    message: "Checked in.",
  };
}
