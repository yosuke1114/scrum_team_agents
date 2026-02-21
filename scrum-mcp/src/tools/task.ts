import { randomUUID } from "node:crypto";
import type { StateStore } from "../state/store.js";
import type {
  TaskCreateInput,
  TaskUpdateInput,
  ToolResult,
  Task,
} from "../types.js";
import { VALID_TASK_TRANSITIONS } from "../types.js";

export async function taskCreate(
  store: StateStore,
  input: TaskCreateInput
): Promise<ToolResult> {
  if (input.points !== undefined && input.points < 0) {
    return { ok: false, error: "ポイントは0以上の値を指定してください。" };
  }

  const taskId = `task-${randomUUID()}`;
  const now = new Date().toISOString();

  const task: Task = {
    id: taskId,
    title: input.title,
    description: input.description,
    acceptanceCriteria: input.acceptanceCriteria,
    state: "BACKLOG",
    priority: input.priority,
    points: input.points ?? null,
    assignee: null,
    githubIssueNumber: null,
    createdAt: now,
    updatedAt: now,
  };

  await store.update((s) => {
    s.tasks[taskId] = task;
  });

  return {
    ok: true,
    message: `タスク「${taskId}」を作成しました。`,
    data: { taskId },
  };
}

export async function taskUpdate(
  store: StateStore,
  input: TaskUpdateInput
): Promise<ToolResult> {
  const s = store.peek();
  const task = s.tasks[input.taskId];

  // 存在チェック
  if (!task) {
    return {
      ok: false,
      error: `タスク「${input.taskId}」が見つかりません。`,
    };
  }

  // ポイントバリデーション
  if (input.points !== undefined && input.points < 0) {
    return { ok: false, error: "ポイントは0以上の値を指定してください。" };
  }

  // 更新フィールドチェック
  if (
    input.state === undefined &&
    input.priority === undefined &&
    input.points === undefined &&
    input.assignee === undefined
  ) {
    return {
      ok: false,
      error: "更新するフィールドがありません。",
    };
  }

  // 状態遷移チェック（state が指定され、かつ現在と異なる場合）
  if (input.state && input.state !== task.state) {
    const validTargets = VALID_TASK_TRANSITIONS[task.state];
    if (!validTargets.includes(input.state)) {
      return {
        ok: false,
        error: `タスク状態「${task.state}」から「${input.state}」への遷移はできません。`,
      };
    }
  }

  // WIP 制限チェック（スプリントスコープ）
  let warning: string | undefined;
  if (input.state === "IN_PROGRESS" || input.state === "IN_REVIEW") {
    const sprintTaskIds = s.currentSprint
      ? new Set(s.currentSprint.tasks)
      : null;
    const tasksInScope = sprintTaskIds
      ? Object.values(s.tasks).filter((t) => sprintTaskIds.has(t.id))
      : Object.values(s.tasks);
    const count = tasksInScope.filter((t) => t.state === input.state).length;
    const limit =
      input.state === "IN_PROGRESS"
        ? s.wipLimits.inProgress
        : s.wipLimits.inReview;

    if (count >= limit) {
      warning = `⚠️ WIP制限警告: ${input.state} が ${count} タスクあり、制限 ${limit} に達しています。`;
    }
  }

  await store.update((s) => {
    const t = s.tasks[input.taskId];
    if (t) {
      if (input.state) t.state = input.state;
      if (input.priority !== undefined) t.priority = input.priority;
      if (input.points !== undefined) t.points = input.points;
      if (input.assignee !== undefined) t.assignee = input.assignee;
      t.updatedAt = new Date().toISOString();
    }
  });

  const changes: string[] = [];
  if (input.state) changes.push(`状態→${input.state}`);
  if (input.priority !== undefined) changes.push(`優先度→${input.priority}`);
  if (input.points !== undefined) changes.push(`ポイント→${input.points}`);

  const result: ToolResult = {
    ok: true,
    message: `タスク「${input.taskId}」を更新しました。(${changes.join(", ") || "担当変更"})`,
  };

  if (warning) {
    result.message += `\n${warning}`;
  }

  return result;
}
