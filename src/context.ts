// Shared Hono environment: variables set by the auth middleware and read by
// every protected route handler.

import type { Organization, SessionClaims } from "./types.ts";

export interface AppEnv {
  Variables: {
    session: SessionClaims;
    org: Organization;
  };
}
