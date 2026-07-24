// Executable proofs:
//   1. Pure: the participant identity hash is deterministic + normalized.
//   2. Integration (Firestore): check-in is idempotent — first scan succeeds,
//      repeats are duplicates, unknown codes are not_found. Self-cleaning; it is
//      skipped automatically when ./service-account.json is absent.
// Run: JWT_SECRET=test deno test --allow-net --allow-env --allow-read

import { assertEquals, assertNotEquals } from "@std/assert";
import { participantHash } from "../src/lib/hash.ts";

Deno.env.set("JWT_SECRET", Deno.env.get("JWT_SECRET") ?? "test-secret");

const FIELDS = { name: "Ada Lovelace", email: "ada@calc.io" };

Deno.test("identity hash is deterministic", async () => {
  const a = await participantHash(FIELDS);
  const b = await participantHash(FIELDS);
  assertEquals(a, b);
  assertEquals(a.length, 64);
});

Deno.test("identity hash normalizes email case + whitespace", async () => {
  const a = await participantHash(FIELDS);
  const b = await participantHash({ email: "  ADA@Calc.IO  ", name: "Ada  Lovelace" });
  assertEquals(a, b);
});

Deno.test("identity is name + email — a different email is a different person", async () => {
  const a = await participantHash(FIELDS);
  assertNotEquals(a, await participantHash({ ...FIELDS, email: "someone-else@calc.io" }));
  assertNotEquals(a, await participantHash({ ...FIELDS, name: "Grace Hopper" }));
});

function hasCredentials(): boolean {
  try {
    Deno.statSync("./service-account.json");
    return true;
  } catch {
    return false;
  }
}

Deno.test({
  name: "check-in (Firestore): first succeeds, repeat is duplicate, unknown is not_found",
  ignore: !hasCredentials(),
  fn: async () => {
    const { upsertParticipant, checkIn, deleteParticipant } = await import("../src/db/participants.ts");
    const orgId = "test-org";
    const eventId = `test-event-${crypto.randomUUID().slice(0, 8)}`;
    const hash = await participantHash(FIELDS);

    try {
      await upsertParticipant({
        hash,
        orgId,
        eventId,
        name: FIELDS.name,
        email: FIELDS.email,
        fields: { country: "UK" },
        createdBy: "test",
        qrSentAt: null,
        registered: false,
        registeredAt: null,
        source: "manual",
        createdAt: new Date().toISOString(),
      });

      assertEquals((await checkIn(orgId, eventId, hash)).outcome, "success");
      assertEquals((await checkIn(orgId, eventId, hash)).outcome, "duplicate");
      assertEquals((await checkIn(orgId, eventId, "deadbeef")).outcome, "not_found");
    } finally {
      await deleteParticipant(orgId, eventId, hash);
    }
  },
});
