// ── Domain types ─────────────────────────────────────────────────────────────
// The whole SaaS is multi-tenant: every record is scoped to an `orgId`.

export type Role = "owner" | "collaborator";

export type EventMode = "in_person" | "virtual" | "hybrid";

export type ParticipantSource = "manual" | "csv" | "self";

/**
 * A tenant. Its id is sha256(email). Sends mail via the platform's central
 * Gmail sender by default; may override it with its own Gmail (both fields set).
 */
export interface Organization {
  id: string;
  name: string;
  email: string;
  /** Org's own Gmail sender address; "" ⇒ use the platform sender. */
  gmailUser: string;
  /** Org's own Gmail App Password (16 chars, no spaces); "" ⇒ platform sender. */
  gmailPass: string;
  verified: boolean;
  createdAt: string;
}


/** A teammate the owner invited. Can sign in and scan/create participants. */
export interface Collaborator {
  email: string;
  name: string;
  orgId: string;
  addedAt: string;
}

export interface EventDoc {
  id: string;
  orgId: string;
  name: string;
  description: string;
  location: string;
  mode: EventMode;
  /** ISO date-time of when the event happens. */
  date: string;
  /** Max participants; null = unlimited. */
  quota: number | null;
  clonedFrom: string | null;
  createdAt: string;
}

/**
 * An invited participant. Its id/`hash` is the SHA-256 of the four bare fields
 * (name, email, country, phone) — the exact value encoded in the QR image.
 */
export interface Participant {
  hash: string;
  orgId: string;
  eventId: string;
  name: string;
  email: string;
  country: string;
  phone: string;
  createdBy: string;
  qrSentAt: string | null;
  registered: boolean;
  registeredAt: string | null;
  source: ParticipantSource;
  createdAt: string;
}

/** A shareable public link that lets people self-register into one event. */
export interface SelfRegLink {
  id: string;
  orgId: string;
  eventId: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
}

/** Decoded JWT session payload attached to authenticated requests. */
export interface SessionClaims {
  email: string;
  orgId: string;
  role: Role;
  /** Standard JWT expiry (seconds since epoch). */
  exp: number;
}

/** Result of a check-in scan — drives the traffic-light UI on the client. */
export type CheckinOutcome = "success" | "duplicate" | "not_found" | "wrong_event";

export interface CheckinResult {
  outcome: CheckinOutcome;
  participant: Pick<Participant, "name" | "email" | "country"> | null;
  registeredAt: string | null;
  message: string;
}
