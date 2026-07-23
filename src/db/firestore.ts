// ── Firestore REST client ────────────────────────────────────────────────────
// A small, dependency-free Firestore layer for Deno. Authenticates with the
// service account (signs an RS256 JWT → OAuth access token, cached), encodes/
// decodes Firestore typed values, and exposes the handful of operations the
// repositories need — including the two atomic ones (create-if-absent for
// uniqueness, compare-and-set for the race-safe check-in).

import { config } from "../config.ts";

interface ServiceAccount {
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

let _sa: ServiceAccount | null = null;
async function serviceAccount(): Promise<ServiceAccount> {
  if (!_sa) _sa = JSON.parse(await Deno.readTextFile(config.serviceAccountPath));
  return _sa!;
}

// ── OAuth access token ────────────────────────────────────────────────────────

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

let _token: { value: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_token && _token.exp - 60 > now) return _token.value;

  const sa = await serviceAccount();
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(enc.encode(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  })));
  const unsigned = `${header}.${claim}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned));
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`OAuth token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  _token = { value: data.access_token, exp: now + (data.expires_in ?? 3600) };
  return _token.value;
}

// ── Value codec (JS ⇄ Firestore typed values) ────────────────────────────────

type FsValue = Record<string, unknown>;

function toValue(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === "object") return { mapValue: { fields: toFields(v as Record<string, unknown>) } };
  throw new Error(`Unsupported value type: ${typeof v}`);
}

function toFields(obj: Record<string, unknown>): Record<string, FsValue> {
  const out: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = toValue(v);
  return out;
}

function fromValue(val: FsValue): unknown {
  if ("nullValue" in val) return null;
  if ("stringValue" in val) return val.stringValue;
  if ("booleanValue" in val) return val.booleanValue;
  if ("integerValue" in val) return Number(val.integerValue);
  if ("doubleValue" in val) return val.doubleValue;
  if ("timestampValue" in val) return val.timestampValue;
  if ("arrayValue" in val) {
    const values = (val.arrayValue as { values?: FsValue[] }).values ?? [];
    return values.map(fromValue);
  }
  if ("mapValue" in val) {
    return fromFields((val.mapValue as { fields?: Record<string, FsValue> }).fields ?? {});
  }
  return null;
}

function fromFields(fields: Record<string, FsValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = fromValue(v);
  return out;
}

// ── REST plumbing ─────────────────────────────────────────────────────────────

async function baseUrl(): Promise<string> {
  const sa = await serviceAccount();
  return `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/${config.firestoreDatabase}/documents`;
}

async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return fetch(url, { ...init, headers });
}

interface DocMeta<T> {
  data: T;
  updateTime: string;
}

/** Get a document → its data, or null if it doesn't exist. */
export async function fsGet<T>(path: string): Promise<T | null> {
  const meta = await fsGetWithMeta<T>(path);
  return meta ? meta.data : null;
}

/** Drops an unread response body so no resource leaks (Deno flags these). */
async function drain(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // already consumed
  }
}

/** Get a document with its updateTime (needed for compare-and-set). */
export async function fsGetWithMeta<T>(path: string): Promise<DocMeta<T> | null> {
  const res = await authedFetch(`${await baseUrl()}/${path}`);
  if (res.status === 404) {
    await drain(res);
    return null;
  }
  if (!res.ok) throw new Error(`fsGet ${path} failed: ${res.status} ${await res.text()}`);
  const doc = await res.json();
  return { data: fromFields(doc.fields ?? {}) as T, updateTime: doc.updateTime };
}

/** Create or overwrite a document (no field mask → full replace). */
export async function fsSet(path: string, obj: Record<string, unknown>): Promise<void> {
  const res = await authedFetch(`${await baseUrl()}/${path}`, {
    method: "PATCH",
    body: JSON.stringify({ fields: toFields(obj) }),
  });
  if (!res.ok) throw new Error(`fsSet ${path} failed: ${res.status} ${await res.text()}`);
  await drain(res);
}

/** Create a document only if it doesn't already exist. Returns false on conflict. */
export async function fsCreate(
  collectionPath: string,
  docId: string,
  obj: Record<string, unknown>,
): Promise<boolean> {
  const url = `${await baseUrl()}/${collectionPath}?documentId=${encodeURIComponent(docId)}`;
  const res = await authedFetch(url, { method: "POST", body: JSON.stringify({ fields: toFields(obj) }) });
  if (res.status === 409) {
    await drain(res);
    return false;
  }
  if (!res.ok) throw new Error(`fsCreate ${collectionPath}/${docId} failed: ${res.status} ${await res.text()}`);
  await drain(res);
  return true;
}

/**
 * Compare-and-set: overwrite only if the doc's updateTime still matches.
 * Returns false when another writer changed it first (lost race).
 */
export async function fsCasUpdate(
  path: string,
  obj: Record<string, unknown>,
  updateTime: string,
): Promise<boolean> {
  const url = `${await baseUrl()}/${path}?currentDocument.updateTime=${encodeURIComponent(updateTime)}`;
  const res = await authedFetch(url, { method: "PATCH", body: JSON.stringify({ fields: toFields(obj) }) });
  if (res.status === 400 || res.status === 409) {
    await drain(res); // FAILED_PRECONDITION → lost race
    return false;
  }
  if (!res.ok) throw new Error(`fsCasUpdate ${path} failed: ${res.status} ${await res.text()}`);
  await drain(res);
  return true;
}

export async function fsDelete(path: string): Promise<void> {
  const res = await authedFetch(`${await baseUrl()}/${path}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`fsDelete ${path} failed: ${res.status} ${await res.text()}`);
  }
  await drain(res);
}


/** List all documents in a collection (paginated). Returns each doc's data + id. */
export async function fsList<T>(collectionPath: string): Promise<Array<T & { _id: string }>> {
  const out: Array<T & { _id: string }> = [];
  let pageToken = "";
  do {
    const url = new URL(`${await baseUrl()}/${collectionPath}`);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await authedFetch(url.toString());
    if (res.status === 404) break;
    if (!res.ok) throw new Error(`fsList ${collectionPath} failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    for (const doc of data.documents ?? []) {
      const id = String(doc.name).split("/").pop()!;
      out.push({ ...(fromFields(doc.fields ?? {}) as T), _id: id });
    }
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

/** Just the document ids in a collection (used for lightweight index lookups). */
export async function fsListIds(collectionPath: string): Promise<string[]> {
  const rows = await fsList<Record<string, unknown>>(collectionPath);
  return rows.map((r) => r._id);
}
