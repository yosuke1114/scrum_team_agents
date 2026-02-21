import type { StateStore } from "../state/store.js";
import type { ToolResult, VelocityData, VelocityReportInput } from "../types.js";

export async function velocityReport(
  store: StateStore,
  input: VelocityReportInput
): Promise<ToolResult<VelocityData>> {
  const s = store.peek();

  const completedSprints = s.sprints.filter(
    (sp) => sp.state === "COMPLETED"
  );

  if (completedSprints.length === 0) {
    return {
      ok: false,
      error: "完了したスプリントがありません。",
    };
  }

  const lastN = input.lastN ?? completedSprints.length;
  const targetSprints = completedSprints.slice(-lastN);

  const sprintData = targetSprints.map((sp) => {
    // メトリクススナップショットがあればそれを使用（正確な完了時点の値）
    if (sp.metrics) {
      return {
        id: sp.id,
        number: sp.number,
        goal: sp.goal,
        completedPoints: sp.metrics.completedPoints,
        totalPoints: sp.metrics.totalPoints,
        completedTasks: sp.metrics.completedTasks,
        totalTasks: sp.metrics.totalTasks,
      };
    }

    // フォールバック: スナップショットがない旧スプリント向け
    let completedPoints = 0;
    let totalPoints = 0;
    let completedTasks = 0;
    const totalTasks = sp.tasks.length;

    for (const id of sp.tasks) {
      const task = s.tasks[id] ?? s.archivedTasks[id];
      if (task) {
        const pts = task.points ?? 0;
        totalPoints += pts;
        if (task.state === "DONE") {
          completedTasks++;
          completedPoints += pts;
        }
      }
    }

    return {
      id: sp.id,
      number: sp.number,
      goal: sp.goal,
      completedPoints,
      totalPoints,
      completedTasks,
      totalTasks,
    };
  });

  const totalVelocity = sprintData.reduce(
    (sum, sp) => sum + sp.completedPoints,
    0
  );
  const avgVelocity =
    sprintData.length > 0 ? Math.round(totalVelocity / sprintData.length) : 0;

  const totalCompletionRate = sprintData.reduce((sum, sp) => {
    const rate =
      sp.totalTasks > 0 ? (sp.completedTasks / sp.totalTasks) * 100 : 0;
    return sum + rate;
  }, 0);
  const avgCompletionRate =
    sprintData.length > 0
      ? Math.round(totalCompletionRate / sprintData.length)
      : 0;

  const data: VelocityData = {
    sprints: sprintData,
    averageVelocity: avgVelocity,
    averageCompletionRate: avgCompletionRate,
  };

  const lines = [
    `📊 ベロシティレポート (直近 ${sprintData.length} スプリント)`,
    "",
    ...sprintData.map(
      (sp) =>
        `  ${sp.id}: ${sp.completedPoints}pt / ${sp.totalPoints}pt (${sp.completedTasks}/${sp.totalTasks} タスク)`
    ),
    "",
    `📈 平均ベロシティ: ${avgVelocity} pt/スプリント`,
    `🎯 平均完了率: ${avgCompletionRate}%`,
  ];

  return {
    ok: true,
    message: lines.join("\n"),
    data,
  };
}
