import type { StateStore } from "../state/store.js";
import type { ToolResult } from "../types.js";

export interface QualityCheckResult {
  taskId: string;
  verdict: "pass" | "fail" | "warn";
  checks: Array<{
    name: string;
    passed: boolean;
    detail: string;
  }>;
}

export interface QualityCheckInput {
  taskId: string;
}

export async function qualityCheck(
  store: StateStore,
  input: QualityCheckInput
): Promise<ToolResult<QualityCheckResult>> {
  const s = store.peek();
  const task = s.tasks[input.taskId] ?? s.archivedTasks[input.taskId];

  if (!task) {
    return { ok: false, error: `タスク「${input.taskId}」が見つかりません。` };
  }

  const checks: QualityCheckResult["checks"] = [];

  // Check 1: Acceptance criteria defined
  const hasAC = task.acceptanceCriteria.length > 0;
  checks.push({
    name: "acceptance_criteria",
    passed: hasAC,
    detail: hasAC
      ? `受入条件: ${task.acceptanceCriteria.length} 件定義済み`
      : "受入条件が未定義です",
  });

  // Check 2: Description is non-empty
  const hasDesc = task.description.trim().length > 0;
  checks.push({
    name: "description",
    passed: hasDesc,
    detail: hasDesc ? "説明あり" : "説明が空です",
  });

  // Check 3: Points estimated
  const hasPoints = task.points !== null && task.points > 0;
  checks.push({
    name: "estimation",
    passed: hasPoints,
    detail: hasPoints ? `${task.points}pt 見積済` : "ポイント未見積もり",
  });

  // Check 4: Assignee set (for IN_PROGRESS/IN_REVIEW/DONE)
  const needsAssignee = ["IN_PROGRESS", "IN_REVIEW", "DONE"].includes(task.state);
  const hasAssignee = task.assignee !== null;
  if (needsAssignee) {
    checks.push({
      name: "assignee",
      passed: hasAssignee,
      detail: hasAssignee ? `担当: ${task.assignee}` : "担当者未設定（作業中タスク）",
    });
  }

  // Check 5: State is appropriate for review
  if (task.state === "IN_REVIEW" || task.state === "DONE") {
    // All AC should be verifiable
    const acCheck = task.acceptanceCriteria.length >= 1;
    checks.push({
      name: "review_readiness",
      passed: acCheck,
      detail: acCheck
        ? `レビュー準備完了 (AC: ${task.acceptanceCriteria.length} 件)`
        : "レビュー対象だが受入条件がありません",
    });
  }

  const failCount = checks.filter((c) => !c.passed).length;
  let verdict: QualityCheckResult["verdict"];
  if (failCount === 0) {
    verdict = "pass";
  } else if (failCount <= 1) {
    verdict = "warn";
  } else {
    verdict = "fail";
  }

  const result: QualityCheckResult = {
    taskId: input.taskId,
    verdict,
    checks,
  };

  const icon = verdict === "pass" ? "✅" : verdict === "warn" ? "⚠️" : "❌";
  const lines = [
    `${icon} 品質チェック: ${task.id} [${task.state}] - ${verdict.toUpperCase()}`,
    ...checks.map((c) => `  ${c.passed ? "✓" : "✗"} ${c.name}: ${c.detail}`),
  ];

  return { ok: true, message: lines.join("\n"), data: result };
}
