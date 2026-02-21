import type { StateStore } from "../state/store.js";
import type {
  SprintCreateInput,
  SprintAddTasksInput,
  SprintCompleteInput,
  SprintCarryOverInput,
  SprintCancelInput,
  ToolResult,
  Sprint,
  SprintMetrics,
  ScrumState,
  TaskState,
  Priority,
} from "../types.js";

/** currentSprint の状態を sprints[] 配列に同期する */
export function syncCurrentSprint(s: ScrumState): void {
  if (!s.currentSprint) return;
  const idx = s.sprints.findIndex((sp) => sp.id === s.currentSprint!.id);
  if (idx >= 0) {
    s.sprints[idx] = { ...s.currentSprint, tasks: [...s.currentSprint.tasks] };
  }
}

export async function sprintCreate(
  store: StateStore,
  input: SprintCreateInput
): Promise<ToolResult> {
  const s = store.peek();

  // 重複チェック
  if (s.currentSprint) {
    if (s.currentSprint.state === "ACTIVE") {
      return {
        ok: false,
        error: "アクティブなスプリントがあります。先に完了してください。",
      };
    }
    if (s.currentSprint.state === "PLANNING") {
      return {
        ok: false,
        error: "プランニング中のスプリントがあります。",
      };
    }
  }

  // タスク ID 検証
  const invalidIds: string[] = [];
  const notReadyIds: string[] = [];
  for (const id of input.taskIds) {
    const task = s.tasks[id];
    if (!task) {
      invalidIds.push(id);
    } else if (task.state !== "READY") {
      notReadyIds.push(id);
    }
  }

  if (invalidIds.length > 0) {
    return {
      ok: false,
      error: `タスクが見つかりません: ${invalidIds.join(", ")}`,
    };
  }
  if (notReadyIds.length > 0) {
    return {
      ok: false,
      error: `READY 状態でないタスクがあります: ${notReadyIds.join(", ")}`,
    };
  }

  const sprintNumber = s.sprints.length > 0
    ? Math.max(...s.sprints.map((sp) => sp.number)) + 1
    : 1;
  const sprintId = `sprint-${sprintNumber}`;

  const sprint: Sprint = {
    id: sprintId,
    number: sprintNumber,
    goal: input.goal,
    tasks: [...input.taskIds],
    state: "PLANNING",
    startedAt: null,
    completedAt: null,
  };

  await store.update((s) => {
    // READY → TODO に遷移
    for (const id of input.taskIds) {
      s.tasks[id].state = "TODO";
      s.tasks[id].updatedAt = new Date().toISOString();
    }
    s.currentSprint = sprint;
    s.sprints.push({ ...sprint, tasks: [...input.taskIds] });
  });

  return {
    ok: true,
    message: `スプリント「${sprintId}」を作成しました。タスク数: ${input.taskIds.length}`,
    data: { sprintId, taskIds: input.taskIds },
  };
}

export async function sprintAddTasks(
  store: StateStore,
  input: SprintAddTasksInput
): Promise<ToolResult> {
  const s = store.peek();

  if (!s.currentSprint || s.currentSprint.id !== input.sprintId) {
    return {
      ok: false,
      error: `スプリント「${input.sprintId}」が見つかりません。`,
    };
  }

  if (s.currentSprint.state !== "PLANNING") {
    return {
      ok: false,
      error: "スプリントが PLANNING 状態ではありません。",
    };
  }

  const existing = new Set(s.currentSprint.tasks);
  const invalidIds: string[] = [];
  const notReadyIds: string[] = [];
  const duplicateIds: string[] = [];

  for (const id of input.taskIds) {
    const task = s.tasks[id];
    if (!task) {
      invalidIds.push(id);
    } else if (existing.has(id)) {
      duplicateIds.push(id);
    } else if (task.state !== "READY") {
      notReadyIds.push(id);
    }
  }

  if (invalidIds.length > 0) {
    return { ok: false, error: `タスクが見つかりません: ${invalidIds.join(", ")}` };
  }
  if (duplicateIds.length > 0) {
    return { ok: false, error: `既にスプリントに含まれています: ${duplicateIds.join(", ")}` };
  }
  if (notReadyIds.length > 0) {
    return { ok: false, error: `READY 状態でないタスクがあります: ${notReadyIds.join(", ")}` };
  }

  await store.update((s) => {
    for (const id of input.taskIds) {
      s.tasks[id].state = "TODO";
      s.tasks[id].updatedAt = new Date().toISOString();
      s.currentSprint!.tasks.push(id);
    }
    syncCurrentSprint(s);
  });

  return {
    ok: true,
    message: `スプリント「${input.sprintId}」に ${input.taskIds.length} タスクを追加しました。`,
    data: { taskIds: input.taskIds },
  };
}

export async function sprintComplete(
  store: StateStore,
  input: SprintCompleteInput
): Promise<ToolResult<SprintMetrics>> {
  const s = store.peek();

  if (!s.currentSprint || s.currentSprint.id !== input.sprintId) {
    return {
      ok: false,
      error: `スプリント「${input.sprintId}」が見つかりません。`,
    };
  }

  if (s.currentSprint.state !== "ACTIVE") {
    return {
      ok: false,
      error: `スプリントは「${s.currentSprint.state}」状態です。ACTIVE でないと完了できません。`,
    };
  }

  // メトリクス計算
  const taskIds = s.currentSprint.tasks;
  const tasksByState: Partial<Record<TaskState, number>> = {};
  const tasksByPriority: Partial<Record<Priority, number>> = {};
  let completedTasks = 0;
  let totalPoints = 0;
  let completedPoints = 0;

  for (const id of taskIds) {
    const task = s.tasks[id];
    if (task) {
      tasksByState[task.state] = (tasksByState[task.state] ?? 0) + 1;
      tasksByPriority[task.priority] = (tasksByPriority[task.priority] ?? 0) + 1;
      const pts = task.points ?? 0;
      totalPoints += pts;
      if (task.state === "DONE") {
        completedTasks++;
        completedPoints += pts;
      }
    }
  }

  const totalTasks = taskIds.length;
  const completionRate =
    totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const metrics: SprintMetrics = {
    sprintId: input.sprintId,
    totalTasks,
    completedTasks,
    totalPoints,
    completedPoints,
    completionRate,
    tasksByState,
    tasksByPriority,
  };

  // review セレモニー実行中かの検証（ソフト警告）
  let reviewWarning: string | undefined;
  if (s.currentCeremony !== "review") {
    reviewWarning = "⚠️ review セレモニーが開始されていません。sprint_complete → review → retro のフローを推奨します。";
  }

  // H1: BLOCKED タスクの情報を収集（降格対象）
  const blockedTasks: Array<{ id: string; title: string }> = [];
  for (const id of taskIds) {
    const task = s.tasks[id];
    if (task && task.state === "BLOCKED") {
      blockedTasks.push({ id: task.id, title: task.title });
    }
  }

  await store.update((s) => {
    if (s.currentSprint) {
      s.currentSprint.state = "COMPLETED";
      s.currentSprint.completedAt = new Date().toISOString();
      s.currentSprint.metrics = metrics;

      // sprints[] 同期を先に実行（アーカイブ前の完了状態を記録）
      syncCurrentSprint(s);

      // H1: BLOCKED タスクを BACKLOG に降格（孤立防止）
      for (const id of s.currentSprint.tasks) {
        const task = s.tasks[id];
        if (task && task.state === "BLOCKED") {
          task.state = "BACKLOG";
          task.assignee = null;
          task.updatedAt = new Date().toISOString();
        }
      }

      // DONE タスクをアーカイブ
      for (const id of s.currentSprint.tasks) {
        const task = s.tasks[id];
        if (task && task.state === "DONE") {
          task.completedInSprintId = s.currentSprint.id;
          s.archivedTasks[id] = { ...task };
          delete s.tasks[id];
        }
      }

      // sprint セレモニー中に complete した場合、セレモニー状態を自動リセット
      // （review 経由の正常フローではここに到達しない）
      if (s.currentCeremony === "sprint") {
        s.currentCeremony = null;
        s.ceremonyState = "IDLE";
      }
    }
  });

  const warnings: string[] = [];
  const msg = `スプリント「${input.sprintId}」を完了しました。完了率: ${completionRate}%`;
  if (reviewWarning) warnings.push(reviewWarning);
  if (blockedTasks.length > 0) {
    warnings.push(
      `⚠️ ${blockedTasks.length} ブロック中タスクを BACKLOG に降格しました: ${blockedTasks.map((t) => t.id).join(", ")}`
    );
  }

  return {
    ok: true,
    message: warnings.length > 0 ? `${msg}\n${warnings.join("\n")}` : msg,
    data: metrics,
  };
}

export async function sprintCarryOver(
  store: StateStore,
  input: SprintCarryOverInput
): Promise<ToolResult> {
  const s = store.peek();

  const sprint = s.sprints.find((sp) => sp.id === input.sprintId);
  if (!sprint) {
    return {
      ok: false,
      error: `スプリント「${input.sprintId}」が見つかりません。`,
    };
  }

  if (sprint.state !== "COMPLETED" && sprint.state !== "CANCELLED") {
    return {
      ok: false,
      error: `スプリントが完了または中止状態ではありません (現在: ${sprint.state})。`,
    };
  }

  // 未完了タスクを特定
  const incompleteTaskIds = sprint.tasks.filter((id) => {
    const task = s.tasks[id];
    return task && task.state !== "DONE";
  });

  const targetIds = input.taskIds ?? incompleteTaskIds;

  // 検証
  const sprintTaskSet = new Set(sprint.tasks);
  for (const id of targetIds) {
    if (!sprintTaskSet.has(id)) {
      return {
        ok: false,
        error: `タスク「${id}」はスプリント「${input.sprintId}」に含まれていません。`,
      };
    }
    const task = s.tasks[id];
    if (!task) {
      return {
        ok: false,
        error: `タスク「${id}」が見つかりません（アーカイブ済みの可能性）。`,
      };
    }
    if (task.state === "DONE") {
      return {
        ok: false,
        error: `タスク「${id}」は DONE 状態のため持ち越しできません。`,
      };
    }
  }

  if (targetIds.length === 0) {
    return {
      ok: true,
      message: "持ち越し対象の未完了タスクはありません。",
      data: { taskIds: [] },
    };
  }

  await store.update((s) => {
    for (const id of targetIds) {
      const task = s.tasks[id];
      if (task) {
        task.state = "READY";
        task.assignee = null;
        task.updatedAt = new Date().toISOString();
      }
    }
  });

  return {
    ok: true,
    message: `${targetIds.length} タスクを READY 状態に戻しました。次のスプリントプランニングで選択できます。`,
    data: { taskIds: targetIds },
  };
}

export async function sprintCancel(
  store: StateStore,
  input: SprintCancelInput
): Promise<ToolResult> {
  const s = store.peek();

  if (!s.currentSprint || s.currentSprint.id !== input.sprintId) {
    return {
      ok: false,
      error: `スプリント「${input.sprintId}」が見つかりません。`,
    };
  }

  if (
    s.currentSprint.state === "COMPLETED" ||
    s.currentSprint.state === "CANCELLED"
  ) {
    return {
      ok: false,
      error: `スプリントは既に「${s.currentSprint.state}」状態です。`,
    };
  }

  // 中止前に作業中タスクの情報を収集
  const taskIds = s.currentSprint.tasks;
  const affectedTasks: Array<{ id: string; title: string; previousState: TaskState }> = [];
  const doneTasks: Array<{ id: string; title: string }> = [];
  for (const id of taskIds) {
    const task = s.tasks[id];
    if (!task) continue;
    if (task.state === "DONE") {
      doneTasks.push({ id: task.id, title: task.title });
    } else if (task.state !== "BACKLOG" && task.state !== "READY") {
      affectedTasks.push({ id: task.id, title: task.title, previousState: task.state });
    }
  }

  await store.update((s) => {
    if (s.currentSprint) {
      s.currentSprint.state = "CANCELLED";
      s.currentSprint.completedAt = new Date().toISOString();

      // セレモニー状態クリーンアップ（任意のセレモニーをクリア）
      s.currentCeremony = null;
      s.ceremonyState = "IDLE";

      // 作業中タスクを READY に戻す（BACKLOG は明示的降格なので保持）
      for (const id of s.currentSprint.tasks) {
        const task = s.tasks[id];
        if (task && task.state !== "DONE" && task.state !== "BACKLOG") {
          task.state = "READY";
          task.assignee = null;
          task.updatedAt = new Date().toISOString();
        }
      }

      // H1: DONE タスクをアーカイブ（sprintComplete と同様）
      for (const id of s.currentSprint.tasks) {
        const task = s.tasks[id];
        if (task && task.state === "DONE") {
          task.completedInSprintId = s.currentSprint.id;
          s.archivedTasks[id] = { ...task };
          delete s.tasks[id];
        }
      }

      // sprints[] 同期
      syncCurrentSprint(s);
    }
  });

  const warnings: string[] = [];
  if (affectedTasks.length > 0) {
    warnings.push(
      `⚠️ ${affectedTasks.length} タスクを READY に戻しました:`,
      ...affectedTasks.map((t) => `  - ${t.id}: ${t.title} (${t.previousState} → READY)`),
    );
  }
  if (doneTasks.length > 0) {
    warnings.push(
      `📦 ${doneTasks.length} 完了タスクをアーカイブしました:`,
      ...doneTasks.map((t) => `  - ${t.id}: ${t.title}`),
    );
  }

  return {
    ok: true,
    message: [
      `スプリント「${input.sprintId}」を中止しました。理由: ${input.reason}`,
      ...warnings,
    ].join("\n"),
    data: { sprintId: input.sprintId, reason: input.reason, affectedTasks, archivedTasks: doneTasks },
  };
}
