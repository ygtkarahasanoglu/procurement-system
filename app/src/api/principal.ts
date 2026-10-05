import type { Request } from "express";

// API-layer identity contracts only (AUTH-1/2/3/5/6 planning, Step 1).
// No runtime behavior, no validation, no authentication logic, and no
// domain coupling lives here — these types exist so a future
// authentication boundary and the route handlers that will consume it
// have a shared, minimal shape to agree on. Services continue to accept
// plain tenantId/userId strings exactly as today; Principal is never
// passed below the API layer.

export interface Principal {
  userId: string;
  tenantId: string;
}

export type Authenticator = (req: Request) => Promise<Principal | null>;

// Minimal type-safe request augmentation (AUTH-1/2/3/5/6 planning, Step 4)
// so route handlers can read req.principal without a cast at every call
// site. This is a compile-time type declaration only — no runtime
// behavior and no shared/mutable state: a given request's `principal`
// property is set once, per-request, by the authentication middleware in
// server.ts, directly on that request's own object. Optional because it is
// only guaranteed present once the authentication middleware has run.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}
