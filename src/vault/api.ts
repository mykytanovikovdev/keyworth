import type {
  DeviceJson,
  DeviceSlotJson,
  KeySetupJson,
  KeysJson,
  PassphraseSlotJson,
  RecoverySlotJson,
} from "../../shared/schemas/keys.ts";
import type { MeJson } from "../../shared/schemas/me.ts";
import type {
  RecordKind,
  VaultRecordJson,
  VaultWrite,
} from "../../shared/schemas/vault.ts";

/*
 * The browser's side of /api/keys, /api/vault and /api/me. Same origin, so the
 * session cookie goes along and the browser adds the Origin header the server
 * checks on writes. Everything returned is untrusted: slots and envelopes are
 * validated by src/crypto before any cryptography touches them.
 */

/** A response other than 2xx, with the server's error code (`conflict`, `rate_limited`…). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** The whole error body: a 409 also names the stored `revision` or `iv`. */
  readonly body: Readonly<Record<string, unknown>>;
  /** Seconds to wait, from `Retry-After` on a 429. */
  readonly retryAfter: number | undefined;

  constructor(
    status: number,
    body: Record<string, unknown>,
    retryAfter?: number,
  ) {
    const code = typeof body.error === "string" ? body.error : "unknown";
    super(`The server answered ${String(status)} ${code}.`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

export interface VaultApi {
  me(): Promise<MeJson>;
  /** Both slots and the check value, or null before setup. */
  keys(): Promise<KeysJson["keys"]>;
  setUpKeys(body: KeySetupJson): Promise<void>;
  replacePassphrase(
    expectedIv: string,
    slot: PassphraseSlotJson,
  ): Promise<void>;
  replaceRecovery(expectedIv: string, slot: RecoverySlotJson): Promise<void>;
  rememberDevice(slot: DeviceSlotJson): Promise<void>;
  /** The device-wrapped key, or null when this session has none. */
  deviceSlot(): Promise<unknown>;
  forgetDevice(): Promise<void>;
  records(kind: RecordKind): Promise<VaultRecordJson[]>;
  /** Returns the record's new revision. */
  putRecord(id: string, write: VaultWrite): Promise<number>;
}

async function request(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Response> {
  const response = await fetch(path, {
    method,
    headers: {
      accept: "application/json",
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  if (response.ok) return response;
  let error: Record<string, unknown> = {};
  try {
    const parsed = (await response.json()) as unknown;
    if (parsed && typeof parsed === "object") {
      error = parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON (a proxy's error page, say): the status alone has to do.
  }
  const retryAfter = Number(response.headers.get("retry-after"));
  throw new ApiError(
    response.status,
    error,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  );
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export const httpApi: VaultApi = {
  async me() {
    return json<MeJson>(await request("GET", "/api/me"));
  },
  async keys() {
    return (await json<KeysJson>(await request("GET", "/api/keys"))).keys;
  },
  async setUpKeys(body) {
    await request("POST", "/api/keys", body);
  },
  async replacePassphrase(expectedIv, slot) {
    await request("PUT", "/api/keys/passphrase", { expectedIv, slot });
  },
  async replaceRecovery(expectedIv, slot) {
    await request("PUT", "/api/keys/recovery", { expectedIv, slot });
  },
  async rememberDevice(slot) {
    await request("POST", "/api/keys/device", slot);
  },
  async deviceSlot() {
    return (await json<DeviceJson>(await request("GET", "/api/keys/device")))
      .slot;
  },
  async forgetDevice() {
    await request("DELETE", "/api/keys/device");
  },
  async records(kind) {
    const response = await request(
      "GET",
      `/api/vault?kind=${encodeURIComponent(kind)}`,
    );
    return (await json<{ records: VaultRecordJson[] }>(response)).records;
  },
  async putRecord(id, write) {
    const response = await request(
      "PUT",
      `/api/vault/${encodeURIComponent(id)}`,
      write,
    );
    return (await json<{ revision: number }>(response)).revision;
  },
};
