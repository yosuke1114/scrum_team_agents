import type { StateStore } from "../state/store.js";
import type {
  ToolResult,
  Phase,
  CeremonyState,
  ScrumState,
} from "../types.js";
import { VALID_TRANSITIONS, PHASE_CEREMONY_MAP } from "../types.js";

export interface PhaseStatusData {
  phase: Phase;
  phaseEnteredAt: string;
  ceremonyState: CeremonyState;
  currentCeremony: string | null;
  sprint: { id: string; state: string; goal: string; progress: number } | null;
  recommendations: string[];
  oodaCycleCount: number;
  reflectionCount: number;
  knowledgeCount: number;
}

/** Set phase and sync legacy ceremonyState */
export function setPhase(s: ScrumState, phase: Phase): void {
  s.phase = phase;
  s.phaseEnteredAt = new Date().toISOString();
  // Sync legacy ceremonyState to first state in phase mapping
  const mapped = PHASE_CEREMONY_MAP[phase];
  if (mapped && mapped.length > 0) {
    s.ceremonyState = mapped[0];
  }
  s.currentCeremony = null;
}

export async function phaseStatus(
  store: StateStore
): Promise<ToolResult<PhaseStatusData>> {
  const s = store.peek();

  let sprintInfo: PhaseStatusData["sprint"] = null;
  if (s.currentSprint) {
    const sp = s.currentSprint;
    const sprintTasks = sp.tasks.map((id) => s.tasks[id]).filter(Boolean);
    const done = sprintTasks.filter((t) => t.state === "DONE").length;
    const total = sprintTasks.length;
    sprintInfo = {
      id: sp.id,
      state: sp.state,
      goal: sp.goal,
      progress: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  }

  const recommendations: string[] = [];
  switch (s.phase) {
    case "PLAN": {
      const ready = Object.values(s.tasks).filter((t) => t.state === "READY").length;
      if (ready > 0) {
        recommendations.push(`READY タスクが ${ready} 件あります → sprint_create で EXECUTE フェーズに進めます`);
      } else {
        recommendations.push("バックログタスクを READY にしてください → task_create + task_update");
      }
      break;
    }
    case "EXECUTE": {
      const blockers = Object.values(s.tasks).filter((t) => t.state === "BLOCKED");
      if (blockers.length > 0) {
        recommendations.push(`ブロッカー ${blockers.length} 件: ${blockers.map((b) => b.id).join(", ")}`);
      }
      if (sprintInfo) {
        if (sprintInfo.progress === 100) {
          recommendations.push("全タスク完了 → sprint_complete で EVALUATE に進めます");
        } else {
          recommendations.push(`進捗 ${sprintInfo.progress}% → タスクの実装を続けてください`);
        }
      }
      break;
    }
    case "EVALUATE":
      recommendations.push("スプリント評価が完了しました → reflect で振り返りを記録してください");
      break;
    case "LEARN":
      recommendations.push("振り返りを実施 → knowledge_update で学びを記録し、次のスプリントへ");
      break;
  }

  const data: PhaseStatusData = {
    phase: s.phase,
    phaseEnteredAt: s.phaseEnteredAt,
    ceremonyState: s.ceremonyState,
    currentCeremony: s.currentCeremony,
    sprint: sprintInfo,
    recommendations,
    oodaCycleCount: s.oodaCycles.length,
    reflectionCount: s.reflections.length,
    knowledgeCount: s.knowledge.length,
  };

  const lines = [
    `🔄 フェーズ: ${s.phase}`,
    `🏃 スプリント: ${sprintInfo ? `${sprintInfo.id} [${sprintInfo.state}] ${sprintInfo.progress}%` : "なし"}`,
    `📊 OODA: ${s.oodaCycles.length}回 | 振返り: ${s.reflections.length}件 | 知識: ${s.knowledge.length}件`,
    "",
    "💡 推奨アクション:",
    ...recommendations.map((r) => `  → ${r}`),
  ];

  return {
    ok: true,
    message: lines.join("\n"),
    data,
  };
}

export async function phaseAdvance(
  store: StateStore,
  input: { force?: boolean }
): Promise<ToolResult> {
  const s = store.peek();
  const current = s.phase;

  const transitions: Record<Phase, Phase> = {
    PLAN: "EXECUTE",
    EXECUTE: "EVALUATE",
    EVALUATE: "LEARN",
    LEARN: "PLAN",
  };
  const next = transitions[current];

  // Guard: PLAN→EXECUTE requires active sprint
  if (current === "PLAN" && next === "EXECUTE") {
    if (!s.currentSprint) {
      return { ok: false, error: "スプリントが作成されていません。sprint_create を先に実行してください。" };
    }
    if (s.currentSprint.state !== "PLANNING" && s.currentSprint.state !== "ACTIVE") {
      return { ok: false, error: `スプリントが ${s.currentSprint.state} 状態です。新しいスプリントを作成してください。` };
    }
  }

  // Guard: EXECUTE→EVALUATE requires sprint completion or force
  if (current === "EXECUTE" && next === "EVALUATE" && !input.force) {
    if (s.currentSprint?.state === "ACTIVE") {
      return { ok: false, error: "スプリントがまだ ACTIVE です。sprint_complete を先に実行するか force=true で強制遷移してください。" };
    }
  }

  await store.update((s) => {
    setPhase(s, next);

    // Auto-activate sprint when advancing PLAN→EXECUTE
    if (current === "PLAN" && next === "EXECUTE" && s.currentSprint?.state === "PLANNING") {
      s.currentSprint.state = "ACTIVE";
      s.currentSprint.startedAt = new Date().toISOString();
      const idx = s.sprints.findIndex((sp) => sp.id === s.currentSprint!.id);
      if (idx >= 0) {
        s.sprints[idx] = { ...s.currentSprint, tasks: [...s.currentSprint.tasks] };
      }
    }
  });

  return {
    ok: true,
    message: `フェーズ遷移: ${current} → ${next}`,
    data: { from: current, to: next },
  };
}
