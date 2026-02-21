import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink } from "node:fs/promises";
import { StateStore } from "../state/store.js";
import { taskCreate, taskUpdate } from "../tools/task.js";

const TEST_FILE = "/tmp/scrum-test-task.json";
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

describe("task_create", () => {
  it("バックログにタスクを作成できる", async () => {
    const result = await taskCreate(store, {
      title: "認証機能",
      description: "OAuth2 認証の実装",
      acceptanceCriteria: ["Google ログイン", "GitHub ログイン"],
      priority: "high",
    });

    expect(result.ok).toBe(true);

    const state = store.getState();
    const taskIds = Object.keys(state.tasks);
    expect(taskIds).toHaveLength(1);

    const task = state.tasks[taskIds[0]];
    expect(task.id).toMatch(/^task-[0-9a-f-]{36}$/);
    expect(task.state).toBe("BACKLOG");
    expect(task.priority).toBe("high");
    expect(task.acceptanceCriteria).toEqual(["Google ログイン", "GitHub ログイン"]);
    expect(task.assignee).toBeNull();
    expect(task.points).toBeNull();
  });

  it("ポイント付きでタスクを作成できる", async () => {
    const result = await taskCreate(store, {
      title: "ポイント付き",
      description: "desc",
      acceptanceCriteria: [],
      priority: "medium",
      points: 5,
    });
    expect(result.ok).toBe(true);
    const id = (result.data as { taskId: string }).taskId;
    expect(store.getState().tasks[id].points).toBe(5);
  });

  it("複数タスクを作成できる", async () => {
    await taskCreate(store, {
      title: "Task 1",
      description: "desc",
      acceptanceCriteria: [],
      priority: "high",
    });

    await taskCreate(store, {
      title: "Task 2",
      description: "desc",
      acceptanceCriteria: [],
      priority: "low",
    });

    const state = store.getState();
    const taskIds = Object.keys(state.tasks);
    expect(taskIds).toHaveLength(2);
  });
});

describe("task_update", () => {
  async function createTestTask(): Promise<string> {
    const result = await taskCreate(store, {
      title: "Test Task",
      description: "desc",
      acceptanceCriteria: [],
      priority: "medium",
    });
    return (result.data as { taskId: string }).taskId;
  }

  it("BACKLOG → READY に遷移できる", async () => {
    const taskId = await createTestTask();
    const result = await taskUpdate(store, { taskId, state: "READY" });
    expect(result.ok).toBe(true);

    const state = store.getState();
    expect(state.tasks[taskId].state).toBe("READY");
  });

  it("READY → TODO → IN_PROGRESS の正常遷移", async () => {
    const taskId = await createTestTask();

    await taskUpdate(store, { taskId, state: "READY" });
    await taskUpdate(store, { taskId, state: "TODO" });
    const result = await taskUpdate(store, {
      taskId,
      state: "IN_PROGRESS",
      assignee: "developer-1",
    });

    expect(result.ok).toBe(true);
    const state = store.getState();
    expect(state.tasks[taskId].state).toBe("IN_PROGRESS");
    expect(state.tasks[taskId].assignee).toBe("developer-1");
  });

  it("TODO → BACKLOG への降格遷移", async () => {
    const taskId = await createTestTask();
    await taskUpdate(store, { taskId, state: "READY" });
    await taskUpdate(store, { taskId, state: "TODO" });

    const result = await taskUpdate(store, { taskId, state: "BACKLOG" });
    expect(result.ok).toBe(true);
    expect(store.getState().tasks[taskId].state).toBe("BACKLOG");
  });

  it("READY → BACKLOG への降格遷移", async () => {
    const taskId = await createTestTask();
    await taskUpdate(store, { taskId, state: "READY" });

    const result = await taskUpdate(store, { taskId, state: "BACKLOG" });
    expect(result.ok).toBe(true);
    expect(store.getState().tasks[taskId].state).toBe("BACKLOG");
  });

  it("BACKLOG → IN_PROGRESS の不正遷移はエラー", async () => {
    const taskId = await createTestTask();
    const result = await taskUpdate(store, { taskId, state: "IN_PROGRESS" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("遷移はできません");
  });

  it("DONE からの遷移はエラー", async () => {
    const taskId = await createTestTask();

    // BACKLOG → READY → TODO → IN_PROGRESS → IN_REVIEW → DONE
    await taskUpdate(store, { taskId, state: "READY" });
    await taskUpdate(store, { taskId, state: "TODO" });
    await taskUpdate(store, { taskId, state: "IN_PROGRESS" });
    await taskUpdate(store, { taskId, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId, state: "DONE" });

    const result = await taskUpdate(store, { taskId, state: "TODO" });
    expect(result.ok).toBe(false);
  });

  it("BLOCKED への遷移と復帰", async () => {
    const taskId = await createTestTask();

    await taskUpdate(store, { taskId, state: "READY" });
    await taskUpdate(store, { taskId, state: "TODO" });
    await taskUpdate(store, { taskId, state: "IN_PROGRESS" });

    // BLOCKED へ
    const blockResult = await taskUpdate(store, { taskId, state: "BLOCKED" });
    expect(blockResult.ok).toBe(true);
    expect(store.getState().tasks[taskId].state).toBe("BLOCKED");

    // IN_PROGRESS に復帰
    const unblockResult = await taskUpdate(store, {
      taskId,
      state: "IN_PROGRESS",
    });
    expect(unblockResult.ok).toBe(true);
    expect(store.getState().tasks[taskId].state).toBe("IN_PROGRESS");
  });

  it("存在しないタスク ID はエラー", async () => {
    const result = await taskUpdate(store, {
      taskId: "task-999",
      state: "READY",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("見つかりません");
  });

  it("WIP 制限超過で警告が出る", async () => {
    // 3 タスクを作成して IN_PROGRESS に
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await taskCreate(store, {
        title: `Task ${i + 1}`,
        description: "desc",
        acceptanceCriteria: [],
        priority: "medium",
      });
      ids.push((r.data as { taskId: string }).taskId);
    }

    // 全部 READY → TODO → IN_PROGRESS に遷移
    for (const id of ids) {
      await taskUpdate(store, { taskId: id, state: "READY" });
      await taskUpdate(store, { taskId: id, state: "TODO" });
    }

    // 1つ目: 制限内
    const r1 = await taskUpdate(store, { taskId: ids[0], state: "IN_PROGRESS" });
    expect(r1.ok).toBe(true);

    // 2つ目: 制限到達
    await taskUpdate(store, { taskId: ids[1], state: "IN_PROGRESS" });

    // 3つ目: 制限超過 → 警告
    const r3 = await taskUpdate(store, { taskId: ids[2], state: "IN_PROGRESS" });
    expect(r3.ok).toBe(true);
    expect(r3.message).toContain("WIP制限警告");
  });

  it("状態変更なしで優先度のみ更新できる", async () => {
    const taskId = await createTestTask();
    const result = await taskUpdate(store, { taskId, priority: "high" });
    expect(result.ok).toBe(true);
    expect(store.getState().tasks[taskId].priority).toBe("high");
    expect(store.getState().tasks[taskId].state).toBe("BACKLOG");
  });

  it("状態変更なしでポイントのみ更新できる", async () => {
    const taskId = await createTestTask();
    const result = await taskUpdate(store, { taskId, points: 8 });
    expect(result.ok).toBe(true);
    expect(store.getState().tasks[taskId].points).toBe(8);
  });

  it("更新フィールドなしでエラー", async () => {
    const taskId = await createTestTask();
    const result = await taskUpdate(store, { taskId });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("更新");
  });

  it("M6: 負のポイントでエラー", async () => {
    const taskId = await createTestTask();
    const result = await taskUpdate(store, { taskId, points: -3 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("0以上");
  });
});

describe("task_create バリデーション", () => {
  it("M6: 負のポイントで作成できない", async () => {
    const result = await taskCreate(store, {
      title: "Test",
      description: "desc",
      acceptanceCriteria: [],
      priority: "medium",
      points: -1,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("0以上");
  });

  it("0ポイントで作成できる", async () => {
    const result = await taskCreate(store, {
      title: "Zero pts",
      description: "desc",
      acceptanceCriteria: [],
      priority: "medium",
      points: 0,
    });
    expect(result.ok).toBe(true);
  });
});
