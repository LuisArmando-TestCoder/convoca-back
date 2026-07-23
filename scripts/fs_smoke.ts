// Diagnostic: prove we can talk to Firestore. Prints the raw status/body for a
// write + read to a throwaway doc so we can distinguish IAM vs missing-DB vs
// code issues. Run: JWT_SECRET=test deno run --allow-net --allow-env --allow-read scripts/fs_smoke.ts

import { fsDelete, fsGet, fsSet } from "../src/db/firestore.ts";

// Read probe first (404 = DB reachable + read allowed; 403 = no read perm).
try {
  const missing = await fsGet("organizations/smoketestdoc");

  console.log("✓ READ ok (missing doc → null):", missing);
} catch (err) {
  console.error("✗ READ failed:", (err as Error).message);
}

const path = "smoke/ping";
try {

  console.log("→ writing", path);
  await fsSet(path, { at: new Date().toISOString(), ok: true });
  console.log("✓ write ok");

  const got = await fsGet<{ at: string }>(path);
  console.log("✓ read ok:", got);

  await fsDelete(path);
  console.log("✓ delete ok");
  console.log("\nFIRESTORE OK");
} catch (err) {
  console.error("\nFIRESTORE ERROR:\n", (err as Error).message);
}
