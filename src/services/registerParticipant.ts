// ── Participant registration service ─────────────────────────────────────────
// The ONE place that turns four bare fields into a participant + QR email.
// Reused by the dashboard "add participant" path AND the public self-reg path so
// the identity/QR/email behavior can never drift between them.

import { type IdentityFields, participantHash } from "../lib/hash.ts";
import { qrDataUrl } from "../lib/qr.ts";
import { sendEmail } from "../lib/email.ts";
import { qrInviteEmail, selfRegConfirmEmail } from "../lib/emailTemplates.ts";
import { updateParticipant, upsertParticipant } from "../db/participants.ts";
import type { EventDoc, Organization, Participant, ParticipantSource } from "../types.ts";

export interface RegisterInput extends IdentityFields {
  /** Team-defined field values, keyed by EventField.key. */
  fields?: Record<string, string>;
  source: ParticipantSource;
  createdBy: string;
}


export interface RegisterOptions {
  /** Email the QR immediately. CSV imports pass false → participant stays pending. */
  sendInvite?: boolean;
}

export interface RegisterOutcome {
  created: boolean;
  emailed: boolean;
  participant: Participant;
}

/** Renders the QR PNG from the participant hash and emails it via the resolved sender. */
async function emailQr(
  org: Organization,
  event: EventDoc,
  p: Participant,
  isSelf: boolean,
): Promise<void> {
  const dataUrl = await qrDataUrl(p.hash);
  const base64 = dataUrl.split(",")[1] ?? "";
  const cid = "qr@convoca";
  const eventDate = event.date ? new Date(event.date).toLocaleString() : "";
  const tpl = isSelf
    ? selfRegConfirmEmail(org.name, p.name, event.name, event.description, cid)
    : qrInviteEmail(org.name, p.name, event.name, eventDate, event.description, cid);

  await sendEmail({
    org,
    to: p.email,
    // Replies go to the team's inbox even though it's sent from the platform account.
    replyTo: org.email,
    subject: tpl.subject,
    html: tpl.html,
    attachments: [{
      filename: "checkin-qr.png",
      content: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
      contentType: "image/png",
      cid,
    }],
  });
}

export async function registerParticipant(
  org: Organization,
  event: EventDoc,
  input: RegisterInput,
  options: RegisterOptions = {},
): Promise<RegisterOutcome> {
  const { sendInvite = true } = options;
  const hash = await participantHash(input);
  const now = new Date().toISOString();

  const candidate: Participant = {
    hash,
    orgId: org.id,
    eventId: event.id,
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    fields: input.fields ?? {},
    createdBy: input.createdBy,
    qrSentAt: null,
    registered: false,
    registeredAt: null,
    source: input.source,
    createdAt: now,
  };


  const { created, participant } = await upsertParticipant(candidate);

  // Idempotent re-adds don't re-spam; deferred invites stay pending until sent.
  if (!created || !sendInvite) return { created, emailed: false, participant };

  let emailed = false;
  try {
    await emailQr(org, event, participant, input.source === "self");
    emailed = true;
    await updateParticipant({ ...participant, qrSentAt: new Date().toISOString() });
  } catch (err) {
    // Non-fatal: the participant exists; QR can be resent from the dashboard.
    console.error(`[registerParticipant] QR email failed for ${participant.email}:`, err);
  }

  return {
    created: true,
    emailed,
    participant: { ...participant, qrSentAt: emailed ? now : null },
  };
}

/** Resend (or first-send) the QR email for an existing participant. */
export async function resendQr(
  org: Organization,
  event: EventDoc,
  p: Participant,
): Promise<void> {
  await emailQr(org, event, p, false);
  await updateParticipant({ ...p, qrSentAt: new Date().toISOString() });
}
