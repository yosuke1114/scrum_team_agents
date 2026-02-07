import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink } from "node:fs/promises";
import { StateStore } from "../state/store.js";
import { sprintCreate, sprintComplete } from "../tools/sprint.js";

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

describe("sprint_create", () => {
  it("スプリントとタスクを作成できる", async () => {
    const result = await sprintCreate(store, {
      goal: "MVP リリース",
      tasks: [
        {
          title: "ログイン機能",
          description: "ユーザーログイン",
          acceptanceCriteria: ["メール認証", "パスワードリセット"],
          priority: "high",
        },
        {
          title: "ダッシュボード",
          description: "メイン画面",
          acceptanceCriteria: ["グラフ表示"],
          priority: "medium",
        },
      ],
    });

    expect(result.ok).toBe(true);

    const state = store.getState();
    expect(state.currentSprint).not.toBeNull();
    expect(state.currentSprint!.goal).toBe("MVP リリース");
    expect(state.currentSprint!.state).toBe("PLANNING");
    expect(state.currentSprint!.tasks).toHaveLength(2);

    // タスクが tasks に追加されている
    const taskIds = state.currentSprint!.tasks;
    for (const id of taskIds) {
      expect(state.tasks[id]).toBeDefined();
      expect(state.tasks[id].state).toBe("TODO");
    }
  });

  it("スプリント番号が連番になる", async () => {
    // 1つ目のスプリント
    await sprintCreate(store, {
      goal: "Sprint 1",
      tasks: [
        {
          title: "Task 1",
          description: "desc",
          acceptanceCriteria: [],
          priority: "medium",
        },
      ],
    });

    // COMPLETED に変更
    await store.update((s) => {
      if (s.currentSprint) {
        s.currentSprint.state = "COMPLETED";
        s.currentSprint.completedAt = new Date().toISOString();

        const idx = s.sprints.findIndex((sp) => sp.id === s.currentSprint!.id);
        if (idx >= 0) {
          s.sprints[idx] = { ...s.currentSprint, tasks: [...s.currentSprint.tasks] };
        }
      }
    });

    // 2つ目のスプリント
    await sprintCreate(store, {
      goal: "Sprint 2",
      tasks: [
        {
          title: "Task 2",
          description: "desc",
          acceptanceCriteria: [],
          priority: "low",
        },
      ],
    });

    const state = store.getState();
    expect(state.currentSprint!.number).toBe(2);
    expect(state.sprints).toHaveLength(2);
  });

  it("アクティブスプリントがある場合はエラー", async () => {
    await sprintCreate(store, {
      goal: "Sprint 1",
      tasks: [
        {
          title: "Task",
          description: "desc",
          acceptanceCriteria: [],
          priority: "medium",
        },
      ],
    });

    // ACTIVE に手動変更
    await store.update((s) => {
      if (s.currentSprint) {
        s.currentSprint.state = "ACTIVE";
      }
    });

    const result = await sprintCreate(store, {
      goal: "Sprint 2",
      tasks: [
        {
          title: "Task",
          description: "desc",
          acceptanceCriteria: [],
          priority: "medium",
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("アクティブ");
  });

  it("PLANNING 状態のスプリントがある場合はエラー", async () => {
    await sprintCreate(store, {
      goal: "Sprint 1",
      tasks: [
        {
          title: "Task",
          description: "desc",
          acceptanceCriteria: [],
          priority: "medium",
        },
      ],
    });

    const result = await sprintCreate(store, {
      goal: "Sprint 2",
      tasks: [
        {
          title: "Task",
          description: "desc",
          acceptanceCriteria: [],
          priority: "medium",
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("プランニング中");
  });
});

describe("sprint_complete", () => {
  it("アクティブスプリントを完了できる", async () => {
    await sprintCreate(store, {
      goal: "Sprint 1",
      tasks: [
        {
          title: "Task 1",
          description: "desc",
          acceptanceCriteria: [],
          priority: "high",
        },
        {
          title: "Task 2",
          description: "desc",
          acceptanceCriteria: [],
          priority: "medium",
        },
      ],
    });

    const state1 = store.getState();
    const taskIds = state1.currentSprint!.tasks;

    // ACTIVE にして、1つのタスクを DONE に
    await store.update((s) => {
      if (s.currentSprint) {
        s.currentSprint.state = "ACTIVE";
        s.currentSprint.startedAt = new Date().toISOString();
      }
      // Task 1: TODO → IN_PROGRESS → IN_REVIEW → DONE
      s.tasks[taskIds[0]].state = "DONE";
    });

    const result = await sprintComplete(store, { sprintId: "sprint-1" });
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.completionRate).toBe(50);
    expect(result.data!.completedTasks).toBe(1);

    const state2 = store.getState();
    expect(state2.currentSprint!.state).toBe("COMPLETED");
    expect(state2.currentSprint!.completedAt).not.toBeNull();
  });

  it("存在しないスプリント ID はエラー", async () => {
    const result = await sprintComplete(store, { sprintId: "sprint-999" });
    expect(result.ok).toBe(false);
  });

  it("PLANNING 状態のスプリントは完了できない", async () => {
    await sprintCreate(store, {
      goal: "Sprint 1",
      tasks: [
        {
          title: "Task",
          description: "desc",
          acceptanceCriteria: [],
          priority: "medium",
        },
      ],
    });

    const result = await sprintComplete(store, { sprintId: "sprint-1" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("PLANNING");
  });

  it("sprint_complete 後に sprints[] が正しく同期される", async () => {
    await sprintCreate(store, {
      goal: "Sprint 1",
      tasks: [
        {
          title: "Task",
          description: "desc",
          acceptanceCriteria: [],
          priority: "medium",
        },
      ],
    });

    await store.update((s) => {
      if (s.currentSprint) {
        s.currentSprint.state = "ACTIVE";
        s.currentSprint.startedAt = new Date().toISOString();
      }
    });

    await sprintComplete(store, { sprintId: "sprint-1" });

    const state = store.getState();
    const archivedSprint = state.sprints.find((sp) => sp.id === "sprint-1");
    expect(archivedSprint).toBeDefined();
    expect(archivedSprint!.state).toBe("COMPLETED");
    expect(archivedSprint!.completedAt).not.toBeNull();
  });
});
