# dreams.md — Convoca API

Post-task reflections, so future work compounds on hindsight.

---

## 2026-07-23 — Initial build: event check-in SaaS backend (Deno + Firestore)

**What shipped.** A complete multi-tenant API: passwordless OTP auth over each
org's own Gmail, events CRUD + clone, participant management (manual + CSV) with
SHA-256 identity + emailed QR, public self-registration links, a race-safe QR
check-in with a duplicate safeguard, collaborator management, and real-time
stats. Storage started on Deno KV and pivoted to Firestore mid-build after the
service-account key surfaced.

**What went well.**
- **The repository seam paid off.** Because every data access sat behind
  `src/db/{orgs,events,participants,links}.ts` with stable signatures, swapping
  the whole store (Deno KV → Firestore REST) touched only those four files + a
  new `firestore.ts`/`paths.ts`; routes, services, and middleware never changed.
- **`registerParticipant` as one service** kept "four fields → hash → QR → email"
  identical for the dashboard-add and self-registration paths (DRY by design).
- **Executable proof over argument.** A live Firestore integration test asserts
  first-scan=success / repeat=duplicate / unknown=not_found, self-cleaning.

**What could have been better.**
1. **Should have asked about storage before writing a line of it.** I built the
   entire Deno KV layer, then the Firebase key appeared and I rewrote it. Pausing
   to ask "KV or Firestore?" up front (the project was literally named `convoca`)
   would have saved a full data-layer rewrite. Lesson: confirm the persistence
   substrate before implementing it — it's the least reversible choice.
2. **The 403 was external, but I could have surfaced it sooner.** I wrote a smoke
   script only after the integration test failed opaquely. A connectivity probe
   should be step 1 when wiring any new external datastore, not a rescue.
3. **Unconsumed fetch bodies bit me.** Deno's test sanitizer caught response
   bodies I never read on successful PATCH/POST/DELETE — a real server resource
   leak, not just a test nit. A `drain()` helper fixed it, but I should default
   to "always consume the body" in any REST client from the first line.
4. **Check-in CAS relies on Firestore `updateTime` preconditions**, which is
   correct but coarse: a benign no-op write between read and CAS would spuriously
   lose the race. In practice check-ins don't collide that way, but a real
   transaction (`:beginTransaction`/`commit`) would be strictly-correct if
   contention ever matters.
5. **OTP docs never auto-expire.** They carry `expiresAt` and are checked on read,
   but stale docs accumulate. A Firestore TTL policy on the `otp` collection (or
   a periodic sweep) would keep it clean.
6. **No rate limiting on `/api/auth/*` or `/api/public/*`.** Fine for an MVP, but
   these are the abusable surfaces (OTP spam, self-reg flooding). Add a per-IP
   limiter before real traffic.

---

## 2026-07-23 — Central sender, pending CSV invites, editable participants

- **Sender model pivoted cleanly** to a platform-wide account (`config.appEmail`) with per-org Gmail as an optional override, all behind the single `resolveSender()` seam in `email.ts` — no route/service changes needed. Adding `replyTo` (team inbox) was one field.
- **CSV import now defers email** via a `sendInvite` option on `registerParticipant`; the existing `/resend` endpoint doubles as first-send. Reusing it avoided a new endpoint.
- **Participant edit is a move, not an update:** identity is the doc id (= QR payload), so any field change recomputes the hash → write-new + delete-old, resetting `qrSentAt`. Worth remembering that "edit" is never in-place for hash-keyed docs.
- **Regret:** the replace-in-file tool kept injecting phantom blank lines; `deno fmt` cleaned them but I should default to full rewrites for multi-hunk edits on this codebase.

---

## 2026-07-24 — Team-defined participant fields (country/phone demoted to examples)

- **Identity shrank to name + email.** Custom fields (incl. country/phone) are now pure metadata, so editing them never reissues the QR, and the whole system got simpler. Backward compatible because existing docs keep their original 4-part-hash id — the QR only equals the stored doc id, which never changes.
- **`EventDoc.fields[]` + `Participant.fields{}`** are optional and default to `[]`/`{}`, so pre-existing events/participants read cleanly with nothing seeded — exactly the "don't seed prod" requirement.
- **One validation helper** (`pickParticipantFields`) is shared by manual add, CSV import, and self-reg, and the Firestore codec already handled nested maps/arrays, so persistence needed zero changes.
- **Lesson:** confirming the identity model with one question up front (metadata vs. identity) prevented a much larger, irreversible refactor.

## QR emails silently dropped — text/plain fix (2026-07-24)
- Symptom: OTP code emails arrived, single check-in QR email to the same address did not — app reported "sent".
- Root cause: every template returned only `html`. With an inline QR image and no text part, nodemailer emits multipart/related (HTML-only). Gmail/Outlook "quishing" filters silently drop image-heavy, text-less mail — exactly the QR invite; the OTP survived because it has no image.
- Fix: added a text/plain alternative to otp/qrInvite/selfReg templates and threaded `text` through sendEmail (now multipart/alternative). sendEmail also returns SMTP accepted/rejected for diagnostics.
- Added scripts/send-test-email.ts: sends the exact [QR] email + a no-image [control] to any addresses. Probe run: Gmail accepted all 6 (auth via own@convoca.space now works) — so delivery-to-Gmail is fine; remaining drops are recipient-side filtering, which the QR-vs-control pair isolates.
- Could improve next: host the QR as an https <img src> (S3/CDN) instead of inline attachment, and/or add List-Unsubscribe + a plain link fallback to further de-risk the image.

## QR generation failed on the prod runtime — pure-JS PNG (2026-07-24)
- Refined diagnosis: not a spam/quishing drop. Auth mail boots+sends in prod, so `qrcode` imports fine; the failure is at RUNTIME in its PNG renderer (pngjs → node:zlib/node:stream), which throws on restricted runtimes (e.g. Deno Deploy) but works under full Node compat locally. The throw was swallowed in registerParticipant, so the app still reported success.
- Fix: rewrote src/lib/qr.ts to take ONLY the pure-JS matrix (QRCode.create) and encode the PNG by hand — 8-bit grayscale, CRC32 chunks, and a zlib stream built from uncompressed DEFLATE "stored" blocks + adler32. No pngjs, no zlib, no streams → runs anywhere. registerParticipant now uses qrPngBuffer directly (dropped the dataURL/atob round-trip).
- Added scripts/verify-qr.ts: regenerates a QR and inflates its IDAT to assert a valid, non-blank PNG on the current runtime (200x200, 13824 dark px). Run it in the prod image to prove generation before trusting delivery.
- Lesson: npm packages that lean on node:zlib/stream are runtime-fragile; prefer pure-JS or Web APIs for anything on the hot path of a serverless deploy. And never swallow a send/generation error into an optimistic "sent".
