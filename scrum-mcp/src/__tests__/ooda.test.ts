import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink } from "node:fs/promises";
import { StateStore } from "../state/store.js";
import { oodaObserve, oodaOrient, oodaDecide, oodaLog } from "../tools/ooda.js";
import { taskCreate, taskUpdate } from "../tools/task.js";
import { sprintCreate } from "../tools/sprint.js";

const TEST_FILE = "/tmp/scrum-test-ooda.json";
let store: StateStore;

async function setupActiveSprint(taskCount = 3): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < taskCount; i++) {
    await taskCreate(store, {
      title: `task-${i}`, description: "d", acceptanceCriteria: ["ac"], priority: "high", points: 5,
    });
    const taskId = Object.keys(store.peek().tasks).find((id) => !ids.includes(id))!;
    ids.push(taskId);
    await store.update((s) => { s.tasks[taskId].state = "READY"; });
  }
  await sprintCreate(store, { goal: "OODA test", taskIds: ids, autoActivate: true });
  return ids;
}

beforeEach(async () => {
  store = await StateStore.init(TEST_FILE);
});

afterEach(async () => {
  try { await unlink(TEST_FILE); } catch { /* ignore */ }
});

describe("ooda_observe", () => {
  it("スプリントなしではエラー", async () => {
    const result = await oodaObserve(store);
    expect(result.ok).toBe(false);
  });

  it("アクティブスプリントの進捗を返す", async () => {
    const ids = await setupActiveSprint(3);
    // 1つ DONE にする
    await taskUpdate(store, { taskId: ids[0], state: "IN_PROGRESS", assignee: "dev" });
    await taskUpdate(store, { taskId: ids[0], state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: ids[0], state: "DONE" });

    const result = await oodaObserve(store);
    expect(result.ok).toBe(true);
    expect(result.data!.sprintProgress).toBe(33); // 1/3
    expect(result.data!.blockers).toHaveLength(0);
  });

  it("ブロッカーを検出する", async () => {
    const ids = await setupActiveSprint(2);
    await taskUpdate(store, { taskId: ids[0], state: "IN_PROGRESS", assignee: "dev" });
    await taskUpdate(store, { taskId: ids[0], state: "BLOCKED" });

    const result = await oodaObserve(store);
    expect(result.ok).toBe(true);
    expect(result.data!.blockers).toContain(ids[0]);
  });

  it("WIP 状態を返す", async () => {
    const ids = await setupActiveSprint(3);
    await taskUpdate(store, { taskId: ids[0], state: "IN_PROGRESS", assignee: "dev1" });
    await taskUpdate(store, { taskId: ids[1], state: "IN_PROGRESS", assignee: "dev2" });

    const result = await oodaObserve(store);
    expect(result.data!.wipStatus.inProgress).toBe(2);
    expect(result.data!.wipStatus.inReview).toBe(0);
  });
});

describe("ooda_orient", () => {
  it("スプリントなしではエラー", async () => {
    const result = await oodaOrient(store);
    expect(result.ok).toBe(false);
  });

  it("WIP ボトルネックを検出する", async () => {
    const ids = await setupActiveSprint(3);
    // WIP limit = 2, 2つを IN_PROGRESS に
    await taskUpdate(store, { taskId: ids[0], state: "IN_PROGRESS", assignee: "dev1" });
    await taskUpdate(store, { taskId: ids[1], state: "IN_PROGRESS", assignee: "dev2" });

    const result = await oodaOrient(store);
    expect(result.ok).toBe(true);
    expect(result.data!.signals.some((s) => s.type === "wip_bottleneck")).toBe(true);
  });

  it("ブロッカー蓄積を検出する", async () => {
    const ids = await setupActiveSprint(2);
    await taskUpdate(store, { taskId: ids[0], state: "IN_PROGRESS", assignee: "dev" });
    await taskUpdate(store, { taskId: ids[0], state: "BLOCKED" });
    await taskUpdate(store, { taskId: ids[1], state: "IN_PROGRESS", assignee: "dev" });
    await taskUpdate(store, { taskId: ids[1], state: "BLOCKED" });

    const result = await oodaOrient(store);
    expect(result.ok).toBe(true);
    const blockerSignal = result.data!.signals.find((s) => s.type === "blocker_accumulation");
    expect(blockerSignal).toBeDefined();
    expect(blockerSignal!.severity).toBe("critical"); // 100% blocked
  });

  it("全タスク完了シグナルを検出する", async () => {
    const ids = await setupActiveSprint(2);
    for (const id of ids) {
      await taskUpdate(store, { taskId: id, state: "IN_PROGRESS", assignee: "dev" });
      await taskUpdate(store, { taskId: id, state: "IN_REVIEW" });
      await taskUpdate(store, { taskId: id, state: "DONE" });
    }

    const result = await oodaOrient(store);
    expect(result.data!.signals.some((s) => s.type === "sprint_completable")).toBe(true);
    expect(result.data!.patterns).toContain("all_tasks_complete");
  });

  it("アイドル容量を検出する", async () => {
    await setupActiveSprint(2); // All TODO, nothing in progress

    const result = await oodaOrient(store);
    expect(result.data!.signals.some((s) => s.type === "idle_capacity")).toBe(true);
    expect(result.data!.patterns).toContain("idle_capacity");
  });
});

describe("ooda_decide", () => {
  it("スプリントなしではエラー", async () => {
    const result = await oodaDecide(store);
    expect(result.ok).toBe(false);
  });

  it("ブロッカーに対して resolve_blockers を推奨する", async () => {
    const ids = await setupActiveSprint(2);
    await taskUpdate(store, { taskId: ids[0], state: "IN_PROGRESS", assignee: "dev" });
    await taskUpdate(store, { taskId: ids[0], state: "BLOCKED" });

    const result = await oodaDecide(store);
    expect(result.ok).toBe(true);
    expect(result.data!.recommendations.some((r) => r.action === "resolve_blockers")).toBe(true);
  });

  it("全完了時に sprint_complete を推奨する", async () => {
    const ids = await setupActiveSprint(1);
    await taskUpdate(store, { taskId: ids[0], state: "IN_PROGRESS", assignee: "dev" });
    await taskUpdate(store, { taskId: ids[0], state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: ids[0], state: "DONE" });

    const result = await oodaDecide(store);
    expect(result.data!.selected).toBe("sprint_complete");
  });

  it("アイドル時に start_next_task を推奨する", async () => {
    await setupActiveSprint(2);

    const result = await oodaDecide(store);
    expect(result.data!.recommendations.some((r) => r.action === "start_next_task")).toBe(true);
  });
});

describe("ooda_log", () => {
  it("スプリントなしではエラー", async () => {
    const result = await oodaLog(store, { action: "test", outcome: "success" });
    expect(result.ok).toBe(false);
  });

  it("OODA サイクルを記録する", async () => {
    await setupActiveSprint(1);
    const result = await oodaLog(store, {
      trigger: "manual",
      action: "resolve_blocker",
      outcome: "success",
    });
    expect(result.ok).toBe(true);
    expect(store.peek().oodaCycles).toHaveLength(1);
    expect(store.peek().oodaCycles[0].outcome).toBe("success");
  });

  it("タスク遷移を記録できる", async () => {
    const ids = await setupActiveSprint(1);
    await oodaLog(store, {
      trigger: "task_transition",
      action: "start_task",
      outcome: "success",
      taskTransition: { taskId: ids[0], from: "TODO", to: "IN_PROGRESS" },
    });

    const cycle = store.peek().oodaCycles[0];
    expect(cycle.observe.recentTransitions).toHaveLength(1);
    expect(cycle.observe.recentTransitions[0].taskId).toBe(ids[0]);
  });

  it("100 件を超えると古いサイクルが削除される", async () => {
    await setupActiveSprint(1);
    for (let i = 0; i < 105; i++) {
      await oodaLog(store, { action: `action-${i}`, outcome: "success" });
    }
    expect(store.peek().oodaCycles).toHaveLength(100);
  });
});
