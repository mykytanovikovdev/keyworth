import { afterEach, describe, expect, it, vi } from "vitest";
import { chatDeletes } from "../../../src/features/chat/deleting.ts";

/* Chats on their way out: shown again by Undo, gone once it is over. */

afterEach(async () => {
  await chatDeletes.flush();
});

const deletion = (
  chats: readonly string[] | "all",
  run: () => Promise<unknown> = () => Promise.resolve(),
) => ({ chats, run: vi.fn(run), onFail: vi.fn() });

describe("a chat on its way out", () => {
  it("is hidden at once, and deleted only when its Undo is over", async () => {
    const job = deletion(["a"]);
    const { commit } = chatDeletes.start(job);

    expect(chatDeletes.hidden().ids).toEqual(new Set(["a"]));
    expect(job.run).not.toHaveBeenCalled();

    await commit();
    expect(job.run).toHaveBeenCalledExactlyOnceWith({ leaving: false });
    expect(chatDeletes.hidden().ids.size).toBe(0);
  });

  it("is not deleted after Undo", async () => {
    const job = deletion(["a"]);
    const { undo, commit } = chatDeletes.start(job);
    undo();
    await commit();
    await chatDeletes.flush();

    expect(job.run).not.toHaveBeenCalled();
    expect(chatDeletes.hidden().ids.size).toBe(0);
  });

  it("is deleted by flush, once, even when the toast closes meanwhile", async () => {
    const job = deletion(["a"]);
    const { commit } = chatDeletes.start(job);

    await Promise.all([
      chatDeletes.flush({ leaving: true }),
      commit(),
      chatDeletes.flush(),
    ]);

    expect(job.run).toHaveBeenCalledExactlyOnceWith({ leaving: true });
  });

  it("cannot be undone while it is being deleted", async () => {
    let finish: () => void = () => undefined;
    const job = deletion(["a"], () => new Promise<void>((r) => (finish = r)));
    const { undo, commit } = chatDeletes.start(job);
    const done = commit();
    undo();

    expect(chatDeletes.hidden().ids).toEqual(new Set(["a"]));
    finish();
    await done;
    expect(chatDeletes.hidden().ids.size).toBe(0);
  });

  it("shows again when the server refused", async () => {
    const job = deletion(["a"], () => Promise.reject(new Error("offline")));
    const { commit } = chatDeletes.start(job);
    await commit();

    expect(job.onFail).toHaveBeenCalledOnce();
    expect(chatDeletes.hidden().ids.size).toBe(0);
  });

  it("keeps apart chats deleted one after another", async () => {
    const first = chatDeletes.start(deletion(["a"]));
    chatDeletes.start(deletion(["b"]));
    chatDeletes.start(deletion("all"));
    expect(chatDeletes.hidden()).toEqual({
      all: true,
      ids: new Set(["a", "b"]),
    });

    first.undo();
    expect(chatDeletes.hidden()).toEqual({ all: true, ids: new Set(["b"]) });
    await chatDeletes.flush();
    expect(chatDeletes.hidden().all).toBe(false);
  });

  it("tells its listeners of every change", () => {
    const listener = vi.fn();
    const stop = chatDeletes.subscribe(listener);
    const { undo } = chatDeletes.start(deletion(["a"]));
    undo();
    stop();
    chatDeletes.start(deletion(["b"]));

    expect(listener).toHaveBeenCalledTimes(2);
  });
});
