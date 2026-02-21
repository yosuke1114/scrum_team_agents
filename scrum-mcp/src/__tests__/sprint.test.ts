import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink } from "node:fs/promises";
import { StateStore } from "../state/store.js";
import { sprintCreate, sprintAddTasks, sprintComplete, sprintCarryOver, sprintCancel } from "../tools/sprint.js";
import { taskCreate, taskUpdate } from "../tools/task.js";

const TEST_FILE = "/tmp/scrum-test-sprint.json";
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

async function createReadyTasks(
  count: number,
  overrides?: { priority?: "high" | "medium" | "low"; points?: number }
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = await taskCreate(store, {
      title: `Task ${i + 1}`,
      description: "desc",
      acceptanceCriteria: [],
      priority: overrides?.priority ?? "medium",
      points: overrides?.points,
    });
    const id = (r.data as { taskId: string }).taskId;
    await taskUpdate(store, { taskId: id, state: "READY" });
    ids.push(id);
  }
  return ids;
}

describe("sprint_create", () => {
  it("READY タスクを使ってスプリントを作成できる", async () => {
    const taskIds = await createReadyTasks(2);
    const result = await sprintCreate(store, { goal: "MVP リリース", taskIds });

    expect(result.ok).toBe(true);
    const state = store.getState();
    expect(state.currentSprint).not.toBeNull();
    expect(state.currentSprint!.goal).toBe("MVP リリース");
    expect(state.currentSprint!.state).toBe("PLANNING");
    expect(state.currentSprint!.tasks).toHaveLength(2);

    for (const id of state.currentSprint!.tasks) {
      expect(state.tasks[id]).toBeDefined();
      expect(state.tasks[id].state).toBe("TODO");
    }
  });

  it("スプリント番号が連番になる", async () => {
    const ids1 = await createReadyTasks(1);
    await sprintCreate(store, { goal: "Sprint 1", taskIds: ids1 });

    await store.update((s) => {
      if (s.currentSprint) {
        s.currentSprint.state = "COMPLETED";
        s.currentSprint.completedAt = new Date().toISOString();
        const idx = s.sprints.findIndex((sp) => sp.id === s.currentSprint!.id);
        if (idx >= 0) s.sprints[idx] = { ...s.currentSprint, tasks: [...s.currentSprint.tasks] };
      }
    });

    const ids2 = await createReadyTasks(1);
    await sprintCreate(store, { goal: "Sprint 2", taskIds: ids2 });

    const state = store.getState();
    expect(state.currentSprint!.number).toBe(2);
    expect(state.sprints).toHaveLength(2);
  });

  it("アクティブスプリントがある場合はエラー", async () => {
    const ids1 = await createReadyTasks(1);
    await sprintCreate(store, { goal: "Sprint 1", taskIds: ids1 });
    await store.update((s) => { if (s.currentSprint) s.currentSprint.state = "ACTIVE"; });

    const ids2 = await createReadyTasks(1);
    const result = await sprintCreate(store, { goal: "Sprint 2", taskIds: ids2 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("アクティブ");
  });

  it("PLANNING 状態のスプリントがある場合はエラー", async () => {
    const ids1 = await createReadyTasks(1);
    await sprintCreate(store, { goal: "Sprint 1", taskIds: ids1 });

    const ids2 = await createReadyTasks(1);
    const result = await sprintCreate(store, { goal: "Sprint 2", taskIds: ids2 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("プランニング中");
  });

  it("存在しないタスク ID はエラー", async () => {
    const result = await sprintCreate(store, { goal: "Sprint 1", taskIds: ["task-nonexistent"] });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("見つかりません");
  });

  it("READY でないタスクはエラー", async () => {
    const r = await taskCreate(store, { title: "Backlog", description: "d", acceptanceCriteria: [], priority: "medium" });
    const id = (r.data as { taskId: string }).taskId;
    const result = await sprintCreate(store, { goal: "Sprint 1", taskIds: [id] });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("READY 状態でない");
  });
});

describe("sprint_add_tasks", () => {
  it("PLANNING スプリントにタスクを追加できる", async () => {
    const ids1 = await createReadyTasks(1);
    await sprintCreate(store, { goal: "Sprint 1", taskIds: ids1 });

    const ids2 = await createReadyTasks(1);
    const result = await sprintAddTasks(store, { sprintId: "sprint-1", taskIds: ids2 });

    expect(result.ok).toBe(true);
    expect(store.getState().currentSprint!.tasks).toHaveLength(2);
  });

  it("ACTIVE スプリントには追加できない", async () => {
    const ids = await createReadyTasks(1);
    await sprintCreate(store, { goal: "Sprint 1", taskIds: ids });
    await store.update((s) => { if (s.currentSprint) s.currentSprint.state = "ACTIVE"; });

    const ids2 = await createReadyTasks(1);
    const result = await sprintAddTasks(store, { sprintId: "sprint-1", taskIds: ids2 });
    expect(result.ok).toBe(false);
  });
});

describe("sprint_complete", () => {
  it("アクティブスプリントを完了できる", async () => {
    const ids = await createReadyTasks(2);
    await sprintCreate(store, { goal: "Sprint 1", taskIds: ids });

    await store.update((s) => {
      if (s.currentSprint) {
        s.currentSprint.state = "ACTIVE";
        s.currentSprint.startedAt = new Date().toISOString();
      }
      s.tasks[ids[0]].state = "DONE";
    });

    const result = await sprintComplete(store, { sprintId: "sprint-1" });
    expect(result.ok).toBe(true);
    expect(result.data!.completionRate).toBe(50);
    expect(result.data!.completedTasks).toBe(1);

    const state = store.getState();
    expect(state.currentSprint!.state).toBe("COMPLETED");
  });

  it("DONE タスクが自動アーカイブされる", async () => {
    const ids = await createReadyTasks(2);
    await sprintCreate(store, { goal: "Sprint 1", taskIds: ids });

    await store.update((s) => {
      if (s.currentSprint) {
        s.currentSprint.state = "ACTIVE";
        s.currentSprint.startedAt = new Date().toISOString();
      }
      s.tasks[ids[0]].state = "DONE";
    });

    await sprintComplete(store, { sprintId: "sprint-1" });
    const state = store.getState();
    expect(state.archivedTasks[ids[0]]).toBeDefined();
    expect(state.tasks[ids[0]]).toBeUndefined();
    expect(state.tasks[ids[1]]).toBeDefined();
  });

  it("ストーリーポイントが計算される", async () => {
    const ids = await createReadyTasks(2, { points: 5 });
    await sprintCreate(store, { goal: "Sprint 1", taskIds: ids });
    await store.update((s) => {
      if (s.currentSprint) {
        s.currentSprint.state = "ACTIVE";
        s.currentSprint.startedAt = new Date().toISOString();
      }
      s.tasks[ids[0]].state = "DONE";
    });

    const result = await sprintComplete(store, { sprintId: "sprint-1" });
    expect(result.data!.totalPoints).toBe(10);
    expect(result.data!.completedPoints).toBe(5);
  });

  it("存在しないスプリント ID はエラー", async () => {
    const result = await sprintComplete(store, { sprintId: "sprint-999" });
    expect(result.ok).toBe(false);
  });

  it("PLANNING 状態のスプリントは完了できない", async () => {
    const ids = await createReadyTasks(1);
    await sprintCreate(store, { goal: "Sprint 1", taskIds: ids });
    const result = await sprintComplete(store, { sprintId: "sprint-1" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("PLANNING");
  });
});

describe("sprint_carry_over", () => {
  it("完了スプリントの未完了タスクを READY に戻せる", async () => {
    const ids = await createReadyTasks(2);
    await sprintCreate(store, { goal: "Sprint 1", taskIds: ids });
    await store.update((s) => {
      if (s.currentSprint) {
        s.currentSprint.state = "ACTIVE";
        s.currentSprint.startedAt = new Date().toISOString();
      }
      s.tasks[ids[0]].state = "DONE";
    });
    await sprintComplete(store, { sprintId: "sprint-1" });

    const result = await sprintCarryOver(store, { sprintId: "sprint-1" });
    expect(result.ok).toBe(true);
    expect(store.getState().tasks[ids[1]].state).toBe("READY");
  });

  it("ACTIVE スプリントからは持ち越しできない", async () => {
    const ids = await createReadyTasks(1);
    await sprintCreate(store, { goal: "Sprint 1", taskIds: ids });
    await store.update((s) => {
      if (s.currentSprint) {
        s.currentSprint.state = "ACTIVE";
        const idx = s.sprints.findIndex((sp) => sp.id === s.currentSprint!.id);
        if (idx >= 0) s.sprints[idx].state = "ACTIVE";
      }
    });

    const result = await sprintCarryOver(store, { sprintId: "sprint-1" });
    expect(result.ok).toBe(false);
  });
});

describe("sprint_cancel", () => {
  it("PLANNING スプリントを中止できる", async () => {
    const ids = await createReadyTasks(1);
    await sprintCreate(store, { goal: "Sprint 1", taskIds: ids });

    const result = await sprintCancel(store, { sprintId: "sprint-1", reason: "要件変更" });
    expect(result.ok).toBe(true);
    expect(store.getState().currentSprint!.state).toBe("CANCELLED");
  });

  it("ACTIVE スプリントを中止できる", async () => {
    const ids = await createReadyTasks(1);
    await sprintCreate(store, { goal: "Sprint 1", taskIds: ids });
    await store.update((s) => {
      if (s.currentSprint) {
        s.currentSprint.state = "ACTIVE";
        s.currentSprint.startedAt = new Date().toISOString();
      }
    });

    const result = await sprintCancel(store, { sprintId: "sprint-1", reason: "ブロッカー" });
    expect(result.ok).toBe(true);
    expect(store.getState().currentSprint!.state).toBe("CANCELLED");
  });

  it("完了済みスプリントは中止できない", async () => {
    const ids = await createReadyTasks(1);
    await sprintCreate(store, { goal: "Sprint 1", taskIds: ids });
    await store.update((s) => {
      if (s.currentSprint) {
        s.currentSprint.state = "COMPLETED";
        s.currentSprint.completedAt = new Date().toISOString();
      }
    });

    const result = await sprintCancel(store, { sprintId: "sprint-1", reason: "テスト" });
    expect(result.ok).toBe(false);
  });
});
