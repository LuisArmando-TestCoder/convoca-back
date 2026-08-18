// ── Participant registration service ─────────────────────────────────────────
// The ONE place that turns four bare fields into a participant + QR email.
// Reused by the dashboard "add participant" path AND the public self-reg path so
// the identity/QR/email behavior can never drift between them.

import { type IdentityFields, participantHash } from "../lib/hash.ts";
import { qrPngBuffer } from "../lib/qr.ts";

import { sendEmail } from "../lib/email.ts";
import { qrInviteEmail, selfRegConfirmEmail } from "../lib/emailTemplates.ts";
import { updateParticipant, upsertParticipant } from "../db/participants.ts";
import type { EventDoc, Organization, Participant, ParticipantSource } from "../types.ts";

export interface RegisterInput extends IdentityFields {
  /** Team-defined field values, keyed by EventField.key. */
  fields?: Record<string, string>;
  source: ParticipantSource;
  createdBy: string;
  /** True when this registration came through an application-type link (held for review). */
  application?: boolean;
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
  const qrPng = qrPngBuffer(p.hash);
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
    // The plain-text alternative is what keeps this out of "quishing" spam drops.
    text: tpl.text,
    attachments: [{
      filename: "checkin-qr.png",
      content: qrPng,
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
    application: input.application ?? false,
    applicationStatus: input.application ? "pending" : undefined,
  };

  const { created, participant } = await upsertParticipant(candidate);

  // Idempotent re-adds don't re-spam; deferred invites stay pending until sent.
  // Application-origin registrants are held for review — no QR is emailed until
  // an admin accepts them from the participants table.
  if (!created || !sendInvite || input.application) {
    return { created, emailed: false, participant };
  }

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

/** Accept an application-origin participant: marks them accepted and emails the QR. */
export async function acceptApplication(
  org: Organization,
  event: EventDoc,
  p: Participant,
): Promise<Participant> {
  const accepted: Participant = {
    ...p,
    applicationStatus: "accepted",
    hidden: false,
  };
  await emailQr(org, event, accepted, false);
  const withQr: Participant = { ...accepted, qrSentAt: new Date().toISOString() };
  await updateParticipant(withQr);
  return withQr;
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