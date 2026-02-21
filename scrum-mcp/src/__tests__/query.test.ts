import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink } from "node:fs/promises";
import { StateStore } from "../state/store.js";
import { listTasks, getTask, projectStatus } from "../tools/query.js";
import { taskCreate, taskUpdate } from "../tools/task.js";
import { sprintCreate } from "../tools/sprint.js";
import { ceremonyStart } from "../tools/ceremony.js";
import type { Task } from "../types.js";

const TEST_FILE = "/tmp/scrum-test-query.json";
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

describe("list_tasks", () => {
  it("タスクなしで空リストを返す", async () => {
    const result = await listTasks(store, {});
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("全タスクを優先度順で返す", async () => {
    await taskCreate(store, { title: "Low", description: "d", acceptanceCriteria: [], priority: "low" });
    await taskCreate(store, { title: "High", description: "d", acceptanceCriteria: [], priority: "high" });
    await taskCreate(store, { title: "Med", description: "d", acceptanceCriteria: [], priority: "medium" });

    const result = await listTasks(store, {});
    const data = result.data as Task[];
    expect(data).toHaveLength(3);
    expect(data[0].priority).toBe("high");
    expect(data[1].priority).toBe("medium");
    expect(data[2].priority).toBe("low");
  });

  it("state でフィルタできる", async () => {
    const r1 = await taskCreate(store, { title: "A", description: "d", acceptanceCriteria: [], priority: "high" });
    const r2 = await taskCreate(store, { title: "B", description: "d", acceptanceCriteria: [], priority: "medium" });
    const id1 = (r1.data as { taskId: string }).taskId;
    await taskUpdate(store, { taskId: id1, state: "READY" });

    const result = await listTasks(store, { state: "READY" });
    const data = result.data as Task[];
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("A");
  });

  it("priority でフィルタできる", async () => {
    await taskCreate(store, { title: "H", description: "d", acceptanceCriteria: [], priority: "high" });
    await taskCreate(store, { title: "L", description: "d", acceptanceCriteria: [], priority: "low" });

    const result = await listTasks(store, { priority: "high" });
    const data = result.data as Task[];
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("H");
  });

  it("assignee でフィルタできる", async () => {
    const r = await taskCreate(store, { title: "T", description: "d", acceptanceCriteria: [], priority: "medium" });
    const id = (r.data as { taskId: string }).taskId;
    await taskUpdate(store, { taskId: id, state: "READY" });
    await taskUpdate(store, { taskId: id, state: "TODO" });
    await taskUpdate(store, { taskId: id, state: "IN_PROGRESS", assignee: "dev-1" });

    const result = await listTasks(store, { assignee: "dev-1" });
    expect((result.data as Task[])).toHaveLength(1);

    const noMatch = await listTasks(store, { assignee: "dev-999" });
    expect((noMatch.data as Task[])).toHaveLength(0);
  });

  it("sprintId でフィルタできる", async () => {
    // バックログタスク
    await taskCreate(store, { title: "Backlog", description: "d", acceptanceCriteria: [], priority: "low" });
    // スプリントタスク
    await sprintCreate(store, {
      goal: "Sprint 1",
      tasks: [{ title: "Sprint Task", description: "d", acceptanceCriteria: [], priority: "high" }],
    });

    const result = await listTasks(store, { sprintId: "sprint-1" });
    const data = result.data as Task[];
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("Sprint Task");
  });

  it("存在しない sprintId はエラー", async () => {
    const result = await listTasks(store, { sprintId: "sprint-999" });
    expect(result.ok).toBe(false);
  });
});

describe("get_task", () => {
  it("タスクの詳細を返す", async () => {
    const r = await taskCreate(store, {
      title: "認証機能",
      description: "OAuth2 実装",
      acceptanceCriteria: ["Google ログイン", "GitHub ログイン"],
      priority: "high",
    });
    const taskId = (r.data as { taskId: string }).taskId;

    const result = await getTask(store, { taskId });
    expect(result.ok).toBe(true);
    const data = result.data as Task;
    expect(data.title).toBe("認証機能");
    expect(data.acceptanceCriteria).toEqual(["Google ログイン", "GitHub ログイン"]);
    expect(result.message).toContain("受入条件");
  });

  it("存在しないタスクはエラー", async () => {
    const result = await getTask(store, { taskId: "task-999" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("見つかりません");
  });
});

describe("project_status", () => {
  it("初期状態のダッシュボードを返す", async () => {
    const result = await projectStatus(store);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("IDLE");
    expect(result.message).toContain("スプリント: なし");
    expect(result.data).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = result.data as any;
    expect(data.ceremonyState).toBe("IDLE");
    expect(data.sprint).toBeNull();
    expect(data.blockers).toEqual([]);
  });

  it("スプリント進行中の状態を返す", async () => {
    await sprintCreate(store, {
      goal: "MVP",
      tasks: [
        { title: "T1", description: "d", acceptanceCriteria: [], priority: "high" },
        { title: "T2", description: "d", acceptanceCriteria: [], priority: "medium" },
      ],
    });

    const state = store.getState();
    const taskId = state.currentSprint!.tasks[0];

    // ACTIVE にして1つ DONE に
    await store.update((s) => {
      s.currentSprint!.state = "ACTIVE";
      s.currentSprint!.startedAt = new Date().toISOString();
    });
    await taskUpdate(store, { taskId, state: "IN_PROGRESS" });
    await taskUpdate(store, { taskId, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId, state: "DONE" });

    const result = await projectStatus(store);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("50%");
    expect(result.message).toContain("MVP");
    const data = result.data as { sprint: { completionRate: number } };
    expect(data.sprint.completionRate).toBe(50);
  });

  it("ブロッカーを検出する", async () => {
    const r = await taskCreate(store, { title: "Blocked Task", description: "d", acceptanceCriteria: [], priority: "high" });
    const id = (r.data as { taskId: string }).taskId;
    await taskUpdate(store, { taskId: id, state: "READY" });
    await taskUpdate(store, { taskId: id, state: "TODO" });
    await taskUpdate(store, { taskId: id, state: "IN_PROGRESS" });
    await taskUpdate(store, { taskId: id, state: "BLOCKED" });

    const result = await projectStatus(store);
    expect(result.message).toContain("ブロッカー");
    expect(result.message).toContain("Blocked Task");
    const data = result.data as { blockers: Array<{ id: string }> };
    expect(data.blockers).toHaveLength(1);
  });

  it("次に可能なセレモニー遷移を返す", async () => {
    const result = await projectStatus(store);
    const data = result.data as { nextCeremonies: string[] };
    expect(data.nextCeremonies).toContain("REFINEMENT");
    expect(data.nextCeremonies).toContain("PLANNING");
  });
});
