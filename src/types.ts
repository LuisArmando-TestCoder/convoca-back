// ── Domain types ─────────────────────────────────────────────────────────────
// The whole SaaS is multi-tenant: every record is scoped to an `orgId`.

export type Role = "owner" | "collaborator";

export type EventMode = "in_person" | "virtual" | "hybrid";

export type ParticipantSource = "manual" | "csv" | "self";

/**
 * A team-defined participant field (beyond the built-in name + email). `key` is
 * a stable slug used in storage/CSV headers; `label` is what people see.
 */
export interface EventField {
  key: string;
  label: string;
  required: boolean;
}


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
  /** Event ids this collaborator may access. Absent/undefined = legacy: ALL org events. */
  eventIds?: string[];
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
  /** Team-defined participant fields (beyond name + email). Optional/[] by default. */
  fields?: EventField[];
  clonedFrom: string | null;
  createdAt: string;
}

/** Review state for application-origin participants. */
export type ApplicationStatus = "pending" | "accepted" | "rejected";

/**
 * An invited participant. Its id/`hash` is the SHA-256 of name + email — the
 * exact value encoded in the QR image. All other attributes are metadata.
 */
export interface Participant {
  hash: string;
  orgId: string;
  eventId: string;
  name: string;
  email: string;
  /** Team-defined field values, keyed by EventField.key. */
  fields?: Record<string, string>;
  /** Legacy built-ins, kept optional so pre-existing docs still read cleanly. */
  country?: string;
  phone?: string;
  createdBy: string;
  qrSentAt: string | null;
  registered: boolean;
  registeredAt: string | null;
  source: ParticipantSource;
  createdAt: string;
  /** True when this participant came in via an application-type link (awaiting review). */
  application?: boolean;
  /** Review state for application-origin participants. */
  applicationStatus?: ApplicationStatus;
  /** When true, the participant is moved to the hidden tab (declutters the list). */
  hidden?: boolean;
}


/** A shareable public link that lets people self-register into one event. */
export interface SelfRegLink {
  id: string;
  orgId: string;
  eventId: string;
  /** Optional display name shown on the registration page (WYSIWYG label). */
  name: string;
  /** Per-link registration fields; overrides the event's schema for this link. */
  fields: EventField[];
  active: boolean;
  /** When true, this link is an application source: registrants are held for review. */
  application: boolean;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
}

/** Decoded JWT session payload attached to authenticated requests. */
export interface SessionClaims {
  email: string;
  orgId: string;
  role: Role;
  /** Event ids a collaborator may access; undefined = all org events (legacy/owner). */
  eventIds?: string[];
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