import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";

/**
 * A database handle for one request. In production the connection string comes
 * from Hyperdrive, which keeps the real connections to Neon pooled and warm, so
 * opening one per request is cheap; locally it points at compose.yaml.
 *
 * There is deliberately no `end()`: a Worker's sockets belong to the request and
 * the runtime closes them when it finishes (Cloudflare's own Hyperdrive example
 * never closes its client). Ending the pool early made pg-cloudflare's read loop
 * fail on the closed socket and surface as unhandled rejections.
 *
 * For the same reason idle connections are never timed out: pg's default ends
 * a connection after 10 idle seconds, which hits the same closed-socket error
 * whenever the isolate lives that long (a slow test run, a reused isolate).
 */
export function connect(connectionString: string): Database {
  // Workers allow six simultaneous outbound connections per request.
  const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 0 });
  return drizzle(pool, { schema });
}

export type Database = NodePgDatabase<typeof schema>;
