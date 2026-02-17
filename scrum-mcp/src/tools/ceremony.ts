import type { StateStore } from "../state/store.js";
import type {
  CeremonyStartInput,
  CeremonyEndInput,
  ToolResult,
  CeremonyState,
  ScrumState,
} from "../types.js";
import { CEREMONY_STATE_MAP, VALID_TRANSITIONS } from "../types.js";

function buildCeremonySummary(state: ScrumState): string {
  const parts: string[] = [];

  if (state.currentSprint) {
    const sprint = state.currentSprint;
    parts.push(`スプリント: ${sprint.id} (${sprint.goal})`);

    const taskIds = sprint.tasks;
    const taskStates = taskIds.map((id) => state.tasks[id]?.state ?? "UNKNOWN");
    const done = taskStates.filter((s) => s === "DONE").length;
    parts.push(`タスク進捗: ${done}/${taskIds.length} 完了`);
  }

  const allTasks = Object.values(state.tasks);
  const backlog = allTasks.filter((t) => t.state === "BACKLOG").length;
  const ready = allTasks.filter((t) => t.state === "READY").length;
  if (backlog > 0) parts.push(`バックログ: ${backlog} タスク`);
  if (ready > 0) parts.push(`READY: ${ready} タスク`);

  return parts.length > 0 ? parts.join("\n") : "状態サマリーなし";
}

export async function ceremonyStart(
  store: StateStore,
  input: CeremonyStartInput
): Promise<ToolResult> {
  const s = store.peek();
  const targetState: CeremonyState = CEREMONY_STATE_MAP[input.type];

  // セレモニー重複チェック（sprint→review は例外）
  if (s.currentCeremony !== null) {
    if (!(s.currentCeremony === "sprint" && input.type === "review")) {
      return {
        ok: false,
        error: `セレモニー「${s.currentCeremony}」が実行中です。先に終了してください。`,
      };
    }
  }

  // 状態遷移チェック
  const validTargets = VALID_TRANSITIONS[s.ceremonyState];
  if (!validTargets.includes(targetState)) {
    return {
      ok: false,
      error: `現在の状態「${s.ceremonyState}」から「${targetState}」への遷移はできません。`,
    };
  }

  // sprint 前提チェック
  if (input.type === "sprint" && !s.currentSprint) {
    return {
      ok: false,
      error: "スプリントが作成されていません。先に sprint_create を実行してください。",
    };
  }

  // review 前提チェック
  if (input.type === "review") {
    if (!s.currentSprint || s.currentSprint.state !== "ACTIVE") {
      return {
        ok: false,
        error: "アクティブなスプリントがありません。",
      };
    }
  }

  // retro 前提チェック
  if (input.type === "retro") {
    if (
      !s.currentSprint ||
      (s.currentSprint.state !== "ACTIVE" && s.currentSprint.state !== "COMPLETED")
    ) {
      return {
        ok: false,
        error: "スプリントがアクティブまたは完了状態ではありません。",
      };
    }
  }

  // 状態更新
  await store.update((s) => {
    s.currentCeremony = input.type;
    s.ceremonyState = targetState;

    // sprint 開始時の追加処理
    if (input.type === "sprint" && s.currentSprint) {
      s.currentSprint.state = "ACTIVE";
      s.currentSprint.startedAt = new Date().toISOString();

      // sprints[] も同期コピー
      const idx = s.sprints.findIndex((sp) => sp.id === s.currentSprint!.id);
      if (idx >= 0) {
        s.sprints[idx] = { ...s.currentSprint, tasks: [...s.currentSprint.tasks] };
      }
    }
  });

  return {
    ok: true,
    message: `セレモニー「${input.type}」を開始しました。`,
  };
}

export async function ceremonyEnd(
  store: StateStore,
  input: CeremonyEndInput
): Promise<ToolResult> {
  const s = store.peek();

  // 一致チェック
  if (s.currentCeremony !== input.type) {
    return {
      ok: false,
      error: `セレモニー「${input.type}」は実行中ではありません。現在: ${s.currentCeremony ?? "なし"}`,
    };
  }

  // sprint 拒否
  if (input.type === "sprint") {
    return {
      ok: false,
      error:
        "sprint は ceremony_end では終了できません。sprint_complete → review → retro のフローで完結してください。",
    };
  }

  const summary = buildCeremonySummary(s);

  await store.update((s) => {
    s.currentCeremony = null;

    if (input.type === "retro") {
      s.ceremonyState = "IDLE";
    } else if (input.type === "refinement") {
      s.ceremonyState = "IDLE";
    }
    // review → SPRINT_REVIEW のまま
    // planning → PLANNING のまま
  });

  return {
    ok: true,
    message: `セレモニー「${input.type}」を終了しました。`,
    data: { summary },
  };
}
