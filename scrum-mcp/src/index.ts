import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { StateStore } from "./state/store.js";
import { ceremonyStart, ceremonyEnd } from "./tools/ceremony.js";
import { sprintCreate, sprintComplete } from "./tools/sprint.js";
import { taskCreate, taskUpdate } from "./tools/task.js";
import { githubSync } from "./tools/github.js";
import { metricsReport } from "./tools/metrics.js";
import { wipStatus } from "./tools/wip.js";

const STATE_FILE = process.env.SCRUM_STATE_FILE ?? ".scrum/state.json";

const store = await StateStore.init(STATE_FILE);

const server = new McpServer({
  name: "scrum-mcp",
  version: "0.1.0",
});

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

// --- ceremony_start ---
server.tool(
  "ceremony_start",
  "セレモニーを開始する",
  { type: ceremonyTypeSchema },
  async ({ type }) => {
    const result = await ceremonyStart(store, { type });
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
    const result = await ceremonyEnd(store, { type });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- sprint_create ---
server.tool(
  "sprint_create",
  "スプリントを作成する",
  {
    goal: z.string(),
    tasks: z.array(
      z.object({
        title: z.string(),
        description: z.string(),
        acceptanceCriteria: z.array(z.string()),
        priority: prioritySchema,
      })
    ),
  },
  async ({ goal, tasks }) => {
    const result = await sprintCreate(store, { goal, tasks });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- sprint_complete ---
server.tool(
  "sprint_complete",
  "スプリントを完了する",
  { sprintId: z.string() },
  async ({ sprintId }) => {
    const result = await sprintComplete(store, { sprintId });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- task_create ---
server.tool(
  "task_create",
  "タスクを作成する",
  {
    title: z.string(),
    description: z.string(),
    acceptanceCriteria: z.array(z.string()),
    priority: prioritySchema,
  },
  async ({ title, description, acceptanceCriteria, priority }) => {
    const result = await taskCreate(store, {
      title,
      description,
      acceptanceCriteria,
      priority,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- task_update ---
server.tool(
  "task_update",
  "タスクの状態を更新する",
  {
    taskId: z.string(),
    state: taskStateSchema,
    assignee: z.string().nullable().optional(),
  },
  async ({ taskId, state, assignee }) => {
    const result = await taskUpdate(store, { taskId, state, assignee });
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
    const result = await githubSync(store, { taskId, action });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- metrics_report ---
server.tool(
  "metrics_report",
  "スプリントメトリクスを取得する",
  {
    sprintId: z.string().optional(),
  },
  async ({ sprintId }) => {
    const result = await metricsReport(store, { sprintId });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// --- wip_status ---
server.tool("wip_status", "WIP状態を確認する", {}, async () => {
  const result = await wipStatus(store);
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
});

// --- Start server ---
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("scrum-mcp server started");
