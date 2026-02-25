import { randomUUID } from "node:crypto";
import type { StateStore } from "../state/store.js";
import type {
  ToolResult,
  OodaCycle,
  OodaObservation,
  OodaSignal,
  TaskState,
} from "../types.js";

// --- ooda_observe ---

export async function oodaObserve(
  store: StateStore
): Promise<ToolResult<OodaObservation>> {
  const s = store.peek();

  if (!s.currentSprint || s.currentSprint.state !== "ACTIVE") {
    return { ok: false, error: "アクティブなスプリントがありません。" };
  }

  const sp = s.currentSprint;
  const sprintTasks = sp.tasks.map((id) => s.tasks[id]).filter(Boolean);
  const done = sprintTasks.filter((t) => t.state === "DONE").length;
  const total = sprintTasks.length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  const inProgress = sprintTasks.filter((t) => t.state === "IN_PROGRESS").length;
  const inReview = sprintTasks.filter((t) => t.state === "IN_REVIEW").length;
  const blockers = sprintTasks
    .filter((t) => t.state === "BLOCKED")
    .map((t) => t.id);

  // Recent transitions from OODA cycles
  const recentTransitions = s.oodaCycles
    .slice(-5)
    .flatMap((c) => c.observe.recentTransitions);

  const observation: OodaObservation = {
    sprintProgress: progress,
    wipStatus: { inProgress, inReview },
    blockers,
    recentTransitions,
    timestamp: new Date().toISOString(),
  };

  const lines = [
    `👁 OODA Observe: ${sp.id}`,
    `  進捗: ${progress}% (${done}/${total})`,
    `  WIP: IN_PROGRESS=${inProgress} IN_REVIEW=${inReview}`,
    blockers.length > 0 ? `  🚫 ブロッカー: ${blockers.join(", ")}` : "  ブロッカー: なし",
  ];

  return { ok: true, message: lines.join("\n"), data: observation };
}

// --- ooda_orient ---

export interface OrientResult {
  signals: OodaSignal[];
  patterns: string[];
}

export async function oodaOrient(
  store: StateStore
): Promise<ToolResult<OrientResult>> {
  const s = store.peek();

  if (!s.currentSprint || s.currentSprint.state !== "ACTIVE") {
    return { ok: false, error: "アクティブなスプリントがありません。" };
  }

  const sp = s.currentSprint;
  const sprintTasks = sp.tasks.map((id) => s.tasks[id]).filter(Boolean);
  const signals: OodaSignal[] = [];
  const patterns: string[] = [];

  // Signal: WIP bottleneck
  const inProgress = sprintTasks.filter((t) => t.state === "IN_PROGRESS").length;
  const inReview = sprintTasks.filter((t) => t.state === "IN_REVIEW").length;

  if (inProgress >= s.wipLimits.inProgress) {
    signals.push({
      type: "wip_bottleneck",
      severity: inProgress > s.wipLimits.inProgress ? "critical" : "warn",
      detail: `IN_PROGRESS ${inProgress}/${s.wipLimits.inProgress} (制限${inProgress > s.wipLimits.inProgress ? "超過" : "到達"})`,
    });
  }
  if (inReview >= s.wipLimits.inReview) {
    signals.push({
      type: "review_bottleneck",
      severity: inReview > s.wipLimits.inReview ? "critical" : "warn",
      detail: `IN_REVIEW ${inReview}/${s.wipLimits.inReview}`,
    });
  }

  // Signal: Blockers
  const blockedTasks = sprintTasks.filter((t) => t.state === "BLOCKED");
  if (blockedTasks.length > 0) {
    const ratio = blockedTasks.length / sprintTasks.length;
    signals.push({
      type: "blocker_accumulation",
      severity: ratio > 0.5 ? "critical" : "warn",
      detail: `${blockedTasks.length}/${sprintTasks.length} タスクがブロック中 (${Math.round(ratio * 100)}%)`,
    });
    patterns.push("blocker_accumulation");
  }

  // Signal: All work complete
  const done = sprintTasks.filter((t) => t.state === "DONE").length;
  if (done === sprintTasks.length && sprintTasks.length > 0) {
    signals.push({
      type: "sprint_completable",
      severity: "info",
      detail: "全タスク完了 → sprint_complete 可能",
    });
    patterns.push("all_tasks_complete");
  }

  // Signal: No work in progress
  const todo = sprintTasks.filter((t) => t.state === "TODO").length;
  if (inProgress === 0 && inReview === 0 && todo > 0) {
    signals.push({
      type: "idle_capacity",
      severity: "info",
      detail: `TODO ${todo} 件あるが作業中なし → タスクを開始してください`,
    });
    patterns.push("idle_capacity");
  }

  // Pattern: Velocity deviation (compare with average)
  const completedSprints = s.sprints.filter((sp) => sp.state === "COMPLETED" && sp.metrics);
  if (completedSprints.length >= 3) {
    const avgCompletionRate = completedSprints
      .slice(-5)
      .reduce((sum, sp) => sum + (sp.metrics?.completionRate ?? 0), 0) / Math.min(completedSprints.length, 5);
    const currentProgress = sprintTasks.length > 0 ? (done / sprintTasks.length) * 100 : 0;
    if (currentProgress < avgCompletionRate * 0.5 && sprintTasks.length > 0) {
      signals.push({
        type: "velocity_deviation",
        severity: "warn",
        detail: `現在完了率 ${Math.round(currentProgress)}% は平均 ${Math.round(avgCompletionRate)}% を大幅に下回っています`,
      });
      patterns.push("low_velocity");
    }
  }

  const result: OrientResult = { signals, patterns };

  const lines = [
    `🧭 OODA Orient: ${signals.length} シグナル, ${patterns.length} パターン`,
    ...signals.map((sig) => {
      const icon = sig.severity === "critical" ? "🔴" : sig.severity === "warn" ? "🟡" : "🟢";
      return `  ${icon} [${sig.type}] ${sig.detail}`;
    }),
    patterns.length > 0 ? `  パターン: ${patterns.join(", ")}` : "",
  ].filter(Boolean);

  return { ok: true, message: lines.join("\n"), data: result };
}

// --- ooda_decide ---

export interface DecideResult {
  recommendations: Array<{ action: string; priority: number; rationale: string }>;
  selected: string | null;
}

export async function oodaDecide(
  store: StateStore
): Promise<ToolResult<DecideResult>> {
  const s = store.peek();

  if (!s.currentSprint || s.currentSprint.state !== "ACTIVE") {
    return { ok: false, error: "アクティブなスプリントがありません。" };
  }

  // Run orient internally to get signals
  const orientResult = await oodaOrient(store);
  if (!orientResult.ok || !orientResult.data) {
    return { ok: false, error: orientResult.error ?? "Orient failed" };
  }

  const { signals, patterns } = orientResult.data;
  const recommendations: Array<{ action: string; priority: number; rationale: string }> = [];

  for (const sig of signals) {
    switch (sig.type) {
      case "blocker_accumulation":
        recommendations.push({
          action: "resolve_blockers",
          priority: sig.severity === "critical" ? 1 : 2,
          rationale: sig.detail,
        });
        if (sig.severity === "critical") {
          recommendations.push({
            action: "consider_sprint_cancel",
            priority: 3,
            rationale: "ブロッカーが多すぎる場合、スプリント中止を検討",
          });
        }
        break;
      case "wip_bottleneck":
        recommendations.push({
          action: "complete_in_progress_first",
          priority: 2,
          rationale: sig.detail,
        });
        break;
      case "review_bottleneck":
        recommendations.push({
          action: "prioritize_reviews",
          priority: 1,
          rationale: sig.detail,
        });
        break;
      case "sprint_completable":
        recommendations.push({
          action: "sprint_complete",
          priority: 1,
          rationale: "全タスク完了 → スプリント完了可能",
        });
        break;
      case "idle_capacity":
        recommendations.push({
          action: "start_next_task",
          priority: 2,
          rationale: sig.detail,
        });
        break;
      case "velocity_deviation":
        recommendations.push({
          action: "scope_reduction",
          priority: 2,
          rationale: sig.detail,
        });
        break;
    }
  }

  // Sort by priority
  recommendations.sort((a, b) => a.priority - b.priority);

  const selected = recommendations.length > 0 ? recommendations[0].action : null;
  const result: DecideResult = { recommendations, selected };

  const lines = [
    `🎯 OODA Decide: ${recommendations.length} 推奨アクション`,
    ...recommendations.map((r, i) =>
      `  ${i === 0 ? "→" : " "} [P${r.priority}] ${r.action}: ${r.rationale}`
    ),
    selected ? `  選択: ${selected}` : "  推奨アクションなし",
  ];

  return { ok: true, message: lines.join("\n"), data: result };
}

// --- ooda_log ---

export interface OodaLogInput {
  trigger?: OodaCycle["trigger"];
  action: string;
  outcome: "success" | "partial" | "failed";
  taskTransition?: { taskId: string; from: TaskState; to: TaskState };
}

export async function oodaLog(
  store: StateStore,
  input: OodaLogInput
): Promise<ToolResult> {
  const s = store.peek();

  if (!s.currentSprint) {
    return { ok: false, error: "アクティブなスプリントがありません。" };
  }

  // Build a lightweight observe snapshot
  const sp = s.currentSprint;
  const sprintTasks = sp.tasks.map((id) => s.tasks[id]).filter(Boolean);
  const done = sprintTasks.filter((t) => t.state === "DONE").length;
  const inProgress = sprintTasks.filter((t) => t.state === "IN_PROGRESS").length;
  const inReview = sprintTasks.filter((t) => t.state === "IN_REVIEW").length;
  const blockers = sprintTasks.filter((t) => t.state === "BLOCKED").map((t) => t.id);

  const transitions = input.taskTransition
    ? [{ ...input.taskTransition, at: new Date().toISOString() }]
    : [];

  const cycle: OodaCycle = {
    id: `ooda-${randomUUID().slice(0, 8)}`,
    sprintId: sp.id,
    trigger: input.trigger ?? "manual",
    observe: {
      sprintProgress: sprintTasks.length > 0 ? Math.round((done / sprintTasks.length) * 100) : 0,
      wipStatus: { inProgress, inReview },
      blockers,
      recentTransitions: transitions,
      timestamp: new Date().toISOString(),
    },
    orient: { signals: [], patterns: [] },
    decide: { recommendations: [{ action: input.action, priority: 1, rationale: "logged" }], selected: input.action },
    outcome: input.outcome,
    createdAt: new Date().toISOString(),
  };

  await store.update((s) => {
    s.oodaCycles.push(cycle);
    // Keep max 100 cycles to prevent unbounded growth
    if (s.oodaCycles.length > 100) {
      s.oodaCycles = s.oodaCycles.slice(-100);
    }
  });

  return {
    ok: true,
    message: `OODA サイクル記録: ${cycle.id} [${input.outcome}] ${input.action}`,
    data: { cycleId: cycle.id },
  };
}
