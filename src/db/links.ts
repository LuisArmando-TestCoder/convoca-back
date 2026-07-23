// ── Self-registration links repository (Firestore) ───────────────────────────
// The full link lives at a top-level `links/{id}` (public lookup by id needs no
// org context). A per-event index subcollection lets the dashboard list them.

import { fsGet, fsListIds, fsSet } from "./firestore.ts";
import { paths } from "./paths.ts";
import type { SelfRegLink } from "../types.ts";

export async function createLink(link: SelfRegLink): Promise<void> {
  await fsSet(paths.link(link.id), link as unknown as Record<string, unknown>);
  await fsSet(paths.linkIndex(link.orgId, link.eventId, link.id), { id: link.id });
}

export function getLink(linkId: string): Promise<SelfRegLink | null> {
  return fsGet<SelfRegLink>(paths.link(linkId));
}

export async function listLinks(orgId: string, eventId: string): Promise<SelfRegLink[]> {
  const ids = await fsListIds(paths.linkIndexCol(orgId, eventId));
  const links = await Promise.all(ids.map((id) => getLink(id)));
  return links
    .filter((l): l is SelfRegLink => l !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function setLinkActive(link: SelfRegLink, active: boolean): Promise<void> {
  await fsSet(paths.link(link.id), { ...link, active } as unknown as Record<string, unknown>);
}
