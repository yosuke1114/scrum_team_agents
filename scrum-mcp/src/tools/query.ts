import type { StateStore } from "../state/store.js";
import type {
  ToolResult,
  Task,
  TaskState,
  Priority,
  CeremonyState,
} from "../types.js";
import { VALID_TRANSITIONS } from "../types.js";

// --- list_tasks ---

export interface ListTasksInput {
  state?: TaskState;
  priority?: Priority;
  assignee?: string;
  sprintId?: string;
}

export async function listTasks(
  store: StateStore,
  input: ListTasksInput
): Promise<ToolResult<Task[]>> {
  const s = store.peek();
  let tasks = Object.values(s.tasks);

  // sprintId フィルタ
  if (input.sprintId) {
    const sprint =
      s.currentSprint?.id === input.sprintId
        ? s.currentSprint
        : s.sprints.find((sp) => sp.id === input.sprintId);
    if (!sprint) {
      return { ok: false, error: `スプリント「${input.sprintId}」が見つかりません。` };
    }
    const sprintTaskIds = new Set(sprint.tasks);
    tasks = tasks.filter((t) => sprintTaskIds.has(t.id));
  }

  if (input.state) {
    tasks = tasks.filter((t) => t.state === input.state);
  }
  if (input.priority) {
    tasks = tasks.filter((t) => t.priority === input.priority);
  }
  if (input.assignee) {
    tasks = tasks.filter((t) => t.assignee === input.assignee);
  }

  // 優先度ソート: high → medium → low
  const priorityOrder: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
  tasks.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const summary = tasks
    .map((t) => `  ${t.id} [${t.state}] (${t.priority}) ${t.title}${t.assignee ? ` @${t.assignee}` : ""}`)
    .join("\n");

  return {
    ok: true,
    message: tasks.length > 0 ? `${tasks.length} タスク:\n${summary}` : "該当するタスクはありません。",
    data: tasks,
  };
}

// --- get_task ---

export interface GetTaskInput {
  taskId: string;
}

export async function getTask(
  store: StateStore,
  input: GetTaskInput
): Promise<ToolResult<Task>> {
  const s = store.peek();
  const task = s.tasks[input.taskId];

  if (!task) {
    return { ok: false, error: `タスク「${input.taskId}」が見つかりません。` };
  }

  const detail = [
    `📋 ${task.id}: ${task.title}`,
    `状態: ${task.state} | 優先度: ${task.priority} | 担当: ${task.assignee ?? "未割当"}`,
    `説明: ${task.description}`,
    "",
    "受入条件:",
    ...task.acceptanceCriteria.map((c, i) => `  ${i + 1}. ${c}`),
    "",
    `GitHub Issue: ${task.githubIssueNumber ? `#${task.githubIssueNumber}` : "未連携"}`,
    `作成: ${task.createdAt} | 更新: ${task.updatedAt}`,
  ].join("\n");

  return {
    ok: true,
    message: detail,
    data: JSON.parse(JSON.stringify(task)),
  };
}

// --- project_status ---

interface ProjectStatusData {
  ceremonyState: CeremonyState;
  currentCeremony: string | null;
  nextCeremonies: CeremonyState[];
  sprint: {
    id: string;
    goal: string;
    state: string;
    totalTasks: number;
    completedTasks: number;
    completionRate: number;
  } | null;
  backlog: { total: number; ready: number };
  wip: { inProgress: number; inReview: number; limits: { inProgress: number; inReview: number } };
  blockers: Array<{ id: string; title: string; assignee: string | null }>;
  sprintHistory: number;
}

export async function projectStatus(
  store: StateStore
): Promise<ToolResult<ProjectStatusData>> {
  const s = store.peek();
  const allTasks = Object.values(s.tasks);

  // セレモニー情報
  const nextCeremonies = VALID_TRANSITIONS[s.ceremonyState];

  // スプリント情報
  let sprintInfo: ProjectStatusData["sprint"] = null;
  if (s.currentSprint) {
    const sp = s.currentSprint;
    const sprintTasks = sp.tasks.map((id) => s.tasks[id]).filter(Boolean);
    const done = sprintTasks.filter((t) => t.state === "DONE").length;
    const total = sprintTasks.length;
    sprintInfo = {
      id: sp.id,
      goal: sp.goal,
      state: sp.state,
      totalTasks: total,
      completedTasks: done,
      completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  }

  // バックログ情報
  const backlog = {
    total: allTasks.filter((t) => t.state === "BACKLOG").length,
    ready: allTasks.filter((t) => t.state === "READY").length,
  };

  // WIP 情報
  const inProgress = allTasks.filter((t) => t.state === "IN_PROGRESS").length;
  const inReview = allTasks.filter((t) => t.state === "IN_REVIEW").length;

  // ブロッカー
  const blockers = allTasks
    .filter((t) => t.state === "BLOCKED")
    .map((t) => ({ id: t.id, title: t.title, assignee: t.assignee }));

  const data: ProjectStatusData = {
    ceremonyState: s.ceremonyState,
    currentCeremony: s.currentCeremony,
    nextCeremonies,
    sprint: sprintInfo,
    backlog,
    wip: { inProgress, inReview, limits: { ...s.wipLimits } },
    blockers,
    sprintHistory: s.sprints.length,
  };

  // サマリー
  const lines: string[] = [
    `📊 プロジェクト状況: ${s.config.projectName}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🔄 セレモニー: ${s.ceremonyState}${s.currentCeremony ? ` (${s.currentCeremony} 実行中)` : ""}`,
    `   次に可能: ${nextCeremonies.join(", ")}`,
  ];

  if (sprintInfo) {
    lines.push(
      "",
      `🏃 スプリント: ${sprintInfo.id} [${sprintInfo.state}]`,
      `   ゴール: ${sprintInfo.goal}`,
      `   進捗: ${sprintInfo.completionRate}% (${sprintInfo.completedTasks}/${sprintInfo.totalTasks})`,
    );
  } else {
    lines.push("", "🏃 スプリント: なし");
  }

  lines.push(
    "",
    `📦 バックログ: ${backlog.total} タスク (READY: ${backlog.ready})`,
    `⚡ WIP: IN_PROGRESS ${inProgress}/${s.wipLimits.inProgress} | IN_REVIEW ${inReview}/${s.wipLimits.inReview}`,
  );

  if (blockers.length > 0) {
    lines.push(
      "",
      `🚫 ブロッカー: ${blockers.length} 件`,
      ...blockers.map((b) => `   - ${b.id}: ${b.title}${b.assignee ? ` (@${b.assignee})` : ""}`),
    );
  }

  lines.push("", `📈 完了スプリント数: ${s.sprints.filter((sp) => sp.state === "COMPLETED").length}`);

  return {
    ok: true,
    message: lines.join("\n"),
    data,
  };
}
