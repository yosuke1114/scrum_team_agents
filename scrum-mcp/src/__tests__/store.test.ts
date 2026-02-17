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
});
