import { queryOptions } from "@tanstack/react-query";
import {
  type Settings,
  settingsSchema,
} from "../../../shared/schemas/settings.ts";
import {
  ApiError,
  httpApi,
  readRecords,
  type StoredRecord,
  vault,
  writeRecord,
} from "../../vault/index.ts";

/*
 * The user's settings: one encrypted record of kind "settings" (the first
 * real encrypted record, phase 3). Created on the first change; until then
 * the defaults apply.
 */

/**
 * The record's id is derived from the user id, the same on every device. Two
 * devices that create the settings at once then write the same record, and
 * the second gets a 409 instead of a second, competing record. The server
 * learns nothing new: it sees the record's kind anyway.
 */
export async function settingsRecordId(userId: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`keyworth/settings-record/v1|${userId}`),
    ),
  );
  const bytes = digest.slice(0, 16);
  // Shaped as a version 4 UUID, which is what record ids must be.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4),
    hex.slice(4, 6),
    hex.slice(6, 8),
    hex.slice(8, 10),
    hex.slice(10, 16),
  ]
    .map((part) => part.join(""))
    .join("-");
}

export type SettingsRecord = StoredRecord<Settings> | null;

async function loadSettings(userId: string): Promise<SettingsRecord> {
  const id = await settingsRecordId(userId);
  const records = await readRecords(vault, httpApi, "settings", settingsSchema);
  return records.find((record) => record.id === id) ?? null;
}

/** Cleared with every other ["vault"] query when the vault locks. */
export const settingsQuery = (userId: string) =>
  queryOptions({
    queryKey: ["vault", userId, "settings"],
    queryFn: () => loadSettings(userId),
    staleTime: Number.POSITIVE_INFINITY,
  });

/**
 * Saves a change on top of the current settings. If another tab or device
 * saved in between (409), the change is applied once more on top of theirs.
 */
export async function saveSettings(
  userId: string,
  current: SettingsRecord,
  change: Partial<Settings>,
): Promise<NonNullable<SettingsRecord>> {
  const id = await settingsRecordId(userId);
  const write = async (base: SettingsRecord) => {
    const value = { ...(base?.value ?? {}), ...change };
    const revision = await writeRecord(
      vault,
      httpApi,
      "settings",
      id,
      base?.revision ?? 0,
      value,
    );
    return { id, revision, value };
  };
  try {
    return await write(current);
  } catch (error) {
    if (error instanceof ApiError && error.code === "conflict") {
      return write(await loadSettings(userId));
    }
    throw error;
  }
}
