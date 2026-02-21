// --- Enum Types (Union Types) ---

export type CeremonyType = "refinement" | "planning" | "sprint" | "review" | "retro";

export type CeremonyState =
  | "IDLE"
  | "REFINEMENT"
  | "PLANNING"
  | "SPRINT_ACTIVE"
  | "SPRINT_REVIEW"
  | "RETROSPECTIVE";

export type TaskState =
  | "BACKLOG" | "READY" | "TODO"
  | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "BLOCKED";

export type Priority = "high" | "medium" | "low";

export type SprintState = "PLANNING" | "ACTIVE" | "COMPLETED" | "CANCELLED";

// --- Core Models ---

export interface Task {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  state: TaskState;
  priority: Priority;
  points: number | null;
  assignee: string | null;
  githubIssueNumber: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Sprint {
  id: string;
  number: number;
  goal: string;
  tasks: string[];
  state: SprintState;
  startedAt: string | null;
  completedAt: string | null;
  metrics?: SprintMetrics;
}

export interface WipLimits {
  inProgress: number;
  inReview: number;
}

export interface ScrumConfig {
  githubRepo: string;
  projectName: string;
}

// --- State ---

export interface ScrumState {
  currentCeremony: CeremonyType | null;
  ceremonyState: CeremonyState;
  currentSprint: Sprint | null;
  sprints: Sprint[];
  tasks: Record<string, Task>;
  archivedTasks: Record<string, Task>;
  wipLimits: WipLimits;
  config: ScrumConfig;
}

// --- Tool Input Types ---

export interface CeremonyStartInput {
  type: CeremonyType;
}

export interface CeremonyEndInput {
  type: CeremonyType;
}

export interface SprintCreateInput {
  goal: string;
  taskIds: string[];
}

export interface SprintAddTasksInput {
  sprintId: string;
  taskIds: string[];
}

export interface SprintCompleteInput {
  sprintId: string;
}

export interface SprintCarryOverInput {
  sprintId: string;
  taskIds?: string[];
}

export interface SprintCancelInput {
  sprintId: string;
  reason: string;
}

export interface TaskCreateInput {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: Priority;
  points?: number;
}

export interface TaskUpdateInput {
  taskId: string;
  state?: TaskState;
  priority?: Priority;
  points?: number;
  assignee?: string | null;
}

export interface GithubSyncInput {
  taskId: string;
  action: "create" | "update" | "close";
}

export interface MetricsReportInput {
  sprintId?: string;
}

export interface VelocityReportInput {
  lastN?: number;
}

export interface WipStatusInput {
  sprintId?: string;
}

// --- Tool Output Types ---

export interface ToolResult<T = unknown> {
  ok: boolean;
  message?: string;
  error?: string;
  data?: T;
}

export interface SprintMetrics {
  sprintId: string;
  totalTasks: number;
  completedTasks: number;
  totalPoints: number;
  completedPoints: number;
  completionRate: number;
  tasksByState: Partial<Record<TaskState, number>>;
  tasksByPriority: Partial<Record<Priority, number>>;
}

export interface WipStatus {
  inProgress: number;
  inReview: number;
  limits: WipLimits;
  warning?: string;
}

export interface VelocityData {
  sprints: Array<{
    id: string;
    number: number;
    goal: string;
    completedPoints: number;
    totalPoints: number;
    completedTasks: number;
    totalTasks: number;
  }>;
  averageVelocity: number;
  averageCompletionRate: number;
}

// --- State Transition Maps (Constants) ---

export const CEREMONY_STATE_MAP: Record<CeremonyType, CeremonyState> = {
  refinement: "REFINEMENT",
  planning: "PLANNING",
  sprint: "SPRINT_ACTIVE",
  review: "SPRINT_REVIEW",
  retro: "RETROSPECTIVE",
};

export const VALID_TRANSITIONS: Record<CeremonyState, CeremonyState[]> = {
  IDLE: ["REFINEMENT", "PLANNING"],
  REFINEMENT: ["IDLE", "PLANNING"],
  PLANNING: ["IDLE", "SPRINT_ACTIVE"],
  SPRINT_ACTIVE: ["SPRINT_REVIEW"],
  SPRINT_REVIEW: ["RETROSPECTIVE"],
  RETROSPECTIVE: ["IDLE"],
};

export const VALID_TASK_TRANSITIONS: Record<TaskState, TaskState[]> = {
  BACKLOG: ["READY"],
  READY: ["TODO", "BACKLOG"],
  TODO: ["IN_PROGRESS", "BLOCKED", "BACKLOG"],
  IN_PROGRESS: ["IN_REVIEW", "BLOCKED", "TODO"],
  IN_REVIEW: ["DONE", "IN_PROGRESS", "BLOCKED"],
  DONE: [],
  BLOCKED: ["TODO", "IN_PROGRESS"],
};

export const GITHUB_LABELS: Record<TaskState, { name: string; color: string }> = {
  BACKLOG: { name: "backlog", color: "808080" },
  READY: { name: "ready", color: "0052CC" },
  TODO: { name: "todo", color: "00B8D9" },
  IN_PROGRESS: { name: "in-progress", color: "FFC400" },
  IN_REVIEW: { name: "in-review", color: "9B59B6" },
  DONE: { name: "done", color: "2ECC71" },
  BLOCKED: { name: "blocked", color: "E74C3C" },
};

// --- Default State ---

export const DEFAULT_STATE: ScrumState = {
  currentCeremony: null,
  ceremonyState: "IDLE",
  currentSprint: null,
  sprints: [],
  tasks: {},
  archivedTasks: {},
  wipLimits: { inProgress: 2, inReview: 1 },
  config: { githubRepo: "", projectName: "scrum-team" },
};
