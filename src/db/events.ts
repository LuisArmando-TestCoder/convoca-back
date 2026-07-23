// ── Events repository (Firestore) ────────────────────────────────────────────

import { fsDelete, fsGet, fsList, fsListIds, fsSet } from "./firestore.ts";
import { paths } from "./paths.ts";
import type { EventDoc } from "../types.ts";

export async function createEvent(ev: EventDoc): Promise<void> {
  await fsSet(paths.event(ev.orgId, ev.id), ev as unknown as Record<string, unknown>);
}

export function getEvent(orgId: string, eventId: string): Promise<EventDoc | null> {
  return fsGet<EventDoc>(paths.event(orgId, eventId));
}

export async function listEvents(orgId: string): Promise<EventDoc[]> {
  const rows = await fsList<EventDoc>(paths.eventsCol(orgId));
  return rows
    .map(({ _id: _drop, ...ev }) => ev as EventDoc)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first
}

export async function updateEvent(ev: EventDoc): Promise<void> {
  await fsSet(paths.event(ev.orgId, ev.id), ev as unknown as Record<string, unknown>);
}

export async function deleteEvent(orgId: string, eventId: string): Promise<void> {
  // Cascade: remove participants + link index + the links themselves + the event.
  const participants = await fsListIds(paths.participantsCol(orgId, eventId));
  await Promise.all(participants.map((h) => fsDelete(paths.participant(orgId, eventId, h))));

  const linkIds = await fsListIds(paths.linkIndexCol(orgId, eventId));
  await Promise.all(linkIds.flatMap((id) => [
    fsDelete(paths.link(id)),
    fsDelete(paths.linkIndex(orgId, eventId, id)),
  ]));

  await fsDelete(paths.event(orgId, eventId));
}
