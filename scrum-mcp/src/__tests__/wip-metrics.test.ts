import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink } from "node:fs/promises";
import { StateStore } from "../state/store.js";
import { wipStatus } from "../tools/wip.js";
import { metricsReport } from "../tools/metrics.js";
import { taskCreate, taskUpdate } from "../tools/task.js";
import { sprintCreate } from "../tools/sprint.js";
import type { WipStatus, SprintMetrics } from "../types.js";

const TEST_FILE = "/tmp/scrum-test-wip-metrics.json";
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

describe("wip_status", () => {
  it("タスクなしで正常な WIP 状態を返す", async () => {
    const result = await wipStatus(store);
    expect(result.ok).toBe(true);
    const data = result.data as WipStatus;
    expect(data.inProgress).toBe(0);
    expect(data.inReview).toBe(0);
    expect(data.warning).toBeUndefined();
  });

  it("WIP 制限到達で警告を返す", async () => {
    // 2 タスクを IN_PROGRESS に（制限 = 2）
    for (let i = 0; i < 2; i++) {
      const r = await taskCreate(store, {
        title: `Task ${i}`,
        description: "desc",
        acceptanceCriteria: [],
        priority: "medium",
      });
      const taskId = (r.data as { taskId: string }).taskId;
      await taskUpdate(store, { taskId, state: "READY" });
      await taskUpdate(store, { taskId, state: "TODO" });
      await taskUpdate(store, { taskId, state: "IN_PROGRESS" });
    }

    const result = await wipStatus(store);
    const data = result.data as WipStatus;
    expect(data.warning).toContain("制限到達");
  });

  it("WIP 制限超過で警告を返す", async () => {
    // 3 タスクを IN_PROGRESS に（制限 = 2）
    for (let i = 0; i < 3; i++) {
      const r = await taskCreate(store, {
        title: `Task ${i}`,
        description: "desc",
        acceptanceCriteria: [],
        priority: "medium",
      });
      const taskId = (r.data as { taskId: string }).taskId;
      await taskUpdate(store, { taskId, state: "READY" });
      await taskUpdate(store, { taskId, state: "TODO" });
      await taskUpdate(store, { taskId, state: "IN_PROGRESS" });
    }

    const result = await wipStatus(store);
    const data = result.data as WipStatus;
    expect(data.warning).toContain("制限超過");
  });

  it("制限内なら警告なし", async () => {
    const r = await taskCreate(store, {
      title: "Task 1",
      description: "desc",
      acceptanceCriteria: [],
      priority: "medium",
    });
    const taskId = (r.data as { taskId: string }).taskId;
    await taskUpdate(store, { taskId, state: "READY" });
    await taskUpdate(store, { taskId, state: "TODO" });
    await taskUpdate(store, { taskId, state: "IN_PROGRESS" });

    const result = await wipStatus(store);
    const data = result.data as WipStatus;
    expect(data.warning).toBeUndefined();
  });
});

describe("metrics_report", () => {
  it("現在のスプリントのメトリクスを取得できる", async () => {
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

    const result = await metricsReport(store, {});
    expect(result.ok).toBe(true);
    const data = result.data as SprintMetrics;
    expect(data.sprintId).toBe("sprint-1");
    expect(data.totalTasks).toBe(2);
  });

  it("完了タスクの割合が正しい", async () => {
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
        {
          title: "Task 3",
          description: "desc",
          acceptanceCriteria: [],
          priority: "low",
        },
      ],
    });

    const state = store.getState();
    const taskIds = state.currentSprint!.tasks;

    // 2 タスクを DONE に
    for (const id of taskIds.slice(0, 2)) {
      await taskUpdate(store, { taskId: id, state: "IN_PROGRESS" });
      await taskUpdate(store, { taskId: id, state: "IN_REVIEW" });
      await taskUpdate(store, { taskId: id, state: "DONE" });
    }

    const result = await metricsReport(store, {});
    const data = result.data as SprintMetrics;
    expect(data.completionRate).toBe(67);
    expect(data.completedTasks).toBe(2);
  });

  it("スプリントがない場合はエラー", async () => {
    const result = await metricsReport(store, {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("スプリントがありません");
  });
});
