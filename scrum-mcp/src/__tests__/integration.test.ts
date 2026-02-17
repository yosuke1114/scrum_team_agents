import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink } from "node:fs/promises";
import { StateStore } from "../state/store.js";
import { ceremonyStart, ceremonyEnd } from "../tools/ceremony.js";
import { sprintCreate, sprintComplete } from "../tools/sprint.js";
import { taskCreate, taskUpdate } from "../tools/task.js";
import { metricsReport } from "../tools/metrics.js";
import { wipStatus } from "../tools/wip.js";
import type { WipStatus, SprintMetrics } from "../types.js";

const TEST_FILE = "/tmp/scrum-test-integration.json";
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

describe("integration", () => {
  it("フルスプリントサイクル", async () => {
    // 1. Refinement
    await ceremonyStart(store, { type: "refinement" });
    expect(store.peek().ceremonyState).toBe("REFINEMENT");

    // タスク作成
    const t1 = await taskCreate(store, {
      title: "認証機能",
      description: "ログイン実装",
      acceptanceCriteria: ["メール認証"],
      priority: "high",
    });
    const t1Id = (t1.data as { taskId: string }).taskId;

    const t2 = await taskCreate(store, {
      title: "ダッシュボード",
      description: "メイン画面",
      acceptanceCriteria: ["グラフ表示"],
      priority: "medium",
    });
    const t2Id = (t2.data as { taskId: string }).taskId;

    // READY に遷移
    await taskUpdate(store, { taskId: t1Id, state: "READY" });
    await taskUpdate(store, { taskId: t2Id, state: "READY" });

    await ceremonyEnd(store, { type: "refinement" });
    expect(store.peek().ceremonyState).toBe("IDLE");

    // 2. Planning
    await ceremonyStart(store, { type: "planning" });

    await sprintCreate(store, {
      goal: "MVP",
      tasks: [
        {
          title: "認証機能",
          description: "ログイン実装",
          acceptanceCriteria: ["メール認証"],
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

    await ceremonyEnd(store, { type: "planning" });

    // 3. Sprint
    await ceremonyStart(store, { type: "sprint" });
    expect(store.peek().ceremonyState).toBe("SPRINT_ACTIVE");
    expect(store.peek().currentSprint!.state).toBe("ACTIVE");
    expect(store.peek().currentSprint!.startedAt).not.toBeNull();

    // sprints[] の同期も検証
    const archivedSprintAfterStart = store.peek().sprints.find(
      (sp) => sp.id === "sprint-1"
    );
    expect(archivedSprintAfterStart!.state).toBe("ACTIVE");
    expect(archivedSprintAfterStart!.startedAt).not.toBeNull();

    // タスク作業
    const sprintTaskIds = store.peek().currentSprint!.tasks;
    const stId1 = sprintTaskIds[0];
    const stId2 = sprintTaskIds[1];

    await taskUpdate(store, {
      taskId: stId1,
      state: "IN_PROGRESS",
      assignee: "dev-1",
    });
    await taskUpdate(store, { taskId: stId1, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: stId1, state: "DONE" });

    await taskUpdate(store, {
      taskId: stId2,
      state: "IN_PROGRESS",
      assignee: "dev-2",
    });

    // WIP status
    const wipResult = await wipStatus(store);
    expect(wipResult.ok).toBe(true);

    // Metrics
    const metricsResult = await metricsReport(store, {});
    expect(metricsResult.ok).toBe(true);

    // 4. Review（sprint→review 暗黙遷移）
    await ceremonyStart(store, { type: "review" });
    expect(store.peek().ceremonyState).toBe("SPRINT_REVIEW");

    // Sprint complete
    await sprintComplete(store, { sprintId: "sprint-1" });
    expect(store.peek().currentSprint!.state).toBe("COMPLETED");

    await ceremonyEnd(store, { type: "review" });

    // 5. Retro
    await ceremonyStart(store, { type: "retro" });
    await ceremonyEnd(store, { type: "retro" });

    expect(store.peek().ceremonyState).toBe("IDLE");
    expect(store.peek().currentCeremony).toBeNull();
  });

  it("ブロッカー発生と復帰", async () => {
    const r = await taskCreate(store, {
      title: "Blocked Task",
      description: "desc",
      acceptanceCriteria: [],
      priority: "high",
    });
    const taskId = (r.data as { taskId: string }).taskId;

    // TODO → IN_PROGRESS → BLOCKED → IN_PROGRESS → IN_REVIEW → DONE
    await taskUpdate(store, { taskId, state: "READY" });
    await taskUpdate(store, { taskId, state: "TODO" });
    await taskUpdate(store, { taskId, state: "IN_PROGRESS" });
    await taskUpdate(store, { taskId, state: "BLOCKED" });
    expect(store.peek().tasks[taskId].state).toBe("BLOCKED");

    await taskUpdate(store, { taskId, state: "IN_PROGRESS" });
    expect(store.peek().tasks[taskId].state).toBe("IN_PROGRESS");

    await taskUpdate(store, { taskId, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId, state: "DONE" });
    expect(store.peek().tasks[taskId].state).toBe("DONE");
  });

  it("WIP 制限のソフト警告", async () => {
    // 3 タスクを作成
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

    // READY → TODO に
    for (const id of ids) {
      await taskUpdate(store, { taskId: id, state: "READY" });
      await taskUpdate(store, { taskId: id, state: "TODO" });
    }

    // 1つ目: 制限内→警告なし
    const r1 = await taskUpdate(store, {
      taskId: ids[0],
      state: "IN_PROGRESS",
    });
    expect(r1.ok).toBe(true);
    expect(r1.message).not.toContain("WIP制限警告");

    // 2つ目
    await taskUpdate(store, { taskId: ids[1], state: "IN_PROGRESS" });

    // 3つ目: 制限超過→警告
    const r3 = await taskUpdate(store, {
      taskId: ids[2],
      state: "IN_PROGRESS",
    });
    expect(r3.ok).toBe(true);
    expect(r3.message).toContain("WIP制限警告");

    // wipStatus で確認
    const wip = await wipStatus(store);
    const data = wip.data as WipStatus;
    expect(data.inProgress).toBe(3);
    expect(data.warning).toContain("制限超過");
  });
});
