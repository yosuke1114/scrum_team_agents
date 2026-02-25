import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink } from "node:fs/promises";
import { StateStore } from "../state/store.js";
import { qualityCheck } from "../tools/quality-gate.js";
import { taskCreate, taskUpdate } from "../tools/task.js";

const TEST_FILE = "/tmp/scrum-test-quality.json";
let store: StateStore;

beforeEach(async () => {
  store = await StateStore.init(TEST_FILE);
});

afterEach(async () => {
  try { await unlink(TEST_FILE); } catch { /* ignore */ }
});

describe("quality_check", () => {
  it("存在しないタスクではエラー", async () => {
    const result = await qualityCheck(store, { taskId: "nonexistent" });
    expect(result.ok).toBe(false);
  });

  it("完全なタスクで pass を返す", async () => {
    await taskCreate(store, {
      title: "完全タスク",
      description: "しっかりした説明",
      acceptanceCriteria: ["AC1", "AC2"],
      priority: "high",
      points: 5,
    });
    const taskId = Object.keys(store.peek().tasks)[0];

    const result = await qualityCheck(store, { taskId });
    expect(result.ok).toBe(true);
    expect(result.data!.verdict).toBe("pass");
    expect(result.data!.checks.every((c) => c.passed)).toBe(true);
  });

  it("受入条件なしで fail を返す", async () => {
    await taskCreate(store, {
      title: "不完全タスク",
      description: "",
      acceptanceCriteria: [],
      priority: "low",
    });
    const taskId = Object.keys(store.peek().tasks)[0];

    const result = await qualityCheck(store, { taskId });
    expect(result.data!.verdict).toBe("fail");
    // acceptance_criteria and description both fail
    const failedChecks = result.data!.checks.filter((c) => !c.passed);
    expect(failedChecks.length).toBeGreaterThanOrEqual(2);
  });

  it("見積もりなしで warn を返す", async () => {
    await taskCreate(store, {
      title: "見積もりなし",
      description: "説明あり",
      acceptanceCriteria: ["AC1"],
      priority: "medium",
      // no points
    });
    const taskId = Object.keys(store.peek().tasks)[0];

    const result = await qualityCheck(store, { taskId });
    // 1 failure (estimation) → warn
    expect(result.data!.verdict).toBe("warn");
  });

  it("作業中タスクで担当者チェックを行う", async () => {
    await taskCreate(store, {
      title: "担当なし作業中",
      description: "d",
      acceptanceCriteria: ["ac"],
      priority: "high",
      points: 3,
    });
    const taskId = Object.keys(store.peek().tasks)[0];
    await store.update((s) => { s.tasks[taskId].state = "READY"; });
    await store.update((s) => { s.tasks[taskId].state = "TODO"; });
    await store.update((s) => {
      s.tasks[taskId].state = "IN_PROGRESS";
      // assignee not set
    });

    const result = await qualityCheck(store, { taskId });
    const assigneeCheck = result.data!.checks.find((c) => c.name === "assignee");
    expect(assigneeCheck).toBeDefined();
    expect(assigneeCheck!.passed).toBe(false);
  });

  it("IN_REVIEW タスクでレビュー準備チェックを行う", async () => {
    await taskCreate(store, {
      title: "レビュー対象",
      description: "d",
      acceptanceCriteria: ["ac1", "ac2"],
      priority: "high",
      points: 5,
    });
    const taskId = Object.keys(store.peek().tasks)[0];
    await store.update((s) => {
      s.tasks[taskId].state = "IN_REVIEW";
      s.tasks[taskId].assignee = "dev";
    });

    const result = await qualityCheck(store, { taskId });
    const reviewCheck = result.data!.checks.find((c) => c.name === "review_readiness");
    expect(reviewCheck).toBeDefined();
    expect(reviewCheck!.passed).toBe(true);
  });
});
