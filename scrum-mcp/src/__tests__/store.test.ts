import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { StateStore } from "../state/store.js";

const TEST_FILE = "/tmp/scrum-test-store.json";

let store: StateStore;

beforeEach(async () => {
  store = await StateStore.init(TEST_FILE);
});

afterEach(async () => {
  try {
    await unlink(TEST_FILE);
  } catch {
    // ignore
  }
});

describe("StateStore", () => {
  it("デフォルト状態で初期化される", () => {
    const state = store.getState();
    expect(state.currentCeremony).toBeNull();
    expect(state.ceremonyState).toBe("IDLE");
    expect(state.currentSprint).toBeNull();
    expect(state.sprints).toEqual([]);
    expect(state.tasks).toEqual({});
    expect(state.archivedTasks).toEqual({});
    expect(state.wipLimits).toEqual({ inProgress: 2, inReview: 1 });
    expect(state.config).toEqual({ githubRepo: "", projectName: "scrum-team" });
  });

  it("状態を更新してJSONに永続化する", async () => {
    await store.update((s) => {
      s.ceremonyState = "REFINEMENT";
      s.currentCeremony = "refinement";
    });

    const raw = await readFile(TEST_FILE, "utf-8");
    const persisted = JSON.parse(raw);
    expect(persisted.ceremonyState).toBe("REFINEMENT");
    expect(persisted.currentCeremony).toBe("refinement");
  });

  it("既存ファイルから状態を復元する", async () => {
    await store.update((s) => {
      s.config.projectName = "restored-project";
    });

    const store2 = await StateStore.init(TEST_FILE);
    const state = store2.getState();
    expect(state.config.projectName).toBe("restored-project");
  });

  it("リセットするとデフォルト状態に戻る", async () => {
    await store.update((s) => {
      s.ceremonyState = "PLANNING";
      s.currentCeremony = "planning";
    });

    await store.reset();
    const state = store.getState();
    expect(state.ceremonyState).toBe("IDLE");
    expect(state.currentCeremony).toBeNull();
  });

  it("getState はディープコピーを返す（参照共有しない）", async () => {
    await store.update((s) => {
      s.tasks["t-1"] = {
        id: "t-1", title: "Task", description: "desc",
        acceptanceCriteria: ["AC1"], state: "BACKLOG", priority: "high",
        assignee: null, githubIssueNumber: null, points: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
    });

    const copy1 = store.getState();
    const copy2 = store.getState();
    // 参照が異なること
    expect(copy1).not.toBe(copy2);
    expect(copy1.tasks["t-1"]).not.toBe(copy2.tasks["t-1"]);
    // 値は同じ
    expect(copy1.tasks["t-1"].title).toBe(copy2.tasks["t-1"].title);
  });

  it("peek は内部状態への参照を返す", () => {
    const peeked = store.peek();
    const peeked2 = store.peek();
    expect(peeked).toBe(peeked2);
  });

  it("不正な JSON ファイルからはデフォルト状態で初期化される", async () => {
    const { writeFile } = await import("node:fs/promises");
    const badFile = "/tmp/scrum-test-store-bad.json";
    await writeFile(badFile, "INVALID JSON {{{", "utf-8");

    const badStore = await StateStore.init(badFile);
    const state = badStore.getState();
    expect(state.ceremonyState).toBe("IDLE");
    expect(state.currentCeremony).toBeNull();

    try { await unlink(badFile); } catch { /* ignore */ }
  });

  it("update は更新後の状態コピーを返す", async () => {
    const result = await store.update((s) => {
      s.config.projectName = "updated";
    });
    expect(result.config.projectName).toBe("updated");
    // 返り値はコピー
    expect(result).not.toBe(store.peek());
  });
});
