import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink } from "node:fs/promises";
import { StateStore } from "../state/store.js";
import { ceremonyStart, ceremonyEnd } from "../tools/ceremony.js";

const TEST_FILE = "/tmp/scrum-test-ceremony.json";
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

describe("ceremony_start", () => {
  it("IDLE → refinement を開始できる", async () => {
    const result = await ceremonyStart(store, { type: "refinement" });
    expect(result.ok).toBe(true);
    const state = store.getState();
    expect(state.currentCeremony).toBe("refinement");
    expect(state.ceremonyState).toBe("REFINEMENT");
  });

  it("IDLE → planning を開始できる", async () => {
    const result = await ceremonyStart(store, { type: "planning" });
    expect(result.ok).toBe(true);
    const state = store.getState();
    expect(state.currentCeremony).toBe("planning");
    expect(state.ceremonyState).toBe("PLANNING");
  });

  it("IDLE → sprint を直接開始できない", async () => {
    const result = await ceremonyStart(store, { type: "sprint" });
    expect(result.ok).toBe(false);
  });

  it("IDLE → review を直接開始できない", async () => {
    const result = await ceremonyStart(store, { type: "review" });
    expect(result.ok).toBe(false);
  });

  it("REFINEMENT 終了 → planning に遷移できる", async () => {
    await ceremonyStart(store, { type: "refinement" });
    await ceremonyEnd(store, { type: "refinement" });

    const result = await ceremonyStart(store, { type: "planning" });
    expect(result.ok).toBe(true);
    const state = store.getState();
    expect(state.ceremonyState).toBe("PLANNING");
  });

  it("不正な状態遷移はエラーになる", async () => {
    await ceremonyStart(store, { type: "refinement" });
    const result = await ceremonyStart(store, { type: "sprint" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("実行中です");
  });
});

describe("ceremony_end", () => {
  it("実行中のセレモニーを終了できる", async () => {
    await ceremonyStart(store, { type: "refinement" });
    const result = await ceremonyEnd(store, { type: "refinement" });
    expect(result.ok).toBe(true);
    const state = store.getState();
    expect(state.currentCeremony).toBeNull();
    expect(state.ceremonyState).toBe("IDLE");
  });

  it("一致しないセレモニーの終了はエラー", async () => {
    await ceremonyStart(store, { type: "refinement" });
    const result = await ceremonyEnd(store, { type: "planning" });
    expect(result.ok).toBe(false);
  });

  it("retro 終了でフルサイクルが IDLE に戻る", async () => {
    // planning
    await ceremonyStart(store, { type: "planning" });

    // sprint_create equivalent - set up sprint manually
    await store.update((s) => {
      s.currentSprint = {
        id: "sprint-1",
        number: 1,
        goal: "test",
        tasks: [],
        state: "PLANNING",
        startedAt: null,
        completedAt: null,
      };
      s.sprints = [
        {
          id: "sprint-1",
          number: 1,
          goal: "test",
          tasks: [],
          state: "PLANNING",
          startedAt: null,
          completedAt: null,
        },
      ];
    });

    await ceremonyEnd(store, { type: "planning" });

    // sprint
    await ceremonyStart(store, { type: "sprint" });

    // review (sprint→review 暗黙遷移)
    await ceremonyStart(store, { type: "review" });

    // sprint_complete equivalent
    await store.update((s) => {
      if (s.currentSprint) {
        s.currentSprint.state = "COMPLETED";
        s.currentSprint.completedAt = new Date().toISOString();
      }
    });

    await ceremonyEnd(store, { type: "review" });

    // retro
    await ceremonyStart(store, { type: "retro" });
    const result = await ceremonyEnd(store, { type: "retro" });
    expect(result.ok).toBe(true);

    const state = store.getState();
    expect(state.ceremonyState).toBe("IDLE");
    expect(state.currentCeremony).toBeNull();
  });
});

describe("ceremony_end ガード", () => {
  it("sprint の ceremony_end は拒否される", async () => {
    await store.update((s) => {
      s.currentSprint = {
        id: "sprint-1",
        number: 1,
        goal: "test",
        tasks: [],
        state: "PLANNING",
        startedAt: null,
        completedAt: null,
      };
      s.sprints = [
        {
          id: "sprint-1",
          number: 1,
          goal: "test",
          tasks: [],
          state: "PLANNING",
          startedAt: null,
          completedAt: null,
        },
      ];
    });

    await ceremonyStart(store, { type: "planning" });
    await ceremonyEnd(store, { type: "planning" });
    await ceremonyStart(store, { type: "sprint" });

    const result = await ceremonyEnd(store, { type: "sprint" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ceremony_end では終了できません");

    const state = store.getState();
    expect(state.ceremonyState).toBe("SPRINT_ACTIVE");
  });

  it("sprint 実行中に review を開始すると sprint が暗黙終了する", async () => {
    await store.update((s) => {
      s.currentSprint = {
        id: "sprint-1",
        number: 1,
        goal: "test",
        tasks: [],
        state: "PLANNING",
        startedAt: null,
        completedAt: null,
      };
      s.sprints = [
        {
          id: "sprint-1",
          number: 1,
          goal: "test",
          tasks: [],
          state: "PLANNING",
          startedAt: null,
          completedAt: null,
        },
      ];
    });

    await ceremonyStart(store, { type: "planning" });
    await ceremonyEnd(store, { type: "planning" });
    await ceremonyStart(store, { type: "sprint" });

    // sprint 中に review を開始
    const result = await ceremonyStart(store, { type: "review" });
    expect(result.ok).toBe(true);

    const state = store.getState();
    expect(state.currentCeremony).toBe("review");
    expect(state.ceremonyState).toBe("SPRINT_REVIEW");
  });

  it("セレモニー実行中に別のセレモニーを開始できない", async () => {
    await ceremonyStart(store, { type: "refinement" });
    const result = await ceremonyStart(store, { type: "planning" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("実行中です");
  });
});

describe("ceremony_end 追加ケース", () => {
  it("planning の ceremony_end で PLANNING 状態が維持される", async () => {
    await ceremonyStart(store, { type: "planning" });
    const result = await ceremonyEnd(store, { type: "planning" });
    expect(result.ok).toBe(true);
    const state = store.getState();
    expect(state.currentCeremony).toBeNull();
    expect(state.ceremonyState).toBe("PLANNING");
  });

  it("セレモニー未実行で ceremony_end はエラー", async () => {
    const result = await ceremonyEnd(store, { type: "refinement" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("実行中ではありません");
  });
});

describe("ceremony_start 前提条件", () => {
  it("review はアクティブスプリントがない場合エラー", async () => {
    await store.update((s) => {
      s.ceremonyState = "SPRINT_ACTIVE";
      s.currentCeremony = "sprint";
    });
    const result = await ceremonyStart(store, { type: "review" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("アクティブまたは中止済みのスプリントがありません");
  });

  it("retro はスプリントが PLANNING だとエラー", async () => {
    await store.update((s) => {
      s.ceremonyState = "SPRINT_REVIEW";
      s.currentSprint = {
        id: "sprint-1", number: 1, goal: "test", tasks: [],
        state: "PLANNING", startedAt: null, completedAt: null,
      };
    });
    const result = await ceremonyStart(store, { type: "retro" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("アクティブ、完了、または中止状態ではありません");
  });

  it("sprint はスプリント未作成でエラー", async () => {
    await store.update((s) => {
      s.ceremonyState = "PLANNING";
      s.currentCeremony = null;
    });
    const result = await ceremonyStart(store, { type: "sprint" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("スプリントが作成されていません");
  });
});
