/**
 * What an unhandled error may put in the logs: its type, the Postgres error
 * code and the code locations it passed through. Never its message: a failed
 * query's message lists the query's parameters (ciphertext, wrapped keys,
 * salts), and a JSON parse error quotes the request body. Workers Logs keep
 * whatever the Worker prints.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const type = error.constructor.name || error.name;
  const code = postgresCode(error) ?? postgresCode(error.cause);
  // Only the "at …" lines: the lines before them repeat the message.
  const frames = (error.stack ?? "")
    .split("\n")
    .filter((line) => /^\s+at /.test(line))
    .slice(0, 5);
  return [type, ...(code ? [`postgres ${code}`] : []), ...frames].join("\n");
}

function postgresCode(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("code" in value)) return null;
  const { code } = value;
  // SQLSTATE codes are five characters; anything else is not from Postgres.
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}
