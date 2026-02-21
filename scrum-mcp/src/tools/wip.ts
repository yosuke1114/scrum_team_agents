import type { StateStore } from "../state/store.js";
import type { ToolResult, WipStatus, WipStatusInput } from "../types.js";

export async function wipStatus(
  store: StateStore,
  input?: WipStatusInput
): Promise<ToolResult<WipStatus>> {
  const s = store.peek();

  // スプリントスコープの決定
  let sprintTaskIds: Set<string> | null = null;
  const sprintId = input?.sprintId;
  if (sprintId) {
    const sprint =
      s.currentSprint?.id === sprintId
        ? s.currentSprint
        : s.sprints.find((sp) => sp.id === sprintId);
    if (sprint) {
      sprintTaskIds = new Set(sprint.tasks);
    }
  } else if (s.currentSprint) {
    sprintTaskIds = new Set(s.currentSprint.tasks);
  }

  const allTasks = Object.values(s.tasks);
  const scopedTasks = sprintTaskIds
    ? allTasks.filter((t) => sprintTaskIds!.has(t.id))
    : allTasks;

  const inProgressTasks = scopedTasks.filter((t) => t.state === "IN_PROGRESS");
  const inReviewTasks = scopedTasks.filter((t) => t.state === "IN_REVIEW");

  const inProgress = inProgressTasks.length;
  const inReview = inReviewTasks.length;

  const warnings: string[] = [];

  // IN_PROGRESS チェック
  if (inProgress > s.wipLimits.inProgress) {
    warnings.push(
      `⚠️ IN_PROGRESS が制限超過です (${inProgress}/${s.wipLimits.inProgress})`
    );
  } else if (inProgress === s.wipLimits.inProgress) {
    warnings.push(
      `⚡ IN_PROGRESS が制限到達です (${inProgress}/${s.wipLimits.inProgress})`
    );
  }

  // IN_REVIEW チェック
  if (inReview > s.wipLimits.inReview) {
    warnings.push(
      `⚠️ IN_REVIEW が制限超過です (${inReview}/${s.wipLimits.inReview})`
    );
  } else if (inReview === s.wipLimits.inReview) {
    warnings.push(
      `⚡ IN_REVIEW が制限到達です (${inReview}/${s.wipLimits.inReview})`
    );
  }

  const status: WipStatus = {
    inProgress,
    inReview,
    limits: { ...s.wipLimits },
  };

  if (warnings.length > 0) {
    status.warning = warnings.join("\n");
  }

  const details = [
    ...(inProgressTasks.length > 0
      ? [
          "IN_PROGRESS:",
          ...inProgressTasks.map(
            (t) => `  - ${t.id}: ${t.title} (担当: ${t.assignee ?? "未割当"})`
          ),
        ]
      : []),
    ...(inReviewTasks.length > 0
      ? [
          "IN_REVIEW:",
          ...inReviewTasks.map(
            (t) => `  - ${t.id}: ${t.title} (担当: ${t.assignee ?? "未割当"})`
          ),
        ]
      : []),
  ];

  return {
    ok: true,
    message: details.length > 0 ? details.join("\n") : "作業中のタスクはありません。",
    data: status,
  };
}
