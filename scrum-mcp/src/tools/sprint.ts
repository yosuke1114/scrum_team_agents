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
  TaskState,
  Priority,
} from "../types.js";

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

  const sprintNumber = s.sprints.length + 1;
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
    // sprints[] 同期
    const idx = s.sprints.findIndex((sp) => sp.id === s.currentSprint!.id);
    if (idx >= 0) {
      s.sprints[idx].tasks = [...s.currentSprint!.tasks];
    }
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

  await store.update((s) => {
    if (s.currentSprint) {
      s.currentSprint.state = "COMPLETED";
      s.currentSprint.completedAt = new Date().toISOString();

      // DONE タスクをアーカイブ
      for (const id of s.currentSprint.tasks) {
        const task = s.tasks[id];
        if (task && task.state === "DONE") {
          s.archivedTasks[id] = { ...task };
          delete s.tasks[id];
        }
      }

      // sprints[] 同期
      const idx = s.sprints.findIndex((sp) => sp.id === s.currentSprint!.id);
      if (idx >= 0) {
        s.sprints[idx] = {
          ...s.currentSprint,
          tasks: [...s.currentSprint.tasks],
        };
      }
    }
  });

  return {
    ok: true,
    message: `スプリント「${input.sprintId}」を完了しました。完了率: ${completionRate}%`,
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

  await store.update((s) => {
    if (s.currentSprint) {
      s.currentSprint.state = "CANCELLED";
      s.currentSprint.completedAt = new Date().toISOString();

      // sprints[] 同期
      const idx = s.sprints.findIndex((sp) => sp.id === s.currentSprint!.id);
      if (idx >= 0) {
        s.sprints[idx] = {
          ...s.currentSprint,
          tasks: [...s.currentSprint.tasks],
        };
      }
    }
  });

  return {
    ok: true,
    message: `スプリント「${input.sprintId}」を中止しました。理由: ${input.reason}`,
    data: { sprintId: input.sprintId, reason: input.reason },
  };
}
