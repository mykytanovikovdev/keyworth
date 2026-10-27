import type { Auth } from "./auth.ts";
import type { Database } from "./db/client.ts";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

/** The current sign-in session, as far as routes need it. */
export interface SessionInfo {
  id: string;
  createdAt: Date;
}

/** Hono's environment for every API route: bindings and per-request values. */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    db: Database;
    auth: Auth;
    user: SessionUser;
    session: SessionInfo;
  };
}
