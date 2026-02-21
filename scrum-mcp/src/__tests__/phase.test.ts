import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink } from "node:fs/promises";
import { StateStore } from "../state/store.js";
import { setPhase, phaseStatus, phaseAdvance } from "../tools/phase.js";
import { taskCreate } from "../tools/task.js";
import { sprintCreate } from "../tools/sprint.js";

const TEST_FILE = "/tmp/scrum-test-phase.json";
let store: StateStore;

beforeEach(async () => {
  store = await StateStore.init(TEST_FILE);
});

afterEach(async () => {
  try { await unlink(TEST_FILE); } catch { /* ignore */ }
});

describe("setPhase", () => {
  it("phase と phaseEnteredAt を更新する", async () => {
    await store.update((s) => {
      setPhase(s, "EXECUTE");
    });
    const s = store.peek();
    expect(s.phase).toBe("EXECUTE");
    expect(s.phaseEnteredAt).toBeDefined();
  });

  it("ceremonyState をフェーズに対応する最初の状態に同期する", async () => {
    await store.update((s) => setPhase(s, "EXECUTE"));
    expect(store.peek().ceremonyState).toBe("SPRINT_ACTIVE");

    await store.update((s) => setPhase(s, "EVALUATE"));
    expect(store.peek().ceremonyState).toBe("SPRINT_REVIEW");

    await store.update((s) => setPhase(s, "LEARN"));
    expect(store.peek().ceremonyState).toBe("RETROSPECTIVE");

    await store.update((s) => setPhase(s, "PLAN"));
    expect(store.peek().ceremonyState).toBe("IDLE");
  });

  it("currentCeremony を null にクリアする", async () => {
    await store.update((s) => { s.currentCeremony = "sprint"; });
    await store.update((s) => setPhase(s, "EVALUATE"));
    expect(store.peek().currentCeremony).toBeNull();
  });
});

describe("phase_status", () => {
  it("初期状態で PLAN フェーズを返す", async () => {
    const result = await phaseStatus(store);
    expect(result.ok).toBe(true);
    expect(result.data!.phase).toBe("PLAN");
    expect(result.data!.sprint).toBeNull();
    expect(result.data!.oodaCycleCount).toBe(0);
    expect(result.data!.reflectionCount).toBe(0);
    expect(result.data!.knowledgeCount).toBe(0);
  });

  it("READY タスクがある場合に推奨を含む", async () => {
    await taskCreate(store, {
      title: "t1", description: "d", acceptanceCriteria: ["ac"], priority: "high",
    });
    const taskId = Object.keys(store.peek().tasks)[0];
    await store.update((s) => { s.tasks[taskId].state = "READY"; });

    const result = await phaseStatus(store);
    expect(result.ok).toBe(true);
    expect(result.data!.recommendations.some((r) => r.includes("READY"))).toBe(true);
  });

  it("EXECUTE フェーズでスプリント情報を返す", async () => {
    await taskCreate(store, {
      title: "t1", description: "d", acceptanceCriteria: ["ac"], priority: "high",
    });
    const taskId = Object.keys(store.peek().tasks)[0];
    await store.update((s) => { s.tasks[taskId].state = "READY"; });
    await sprintCreate(store, { goal: "g1", taskIds: [taskId], autoActivate: true });

    const result = await phaseStatus(store);
    expect(result.ok).toBe(true);
    expect(result.data!.phase).toBe("EXECUTE");
    expect(result.data!.sprint).not.toBeNull();
    expect(result.data!.sprint!.state).toBe("ACTIVE");
  });
});

describe("phase_advance", () => {
  it("PLAN → EXECUTE: スプリントなしでは拒否", async () => {
    const result = await phaseAdvance(store, {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("sprint_create");
  });

  it("PLAN → EXECUTE: スプリントありで遷移し自動 ACTIVE 化", async () => {
    await taskCreate(store, {
      title: "t1", description: "d", acceptanceCriteria: ["ac"], priority: "high",
    });
    const taskId = Object.keys(store.peek().tasks)[0];
    await store.update((s) => { s.tasks[taskId].state = "READY"; });
    await sprintCreate(store, { goal: "g1", taskIds: [taskId] });

    const result = await phaseAdvance(store, {});
    expect(result.ok).toBe(true);
    expect(store.peek().phase).toBe("EXECUTE");
    expect(store.peek().currentSprint!.state).toBe("ACTIVE");
  });

  it("EXECUTE → EVALUATE: ACTIVE スプリントなら force=true が必要", async () => {
    await taskCreate(store, {
      title: "t1", description: "d", acceptanceCriteria: ["ac"], priority: "high",
    });
    const taskId = Object.keys(store.peek().tasks)[0];
    await store.update((s) => { s.tasks[taskId].state = "READY"; });
    await sprintCreate(store, { goal: "g1", taskIds: [taskId], autoActivate: true });

    // Without force → rejected
    const r1 = await phaseAdvance(store, {});
    expect(r1.ok).toBe(false);

    // With force → accepted
    const r2 = await phaseAdvance(store, { force: true });
    expect(r2.ok).toBe(true);
    expect(store.peek().phase).toBe("EVALUATE");
  });

  it("EVALUATE → LEARN → PLAN の遷移", async () => {
    await store.update((s) => setPhase(s, "EVALUATE"));
    const r1 = await phaseAdvance(store, {});
    expect(r1.ok).toBe(true);
    expect(store.peek().phase).toBe("LEARN");

    const r2 = await phaseAdvance(store, {});
    expect(r2.ok).toBe(true);
    expect(store.peek().phase).toBe("PLAN");
  });
});
