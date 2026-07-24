// ── Identity hashing ─────────────────────────────────────────────────────────
// The participant identity (and the value encoded in the QR) is the SHA-256 of
// the four bare fields. Both participant creation and self-registration derive
// it the SAME way, so re-submitting identical fields is idempotent (same id).

/** Generic SHA-256 → lowercase hex. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface IdentityFields {
  name: string;
  email: string;
  country: string;
  phone: string;
}

/**
 * Canonical serialization of a participant's four fields. Normalizing here is
 * what makes the hash stable: trim everything, lowercase the email, collapse
 * inner whitespace. Order is fixed: name, email, country, phone.
 */
export function canonicalIdentity(f: IdentityFields): string {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ");
  return [
    norm(f.name),
    norm(f.email).toLowerCase(),
    norm(f.country),
    norm(f.phone),
  ].join("\n");
}

/** SHA-256 of the canonical identity — the participant doc id and QR payload. */
export function participantHash(f: IdentityFields): Promise<string> {
  return sha256Hex(canonicalIdentity(f));
}

/** Doc-id-safe key for an email: SHA-256 of its normalized (lowercased) form. */
export function emailKey(email: string): Promise<string> {
  return sha256Hex(email.trim().toLowerCase());
}

/** Organization id is the SHA-256 of its (lowercased) owner email. */
export const orgId = emailKey;
