import type { StateStore } from "../state/store.js";
import type {
  MetricsReportInput,
  ToolResult,
  SprintMetrics,
  TaskState,
  Priority,
} from "../types.js";

export async function metricsReport(
  store: StateStore,
  input: MetricsReportInput
): Promise<ToolResult<SprintMetrics>> {
  const s = store.peek();

  let sprint;
  if (input.sprintId) {
    sprint = s.sprints.find((sp) => sp.id === input.sprintId);
    if (!sprint) {
      return {
        ok: false,
        error: `スプリント「${input.sprintId}」が見つかりません。`,
      };
    }
  } else {
    sprint = s.currentSprint;
    if (!sprint) {
      return {
        ok: false,
        error: "アクティブなスプリントがありません。",
      };
    }
  }

  const tasksByState: Partial<Record<TaskState, number>> = {};
  const tasksByPriority: Partial<Record<Priority, number>> = {};
  let completedTasks = 0;
  let totalPoints = 0;
  let completedPoints = 0;

  for (const id of sprint.tasks) {
    // tasks または archivedTasks から検索
    const task = s.tasks[id] ?? s.archivedTasks[id];
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

  const totalTasks = sprint.tasks.length;
  const completionRate =
    totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const metrics: SprintMetrics = {
    sprintId: sprint.id,
    totalTasks,
    completedTasks,
    totalPoints,
    completedPoints,
    completionRate,
    tasksByState,
    tasksByPriority,
  };

  const summary = [
    `📊 スプリントメトリクス: ${sprint.id}`,
    `🎯 ゴール: ${sprint.goal}`,
    `📈 完了率: ${completionRate}% (${completedTasks}/${totalTasks})`,
    `📐 ポイント: ${completedPoints}/${totalPoints} pt`,
    "",
    "📋 状態別:",
    ...Object.entries(tasksByState).map(
      ([state, count]) => `  - ${state}: ${count}`
    ),
    "",
    "🏷️ 優先度別:",
    ...Object.entries(tasksByPriority).map(
      ([priority, count]) => `  - ${priority}: ${count}`
    ),
  ].join("\n");

  return {
    ok: true,
    message: summary,
    data: metrics,
  };
}
