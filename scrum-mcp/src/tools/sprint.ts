import type { StateStore } from "../state/store.js";
import type {
  SprintCreateInput,
  SprintCompleteInput,
  ToolResult,
  Task,
  Sprint,
  SprintMetrics,
  TaskState,
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

  const sprintNumber = s.sprints.length + 1;
  const sprintId = `sprint-${sprintNumber}`;
  const now = new Date().toISOString();
  const existingCount = Object.keys(s.tasks).length;

  const taskIds: string[] = [];
  const newTasks: Record<string, Task> = {};

  for (let i = 0; i < input.tasks.length; i++) {
    const t = input.tasks[i];
    const taskId = `task-${existingCount + i + 1}-${Date.now().toString(36)}`;
    taskIds.push(taskId);
    newTasks[taskId] = {
      id: taskId,
      title: t.title,
      description: t.description,
      acceptanceCriteria: t.acceptanceCriteria,
      state: "TODO",
      priority: t.priority,
      assignee: null,
      githubIssueNumber: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  const sprint: Sprint = {
    id: sprintId,
    number: sprintNumber,
    goal: input.goal,
    tasks: taskIds,
    state: "PLANNING",
    startedAt: null,
    completedAt: null,
  };

  await store.update((s) => {
    // Add tasks
    for (const [id, task] of Object.entries(newTasks)) {
      s.tasks[id] = task;
    }
    // Set current sprint
    s.currentSprint = sprint;
    // Push a copy to sprints[]
    s.sprints.push({ ...sprint, tasks: [...taskIds] });
  });

  return {
    ok: true,
    message: `スプリント「${sprintId}」を作成しました。タスク数: ${taskIds.length}`,
    data: { sprintId, taskIds },
  };
}

export async function sprintComplete(
  store: StateStore,
  input: SprintCompleteInput
): Promise<ToolResult<SprintMetrics>> {
  const s = store.peek();

  // 存在チェック
  if (!s.currentSprint || s.currentSprint.id !== input.sprintId) {
    return {
      ok: false,
      error: `スプリント「${input.sprintId}」が見つかりません。`,
    };
  }

  // 状態チェック
  if (s.currentSprint.state !== "ACTIVE") {
    return {
      ok: false,
      error: `スプリントは「${s.currentSprint.state}」状態です。ACTIVE でないと完了できません。`,
    };
  }

  // メトリクス計算
  const taskIds = s.currentSprint.tasks;
  const tasksByState: Partial<Record<TaskState, number>> = {};
  let completedTasks = 0;

  for (const id of taskIds) {
    const task = s.tasks[id];
    if (task) {
      tasksByState[task.state] = (tasksByState[task.state] ?? 0) + 1;
      if (task.state === "DONE") completedTasks++;
    }
  }

  const totalTasks = taskIds.length;
  const completionRate =
    totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const metrics: SprintMetrics = {
    sprintId: input.sprintId,
    totalTasks,
    completedTasks,
    totalPoints: 0,
    completedPoints: 0,
    completionRate,
    tasksByState,
  };

  await store.update((s) => {
    if (s.currentSprint) {
      s.currentSprint.state = "COMPLETED";
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
    message: `スプリント「${input.sprintId}」を完了しました。完了率: ${completionRate}%`,
    data: metrics,
  };
}
