// --- Enum Types (Union Types) ---

export type CeremonyType = "refinement" | "planning" | "sprint" | "review" | "retro";

export type CeremonyState =
  | "IDLE"
  | "REFINEMENT"
  | "PLANNING"
  | "SPRINT_ACTIVE"
  | "SPRINT_REVIEW"
  | "RETROSPECTIVE";

export type Phase = "PLAN" | "EXECUTE" | "EVALUATE" | "LEARN";

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
  completedInSprintId: string | null;
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

// --- OODA Types (L2) ---

export interface OodaObservation {
  sprintProgress: number;
  wipStatus: { inProgress: number; inReview: number };
  blockers: string[];
  recentTransitions: Array<{ taskId: string; from: TaskState; to: TaskState; at: string }>;
  timestamp: string;
}

export interface OodaSignal {
  type: string;
  severity: "info" | "warn" | "critical";
  detail: string;
}

export interface OodaCycle {
  id: string;
  sprintId: string;
  trigger: "task_transition" | "blocker" | "wip_threshold" | "manual";
  observe: OodaObservation;
  orient: { signals: OodaSignal[]; patterns: string[] };
  decide: {
    recommendations: Array<{ action: string; priority: number; rationale: string }>;
    selected: string | null;
  };
  outcome: "success" | "partial" | "failed" | null;
  createdAt: string;
}

// --- Meta-cognition Types (L3) ---

export type ReflectionTrigger = "low_completion" | "blocker" | "repeated_pattern" | "phase_end";

export interface Reflection {
  id: string;
  sprintId: string;
  trigger: ReflectionTrigger;
  what: string;
  why: string;
  action: string;
  effectiveness: "effective" | "ineffective" | null;
  createdAt: string;
}

export type KnowledgeCategory = "pattern" | "antipattern" | "technique" | "constraint";

export interface KnowledgeEntry {
  id: string;
  category: KnowledgeCategory;
  insight: string;
  sourceSprintIds: string[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

// --- State ---

export interface ScrumState {
  // L1: Phase management (primary control flow)
  phase: Phase;
  phaseEnteredAt: string;

  // Legacy: Ceremony (backward compat, synced from phase)
  currentCeremony: CeremonyType | null;
  ceremonyState: CeremonyState;

  // Sprint lifecycle
  currentSprint: Sprint | null;
  sprints: Sprint[];
  tasks: Record<string, Task>;
  archivedTasks: Record<string, Task>;
  wipLimits: WipLimits;
  config: ScrumConfig;

  // L2: OODA cycles
  oodaCycles: OodaCycle[];

  // L3: Meta-cognition
  reflections: Reflection[];
  knowledge: KnowledgeEntry[];
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
  autoActivate?: boolean;
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

/** Phase ↔ CeremonyState mapping */
export const PHASE_CEREMONY_MAP: Record<Phase, CeremonyState[]> = {
  PLAN: ["IDLE", "REFINEMENT", "PLANNING"],
  EXECUTE: ["SPRINT_ACTIVE"],
  EVALUATE: ["SPRINT_REVIEW"],
  LEARN: ["RETROSPECTIVE"],
};

export function ceremonyStateToPhase(cs: CeremonyState): Phase {
  for (const [phase, states] of Object.entries(PHASE_CEREMONY_MAP)) {
    if (states.includes(cs)) return phase as Phase;
  }
  return "PLAN";
}

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
  phase: "PLAN",
  phaseEnteredAt: new Date().toISOString(),
  currentCeremony: null,
  ceremonyState: "IDLE",
  currentSprint: null,
  sprints: [],
  tasks: {},
  archivedTasks: {},
  wipLimits: { inProgress: 2, inReview: 1 },
  config: { githubRepo: "", projectName: "scrum-team" },
  oodaCycles: [],
  reflections: [],
  knowledge: [],
};
