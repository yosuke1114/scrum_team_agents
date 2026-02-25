import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink } from "node:fs/promises";
import { StateStore } from "../state/store.js";
import { wipStatus } from "../tools/wip.js";
import { metricsReport } from "../tools/metrics.js";
import { velocityReport } from "../tools/velocity.js";
import { taskCreate, taskUpdate } from "../tools/task.js";
import { sprintCreate, sprintComplete } from "../tools/sprint.js";
import type { WipStatus, SprintMetrics, VelocityData } from "../types.js";

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

async function createReadyTasks(
  count: number,
  opts?: { priority?: "high" | "medium" | "low"; points?: number }
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const r = await taskCreate(store, {
      title: `Task ${i}`,
      description: "desc",
      acceptanceCriteria: [],
      priority: opts?.priority ?? "medium",
      points: opts?.points,
    });
    const id = (r.data as { taskId: string }).taskId;
    await taskUpdate(store, { taskId: id, state: "READY" });
    ids.push(id);
  }
  return ids;
}

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
    for (let i = 0; i < 2; i++) {
      const r = await taskCreate(store, { title: `Task ${i}`, description: "desc", acceptanceCriteria: [], priority: "medium" });
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
    for (let i = 0; i < 3; i++) {
      const r = await taskCreate(store, { title: `Task ${i}`, description: "desc", acceptanceCriteria: [], priority: "medium" });
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
    const r = await taskCreate(store, { title: "Task 1", description: "desc", acceptanceCriteria: [], priority: "medium" });
    const taskId = (r.data as { taskId: string }).taskId;
    await taskUpdate(store, { taskId, state: "READY" });
    await taskUpdate(store, { taskId, state: "TODO" });
    await taskUpdate(store, { taskId, state: "IN_PROGRESS" });

    const result = await wipStatus(store);
    const data = result.data as WipStatus;
    expect(data.warning).toBeUndefined();
  });

  it("スプリントスコープで WIP をカウントする", async () => {
    // スプリント外タスク (IN_PROGRESS)
    const r1 = await taskCreate(store, { title: "Outside", description: "d", acceptanceCriteria: [], priority: "medium" });
    const outsideId = (r1.data as { taskId: string }).taskId;
    await taskUpdate(store, { taskId: outsideId, state: "READY" });
    await taskUpdate(store, { taskId: outsideId, state: "TODO" });
    await taskUpdate(store, { taskId: outsideId, state: "IN_PROGRESS" });

    // スプリント内タスク
    const ids = await createReadyTasks(1);
    await sprintCreate(store, { goal: "Sprint 1", taskIds: ids });
    await store.update((s) => {
      if (s.currentSprint) {
        s.currentSprint.state = "ACTIVE";
        s.currentSprint.startedAt = new Date().toISOString();
      }
    });
    await taskUpdate(store, { taskId: ids[0], state: "IN_PROGRESS" });

    // スプリントスコープなので outsideId はカウントされない
    const result = await wipStatus(store);
    const data = result.data as WipStatus;
    expect(data.inProgress).toBe(1);
  });
});

describe("metrics_report", () => {
  it("現在のスプリントのメトリクスを取得できる", async () => {
    const ids = await createReadyTasks(2);
    await sprintCreate(store, { goal: "Sprint 1", taskIds: ids });

    const result = await metricsReport(store, {});
    expect(result.ok).toBe(true);
    const data = result.data as SprintMetrics;
    expect(data.sprintId).toBe("sprint-1");
    expect(data.totalTasks).toBe(2);
  });

  it("完了タスクの割合が正しい", async () => {
    const ids = await createReadyTasks(3);
    await sprintCreate(store, { goal: "Sprint 1", taskIds: ids });

    for (const id of ids.slice(0, 2)) {
      await taskUpdate(store, { taskId: id, state: "IN_PROGRESS" });
      await taskUpdate(store, { taskId: id, state: "IN_REVIEW" });
      await taskUpdate(store, { taskId: id, state: "DONE" });
    }

    const result = await metricsReport(store, {});
    const data = result.data as SprintMetrics;
    expect(data.completionRate).toBe(67);
    expect(data.completedTasks).toBe(2);
  });

  it("ストーリーポイントが正しい", async () => {
    const ids = await createReadyTasks(2, { points: 3 });
    await sprintCreate(store, { goal: "Sprint 1", taskIds: ids });

    await taskUpdate(store, { taskId: ids[0], state: "IN_PROGRESS" });
    await taskUpdate(store, { taskId: ids[0], state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: ids[0], state: "DONE" });

    const result = await metricsReport(store, {});
    const data = result.data as SprintMetrics;
    expect(data.totalPoints).toBe(6);
    expect(data.completedPoints).toBe(3);
  });

  it("スプリントがない場合はエラー", async () => {
    const result = await metricsReport(store, {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("スプリントがありません");
  });
});

describe("velocity_report", () => {
  it("完了スプリントがない場合はエラー", async () => {
    const result = await velocityReport(store, {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("完了したスプリント");
  });

  it("ベロシティレポートを生成できる", async () => {
    // Sprint 1: 2 tasks x 3pt, both done
    const ids1 = await createReadyTasks(2, { points: 3 });
    await sprintCreate(store, { goal: "Sprint 1", taskIds: ids1 });
    await store.update((s) => {
      if (s.currentSprint) {
        s.currentSprint.state = "ACTIVE";
        s.currentSprint.startedAt = new Date().toISOString();
      }
    });
    for (const id of ids1) {
      await taskUpdate(store, { taskId: id, state: "IN_PROGRESS" });
      await taskUpdate(store, { taskId: id, state: "IN_REVIEW" });
      await taskUpdate(store, { taskId: id, state: "DONE" });
    }
    await sprintComplete(store, { sprintId: "sprint-1" });

    const result = await velocityReport(store, {});
    expect(result.ok).toBe(true);
    const data = result.data as VelocityData;
    expect(data.sprints).toHaveLength(1);
    expect(data.sprints[0].completedPoints).toBe(6);
    expect(data.averageVelocity).toBe(6);
    expect(data.averageCompletionRate).toBe(100);
  });

  it("lastN でスプリント数を制限できる", async () => {
    // 2 sprints completed
    for (let s = 1; s <= 2; s++) {
      const ids = await createReadyTasks(1, { points: 5 });
      await sprintCreate(store, { goal: `Sprint ${s}`, taskIds: ids });
      await store.update((st) => {
        if (st.currentSprint) {
          st.currentSprint.state = "ACTIVE";
          st.currentSprint.startedAt = new Date().toISOString();
        }
      });
      await taskUpdate(store, { taskId: ids[0], state: "IN_PROGRESS" });
      await taskUpdate(store, { taskId: ids[0], state: "IN_REVIEW" });
      await taskUpdate(store, { taskId: ids[0], state: "DONE" });
      await sprintComplete(store, { sprintId: `sprint-${s}` });
    }

    const result = await velocityReport(store, { lastN: 1 });
    const data = result.data as VelocityData;
    expect(data.sprints).toHaveLength(1);
    expect(data.sprints[0].id).toBe("sprint-2");
  });
});
