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
  const s = store.peek();
  const existingCount = Object.keys(s.tasks).length;
  const taskId = `task-${existingCount + 1}-${Date.now().toString(36)}`;
  const now = new Date().toISOString();

  const task: Task = {
    id: taskId,
    title: input.title,
    description: input.description,
    acceptanceCriteria: input.acceptanceCriteria,
    state: "BACKLOG",
    priority: input.priority,
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

  // 状態遷移チェック
  const validTargets = VALID_TASK_TRANSITIONS[task.state];
  if (!validTargets.includes(input.state)) {
    return {
      ok: false,
      error: `タスク状態「${task.state}」から「${input.state}」への遷移はできません。`,
    };
  }

  // WIP 制限チェック（ソフト警告）
  let warning: string | undefined;
  if (input.state === "IN_PROGRESS" || input.state === "IN_REVIEW") {
    const allTasks = Object.values(s.tasks);
    const count = allTasks.filter((t) => t.state === input.state).length;
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
      t.state = input.state;
      t.updatedAt = new Date().toISOString();

      // assignee: undefined=変更なし, null=担当解除, string=担当設定
      if (input.assignee !== undefined) {
        t.assignee = input.assignee;
      }
    }
  });

  const result: ToolResult = {
    ok: true,
    message: `タスク「${input.taskId}」を「${input.state}」に更新しました。`,
  };

  if (warning) {
    result.message += `\n${warning}`;
  }

  return result;
}
