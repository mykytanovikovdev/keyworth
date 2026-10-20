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
 */
export function connect(connectionString: string): Database {
  // Workers allow six simultaneous outbound connections per request.
  const pool = new Pool({ connectionString, max: 5 });
  return drizzle(pool, { schema });
}

export type Database = NodePgDatabase<typeof schema>;
