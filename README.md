# Convoca — API (backend)

A standalone, multi-tenant **event check-in** SaaS backend. Organizations sign in
passwordless (OTP over their own Gmail), run events, invite participants (who
receive a **SHA-256 QR ticket** by email), and check them in by scanning that QR
— with a race-safe duplicate-scan safeguard.

- **Runtime:** Deno + [Hono](https://hono.dev)
- **Storage:** Firestore (REST, service-account OAuth) — no SDK, no gRPC
- **Email:** Nodemailer over each tenant's own Gmail App Password
- **QR:** `qrcode` (PNG); the QR encodes **only** the identity hash, never a URL

## How identity works

A participant's document id **is** the SHA-256 of their four bare fields, in a
fixed, normalized order:

```
sha256( name \n lower(email) \n country \n phone )
```

That hash is the exact value encoded in the QR image. Re-submitting the same
person is therefore idempotent (same id → no duplicate), and check-in is a
direct document lookup by the scanned hash.

## Setup

1. Install [Deno](https://deno.com) ≥ 2.
2. Put a Firebase **service-account JSON** at `./service-account.json` (gitignored).
   The service account needs the **Cloud Datastore User** IAM role (or Editor).
3. Copy env and set a secret:
   ```bash
   cp .env.example .env
   # edit JWT_SECRET (openssl rand -hex 32), APP_BASE_URL, CORS_ORIGINS
   ```
4. Run:
   ```bash
   deno task dev     # watch mode
   deno task start   # production
   ```

## Verify

```bash
deno task check                                   # type-check
JWT_SECRET=test deno test --allow-net --allow-env --allow-read   # unit + live Firestore proof
JWT_SECRET=test deno run --allow-net --allow-env --allow-read scripts/fs_smoke.ts   # Firestore connectivity
```

## API

Auth is a Bearer JWT from the OTP flow. All `/api/events/*` and
`/api/collaborators/*` routes require it; `/api/public/*` is open.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register` | Create org (Gmail App Password verified), send OTP |
| POST | `/api/auth/request-code` | Send sign-in OTP (owner or collaborator) |
| POST | `/api/auth/verify` | Exchange OTP → session token |
| GET | `/api/me` | Current org + role |
| GET/POST | `/api/events` | List / create events |
| GET/PATCH/DELETE | `/api/events/:id` | Read / edit / delete event |
| POST | `/api/events/:id/clone` | Clone an event |
| GET | `/api/events/:id/stats` | Real-time attendance stats |
| GET/POST | `/api/events/:id/participants` | List / add participant (emails QR) |
| POST | `/api/events/:id/participants/csv` | Bulk import (`rows[]` or raw `csv`) |
| POST | `/api/events/:id/participants/:hash/resend` | Re-email a QR |
| GET | `/api/events/:id/participants/:hash/qr.png` | QR image |
| DELETE | `/api/events/:id/participants/:hash` | Remove participant |
| POST | `/api/events/:id/checkin` | Scan a QR hash → 200 / 409 dup / 404 |
| GET/POST/PATCH | `/api/events/:id/links` | Self-registration links |
| GET/POST/DELETE | `/api/collaborators` | Team management (owner only) |
| GET/POST | `/api/public/register/:linkId` | Public self-registration |

## Data layout (Firestore)

```
organizations/{orgId=sha256(email)}
organizations/{orgId}/collaborators/{sha256(email)}
organizations/{orgId}/events/{eventId}
organizations/{orgId}/events/{eventId}/participants/{sha256(identity)}
organizations/{orgId}/events/{eventId}/link_ids/{linkId}      # index
collaborator_index/{sha256(email)} → { orgId }               # login reverse-lookup
otp/{sha256(email)} → { code, expiresAt }
links/{linkId} → SelfRegLink                                 # public lookup
```

## Architecture

```
main.ts                # Hono app, CORS, error shaping, routes
src/config.ts          # env (fail-fast)
src/routes/*           # auth, events, collaborators, public
src/services/*         # registerParticipant (identity → QR → email), reused by both add paths
src/db/firestore.ts    # REST client: OAuth, value codec, get/set/list/create-if-absent/CAS
src/db/paths.ts        # single source of truth for document paths
src/db/{orgs,events,participants,links}.ts   # repositories
src/lib/*              # hash, jwt, qr, email, csv, validate
```
