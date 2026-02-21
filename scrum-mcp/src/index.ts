import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { StateStore } from "./state/store.js";
import { AuditLog } from "./state/audit.js";
import { ceremonyStart, ceremonyEnd } from "./tools/ceremony.js";
import { sprintCreate, sprintAddTasks, sprintComplete, sprintCarryOver, sprintCancel } from "./tools/sprint.js";
import { taskCreate, taskUpdate } from "./tools/task.js";
import { githubSync } from "./tools/github.js";
import { metricsReport } from "./tools/metrics.js";
import { wipStatus } from "./tools/wip.js";
import { listTasks, getTask, projectStatus } from "./tools/query.js";
import { ceremonyReport } from "./tools/report.js";
import { writeDashboard } from "./tools/dashboard.js";
import { velocityReport } from "./tools/velocity.js";

const STATE_FILE = process.env.SCRUM_STATE_FILE ?? ".scrum/state.json";

const store = await StateStore.init(STATE_FILE);
const audit = new AuditLog(STATE_FILE);

const server = new McpServer({
  name: "scrum-mcp",
  version: "0.3.0",
});

// --- Persona context ---
let currentPersona: string | null = null;

// --- Audit helper ---
async function withAudit<T extends { ok: boolean; error?: string }>(
  toolName: string,
  input: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const result = await fn();
  await audit.log({
    ts: new Date().toISOString(),
    tool: toolName,
    input,
    ok: result.ok,
    error: result.error,
    persona: currentPersona ?? undefined,
  });
  return result;
}

const ceremonyTypeSchema = z.enum([
  "refinement",
  "planning",
  "sprint",
  "review",
  "retro",
]);

const prioritySchema = z.enum(["high", "medium", "low"]);

const taskStateSchema = z.enum([
  "BACKLOG",
  "READY",
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "DONE",
  "BLOCKED",
]);

// --- set_context ---
server.tool(
  "set_context",
  "セッションコンテキスト（ペルソナ等）を設定する",
  {
    persona: z.string().optional(),
  },
  async ({ persona }) => {
    currentPersona = persona ?? null;
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: true, persona: currentPersona }) }],
    };
  }
);

// --- ceremony_start ---
server.tool(
  "ceremony_start",
  "セレモニーを開始する",
  { type: ceremonyTypeSchema },
  async ({ type }) => {
    const result = await withAudit("ceremony_start", { type }, () =>
      ceremonyStart(store, { type })
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- ceremony_end ---
server.tool(
  "ceremony_end",
  "セレモニーを終了する",
  { type: ceremonyTypeSchema },
  async ({ type }) => {
    const result = await withAudit("ceremony_end", { type }, () =>
      ceremonyEnd(store, { type })
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- sprint_create ---
server.tool(
  "sprint_create",
  "既存の READY タスクを選択してスプリントを作成する",
  {
    goal: z.string(),
    taskIds: z.array(z.string()),
  },
  async ({ goal, taskIds }) => {
    const result = await withAudit("sprint_create", { goal, taskCount: taskIds.length }, () =>
      sprintCreate(store, { goal, taskIds })
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- sprint_add_tasks ---
server.tool(
  "sprint_add_tasks",
  "PLANNING 中のスプリントにタスクを追加する",
  {
    sprintId: z.string(),
    taskIds: z.array(z.string()),
  },
  async ({ sprintId, taskIds }) => {
    const result = await withAudit("sprint_add_tasks", { sprintId, taskCount: taskIds.length }, () =>
      sprintAddTasks(store, { sprintId, taskIds })
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- sprint_complete ---
server.tool(
  "sprint_complete",
  "スプリントを完了する（DONE タスクは自動アーカイブ）",
  { sprintId: z.string() },
  async ({ sprintId }) => {
    const result = await withAudit("sprint_complete", { sprintId }, () =>
      sprintComplete(store, { sprintId })
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- sprint_carry_over ---
server.tool(
  "sprint_carry_over",
  "完了/中止スプリントの未完了タスクを READY に戻す（持ち越し）",
  {
    sprintId: z.string(),
    taskIds: z.array(z.string()).optional(),
  },
  async ({ sprintId, taskIds }) => {
    const result = await withAudit("sprint_carry_over", { sprintId, taskIds }, () =>
      sprintCarryOver(store, { sprintId, taskIds })
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- sprint_cancel ---
server.tool(
  "sprint_cancel",
  "スプリントを中止する",
  {
    sprintId: z.string(),
    reason: z.string(),
  },
  async ({ sprintId, reason }) => {
    const result = await withAudit("sprint_cancel", { sprintId, reason }, () =>
      sprintCancel(store, { sprintId, reason })
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- task_create ---
server.tool(
  "task_create",
  "タスクを作成する（UUID ベースの一意 ID）",
  {
    title: z.string(),
    description: z.string(),
    acceptanceCriteria: z.array(z.string()),
    priority: prioritySchema,
    points: z.number().optional(),
  },
  async ({ title, description, acceptanceCriteria, priority, points }) => {
    const result = await withAudit("task_create", { title, priority, points }, () =>
      taskCreate(store, { title, description, acceptanceCriteria, priority, points })
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- task_update ---
server.tool(
  "task_update",
  "タスクの状態・優先度・ポイント・担当を更新する",
  {
    taskId: z.string(),
    state: taskStateSchema.optional(),
    priority: prioritySchema.optional(),
    points: z.number().optional(),
    assignee: z.string().nullable().optional(),
  },
  async ({ taskId, state, priority, points, assignee }) => {
    const result = await withAudit("task_update", { taskId, state, priority, points, assignee }, () =>
      taskUpdate(store, { taskId, state, priority, points, assignee })
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- github_sync ---
server.tool(
  "github_sync",
  "タスクをGitHub Issueと同期する",
  {
    taskId: z.string(),
    action: z.enum(["create", "update", "close"]),
  },
  async ({ taskId, action }) => {
    const result = await withAudit("github_sync", { taskId, action }, () =>
      githubSync(store, { taskId, action })
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- metrics_report ---
server.tool(
  "metrics_report",
  "スプリントメトリクス（ポイント含む）を取得する",
  {
    sprintId: z.string().optional(),
  },
  async ({ sprintId }) => {
    const result = await withAudit("metrics_report", { sprintId }, () =>
      metricsReport(store, { sprintId })
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- velocity_report ---
server.tool(
  "velocity_report",
  "スプリント横断のベロシティレポートを取得する",
  {
    lastN: z.number().optional(),
  },
  async ({ lastN }) => {
    const result = await withAudit("velocity_report", { lastN }, () =>
      velocityReport(store, { lastN })
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- wip_status ---
server.tool(
  "wip_status",
  "WIP状態を確認する（スプリントスコープ）",
  {
    sprintId: z.string().optional(),
  },
  async ({ sprintId }) => {
    const result = await withAudit("wip_status", { sprintId }, () =>
      wipStatus(store, { sprintId })
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- list_tasks ---
server.tool(
  "list_tasks",
  "タスクをフィルタ付きで一覧表示する",
  {
    state: taskStateSchema.optional(),
    priority: prioritySchema.optional(),
    assignee: z.string().optional(),
    sprintId: z.string().optional(),
    includeArchived: z.boolean().optional(),
  },
  async ({ state, priority, assignee, sprintId, includeArchived }) => {
    const result = await withAudit("list_tasks", { state, priority, assignee, sprintId, includeArchived }, () =>
      listTasks(store, { state, priority, assignee, sprintId, includeArchived })
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- get_task ---
server.tool(
  "get_task",
  "タスクの詳細情報を取得する（アーカイブ済みも検索）",
  { taskId: z.string() },
  async ({ taskId }) => {
    const result = await withAudit("get_task", { taskId }, () =>
      getTask(store, { taskId })
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- project_status ---
server.tool("project_status", "プロジェクト全体の状況を取得する", {}, async () => {
  const result = await withAudit("project_status", {}, () =>
    projectStatus(store)
  );
  // ダッシュボードファイルも更新
  if (result.ok && result.message) {
    await writeDashboard(STATE_FILE, result.message);
  }
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
});

// --- ceremony_report ---
const reportTypeSchema = z.enum([
  "refinement",
  "planning",
  "sprint",
  "review",
  "retro",
  "pipeline",
]);

server.tool(
  "ceremony_report",
  "セレモニーの結果をレポートとして保存する",
  {
    type: reportTypeSchema,
    content: z.string(),
  },
  async ({ type, content }) => {
    const result = await withAudit("ceremony_report", { type }, () =>
      ceremonyReport(store, { type, content })
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- Start server ---
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("scrum-mcp server started");
