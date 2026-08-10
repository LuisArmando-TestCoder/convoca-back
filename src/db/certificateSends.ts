// ── Certificate send log repository (Firestore) ──────────────────────────────
// Persists every certificate send (single test or bulk) so the dashboard can
// show a durable history of what was sent, with which font, at which box
// positions, and to whom — even after a page reload or tab switch.

import { fsCreate, fsList } from "./firestore.ts";
import { paths } from "./paths.ts";

export interface CertificateSend {
  id: string;
  at: string;
  name: string;
  email: string;
  font: string;
  box: { x1: number; y1: number; x2: number; y2: number };
  centerX: number;
  centerY: number;
  maxWidth: number;
  maxHeight: number;
  status: "sent" | "failed";
}

/** Append a send record to the org's certificate_sends subcollection. */
export async function addCertificateSend(
  orgId: string,
  send: Omit<CertificateSend, "id">,
): Promise<CertificateSend> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const doc: CertificateSend = { ...send, id };
  await fsCreate(paths.certificateSendsCol(orgId), id, doc as unknown as Record<string, unknown>);
  return doc;
}

/** List the org's send history, newest first. */
export async function listCertificateSends(orgId: string): Promise<CertificateSend[]> {
  const rows = await fsList<CertificateSend>(paths.certificateSendsCol(orgId));
  return rows
    .map(({ _id: _drop, ...s }) => s as CertificateSend)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}