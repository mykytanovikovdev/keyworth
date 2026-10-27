import { describe, expect, it } from "vitest";
import { envelopeSchema } from "../../../shared/schemas/envelope.ts";
import { fromBase64url, toBase64url } from "../../../src/crypto/encoding.ts";
import {
  decryptRecord,
  encryptRecord,
  type RecordRef,
} from "../../../src/crypto/envelope.ts";
import { generateDataKey } from "../../../src/crypto/keys.ts";
import { MAX_PLAINTEXT_BYTES } from "../../../src/crypto/padding.ts";
import { ALICE, BOB } from "./fixtures.ts";

const trade = {
  assetId: "litecoin",
  type: "buy",
  quantity: "5",
  price: "60.03",
  note: "bought on the dip",
};

function ref(overrides: Partial<RecordRef> = {}): RecordRef {
  return {
    userId: ALICE,
    kind: "transaction",
    recordId: crypto.randomUUID(),
    ...overrides,
  };
}

/** Flips one bit of a base64url field. */
function flipBit(text: string, byteIndex = 0): string {
  const bytes = fromBase64url(text);
  bytes[byteIndex] = (bytes[byteIndex] ?? 0) ^ 1;
  return toBase64url(bytes);
}

describe("records", () => {
  it("decrypt back to the same value", async () => {
    const key = await generateDataKey();
    const at = ref();

    const envelope = await encryptRecord(key, at, trade);

    expect(await decryptRecord(key, at, envelope)).toEqual(trade);
  });

  it("produce a valid envelope with no plaintext in it", async () => {
    const key = await generateDataKey();

    const envelope = await encryptRecord(key, ref(), trade);

    expect(envelopeSchema.safeParse(envelope).success).toBe(true);
    const visible =
      JSON.stringify(envelope) +
      Buffer.from(fromBase64url(envelope.ct)).toString("latin1");
    for (const secret of ["litecoin", "60.03", "bought on the dip"]) {
      expect(visible).not.toContain(secret);
    }
  });

  it("use a new random IV for every encryption", async () => {
    const key = await generateDataKey();
    const at = ref();

    const envelopes = await Promise.all(
      Array.from({ length: 200 }, () => encryptRecord(key, at, trade)),
    );

    expect(new Set(envelopes.map((e) => e.iv)).size).toBe(200);
    expect(new Set(envelopes.map((e) => e.ct)).size).toBe(200);
  });

  it("do not decrypt with another user's data key", async () => {
    const at = ref();
    const envelope = await encryptRecord(await generateDataKey(), at, trade);

    await expect(
      decryptRecord(await generateDataKey(), at, envelope),
    ).rejects.toMatchObject({
      code: "tampered",
    });
  });

  it.each<[string, (original: RecordRef) => RecordRef]>([
    ["another record id", (r) => ({ ...r, recordId: crypto.randomUUID() })],
    ["another kind", (r) => ({ ...r, kind: "alert" })],
    ["another user", (r) => ({ ...r, userId: BOB })],
  ])("do not decrypt when moved to %s", async (_, move) => {
    const key = await generateDataKey();
    const at = ref();
    const envelope = await encryptRecord(key, at, trade);

    await expect(decryptRecord(key, move(at), envelope)).rejects.toMatchObject({
      code: "tampered",
    });
  });

  it.each([
    ["ciphertext", "ct"],
    ["IV", "iv"],
  ] as const)("do not decrypt with a changed %s", async (_, field) => {
    const key = await generateDataKey();
    const at = ref();
    const envelope = await encryptRecord(key, at, trade);

    const changed = { ...envelope, [field]: flipBit(envelope[field]) };

    await expect(decryptRecord(key, at, changed)).rejects.toMatchObject({
      code: "tampered",
    });
  });

  it("do not decrypt with the GCM tag changed", async () => {
    const key = await generateDataKey();
    const at = ref();
    const envelope = await encryptRecord(key, at, trade);
    const length = fromBase64url(envelope.ct).length;

    const changed = { ...envelope, ct: flipBit(envelope.ct, length - 1) };

    await expect(decryptRecord(key, at, changed)).rejects.toMatchObject({
      code: "tampered",
    });
  });

  it("refuse an envelope of another version or algorithm before decrypting", async () => {
    const key = await generateDataKey();
    const at = ref();
    const envelope = await encryptRecord(key, at, trade);

    for (const changed of [
      { ...envelope, v: 2 },
      { ...envelope, alg: "A128GCM" },
      { ...envelope, extra: 1 },
    ]) {
      await expect(decryptRecord(key, at, changed)).rejects.toMatchObject({
        code: "invalid-input",
      });
    }
  });

  it("refuse malformed references instead of building an ambiguous AAD", async () => {
    const key = await generateDataKey();

    for (const bad of [
      ref({ userId: `${ALICE}|x` }),
      ref({ recordId: "not-a-uuid" }),
      ref({ kind: "secret" as never }),
    ]) {
      await expect(encryptRecord(key, bad, trade)).rejects.toMatchObject({
        code: "invalid-input",
      });
    }
  });
});

describe("padding", () => {
  it("hides the exact length: short records all land in the smallest bucket", async () => {
    const key = await generateDataKey();

    const sizes = await Promise.all(
      ["a", "a".repeat(100), "a".repeat(200)].map(async (note) => {
        const envelope = await encryptRecord(key, ref(), { note });
        return fromBase64url(envelope.ct).length;
      }),
    );

    // 256 bytes of padded plaintext plus the 16-byte tag.
    expect(sizes).toEqual([272, 272, 272]);
  });

  it("grows by powers of two", async () => {
    const key = await generateDataKey();

    const envelope = await encryptRecord(key, ref(), { note: "a".repeat(300) });

    expect(fromBase64url(envelope.ct).length).toBe(512 + 16);
  });

  it("refuses a record larger than the largest bucket", async () => {
    const key = await generateDataKey();

    await expect(
      encryptRecord(key, ref(), { note: "a".repeat(MAX_PLAINTEXT_BYTES) }),
    ).rejects.toMatchObject({ code: "invalid-input" });
  });

  it("keeps the largest allowed record intact", async () => {
    const key = await generateDataKey();
    const at = ref();
    // JSON adds 11 bytes around the note: {"note":"…"}
    const note = "a".repeat(MAX_PLAINTEXT_BYTES - 11);

    const envelope = await encryptRecord(key, at, { note });

    expect(await decryptRecord(key, at, envelope)).toEqual({ note });
  });
});
