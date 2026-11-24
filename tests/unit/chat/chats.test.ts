import { afterEach, describe, expect, it, vi } from "vitest";
import { type SavedMessage } from "../../../shared/schemas/chat-history.ts";
import { ChatSaver, openChat } from "../../../src/features/chat/chat-saver.ts";
import { loadChats } from "../../../src/features/chat/chats.ts";
import { newRecord, writeRecord } from "../../../src/vault/records.ts";
import { ALICE } from "../crypto/fixtures.ts";
import { fakeBrowser, PASSPHRASE } from "../vault/fake-browser.ts";

/*
 * Kept chats against a fake server with the real API's rules: created once, only
 * as encrypted records, rewritten in order, merged when another device wrote.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function unlocked() {
  const b = fakeBrowser();
  cleanups.push(() => {
    b.closeAll();
  });
  const tab = b.openTab();
  await tab.vault.start(ALICE);
  await tab.vault.createKeys(PASSPHRASE);
  return {
    b,
    access: { vault: tab.vault, api: b.server.api },
    state: b.server.state,
    records: b.server.records,
  };
}

const ask = (id: string, text: string): SavedMessage => ({
  id,
  role: "user",
  text,
});
const reply = (id: string, text: string): SavedMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text }],
});

describe("a new chat", () => {
  it("is two encrypted records, titled after its first question", async () => {
    const { access, records } = await unlocked();
    const saver = new ChatSaver(access);

    const result = await saver.save([ask("q1", "How is my SOL doing?")]);

    expect(result).toMatchObject({
      state: "saved",
      chat: { title: "How is my SOL doing?" },
    });
    expect([...records.values()].map(({ kind }) => kind).sort()).toEqual([
      "conversation",
      "message",
    ]);
    expect(JSON.stringify([...records.values()])).not.toMatch(/SOL/);
    const { chats, damaged } = await loadChats(access);
    expect(damaged).toEqual([]);
    expect(chats).toHaveLength(1);
    const [chat] = chats;
    if (!chat) throw new Error("No chat.");
    expect(await openChat(access, chat)).toEqual({
      revision: 1,
      messages: [ask("q1", "How is my SOL doing?")],
    });
  });

  it("is written once when the first answer was lost on the way", async () => {
    const { access, state, records } = await unlocked();
    const saver = new ChatSaver(access);
    state.answerLost.add("createRecords");
    expect((await saver.save([ask("q1", "Hi")])).state).toBe("failed");
    state.answerLost.clear();

    const again = await saver.save([ask("q1", "Hi"), reply("a1", "Hello")]);

    expect(again.state).toBe("saved");
    expect(records.size).toBe(2);
    const [chat] = (await loadChats(access)).chats;
    if (!chat) throw new Error("No chat.");
    expect((await openChat(access, chat))?.messages).toHaveLength(2);
  });

  it("is not stored while the vault cannot write, and is with the next save", async () => {
    const { access, state, records } = await unlocked();
    const saver = new ChatSaver(access);
    state.offline.add("createRecords");
    expect(await saver.save([ask("q1", "Hi")])).toEqual({ state: "failed" });
    expect(records.size).toBe(0);
    expect(saver.chat).toBeNull();

    state.offline.clear();
    expect((await saver.save([ask("q1", "Hi")])).state).toBe("saved");
    expect(records.size).toBe(2);
  });
});

describe("a chat that goes on", () => {
  it("rewrites its messages, and moves to the top of the list", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    cleanups.push(() => {
      vi.useRealTimers();
    });
    const { access } = await unlocked();
    vi.setSystemTime("2026-11-24T10:00:00Z");
    const first = new ChatSaver(access);
    await first.save([ask("q1", "First")]);
    vi.setSystemTime("2026-11-24T11:00:00Z");
    const second = new ChatSaver(access);
    await second.save([ask("q2", "Second")]);
    expect((await loadChats(access)).chats.map(({ title }) => title)).toEqual([
      "Second",
      "First",
    ]);

    vi.setSystemTime("2026-11-24T12:00:00Z");
    const result = await first.save([ask("q1", "First"), reply("a1", "Yes")]);

    expect(result.state).toBe("saved");
    const { chats } = await loadChats(access);
    expect(chats.map(({ title }) => title)).toEqual(["First", "Second"]);
    expect(chats[0]?.updatedAt).toBe("2026-11-24T12:00:00.000Z");
    expect(chats[0]?.createdAt).toBe("2026-11-24T10:00:00.000Z");
  });

  it("keeps the latest of several saves, one after another", async () => {
    const { access, state } = await unlocked();
    const saver = new ChatSaver(access);
    const list = [ask("q1", "Hi")];
    await saver.save(list);
    const before = state.calls.length;

    const results = await Promise.all(
      ["a", "b", "c", "d"].map((text) =>
        saver.save([...list, reply("a1", text)]),
      ),
    );

    expect(results.map(({ state: s }) => s)).toEqual(Array(4).fill("saved"));
    const [chat] = (await loadChats(access)).chats;
    if (!chat) throw new Error("No chat.");
    expect((await openChat(access, chat))?.messages.at(-1)).toEqual(
      reply("a1", "d"),
    );
    // The first of the four is written; the last replaces the two waiting.
    const puts = state.calls.slice(before).filter((c) => c === "putRecord");
    expect(puts).toHaveLength(4);
  });

  it("adds what another device wrote, and says so", async () => {
    const { access } = await unlocked();
    const here = new ChatSaver(access);
    await here.save([ask("q1", "Hi")]);
    const entry = (await loadChats(access)).chats[0];
    if (!entry) throw new Error("No chat.");
    const other = await openChat(access, entry);
    if (!other) throw new Error("No body.");
    const there = new ChatSaver(access, {
      entry,
      bodyRevision: other.revision,
    });
    await there.save([ask("q1", "Hi"), reply("a1", "Hello")]);

    const result = await here.save([ask("q1", "Hi"), ask("q2", "And now?")]);

    expect(result).toMatchObject({
      state: "saved",
      merged: [ask("q1", "Hi"), reply("a1", "Hello"), ask("q2", "And now?")],
    });
    const now = (await loadChats(access)).chats[0];
    if (!now) throw new Error("No chat.");
    expect((await openChat(access, now))?.messages).toHaveLength(3);
  });

  it("is gone once another device deleted it: nothing is written again", async () => {
    const { access, records } = await unlocked();
    const saver = new ChatSaver(access);
    await saver.save([ask("q1", "Hi")]);
    records.clear();

    expect(await saver.save([ask("q1", "Hi"), reply("a1", "Hello")])).toEqual({
      state: "gone",
    });
    expect(await saver.save([ask("q1", "Hi"), ask("q2", "Again")])).toEqual({
      state: "gone",
    });
    expect(records.size).toBe(0);
  });

  it("is full past one record's size, and writes nothing more", async () => {
    const { access, state } = await unlocked();
    const saver = new ChatSaver(access);
    await saver.save([ask("q1", "Hi")]);
    const calls = state.calls.length;
    const huge = Array.from({ length: 40 }, (_, index) =>
      ask(`q${String(index)}`, "x".repeat(1900)),
    );

    expect(await saver.save(huge)).toEqual({ state: "full" });
    expect(state.calls).toHaveLength(calls);
  });
});

describe("the list", () => {
  it("counts records it cannot read apart from the readable ones", async () => {
    const { access, records } = await unlocked();
    await new ChatSaver(access).save([ask("q1", "Hi")]);
    const id = crypto.randomUUID();
    records.set(id, {
      kind: "conversation",
      revision: 1,
      envelope: (
        await newRecord(access.vault, "conversation", crypto.randomUUID(), {
          v: 1,
        })
      ).envelope,
    });

    const { chats, damaged } = await loadChats(access);
    expect(chats).toHaveLength(1);
    expect(damaged).toEqual([id]);
  });

  it("opens no chat whose messages are gone or damaged", async () => {
    const { access, records } = await unlocked();
    await new ChatSaver(access).save([ask("q1", "Hi")]);
    const [chat] = (await loadChats(access)).chats;
    if (!chat) throw new Error("No chat.");
    await writeRecord(access.vault, access.api, "message", chat.bodyId, 1, {
      not: "messages",
    });
    expect(await openChat(access, chat)).toBeNull();
    records.delete(chat.bodyId);
    expect(await openChat(access, chat)).toBeNull();
  });
});
