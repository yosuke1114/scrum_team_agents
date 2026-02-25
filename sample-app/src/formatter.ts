import type { Task } from "./types.js";

const STATUS_ICONS: Record<string, string> = {
  todo: "[ ]",
  doing: "[~]",
  done: "[x]",
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "\x1b[31m",
  medium: "\x1b[33m",
  low: "\x1b[36m",
};

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

export function formatTask(task: Task): string {
  const icon = STATUS_ICONS[task.status] ?? "[ ]";
  const color = PRIORITY_COLORS[task.priority] ?? "";
  const tags = task.tags.length > 0 ? ` ${DIM}[${task.tags.join(", ")}]${RESET}` : "";
  return `${icon} ${color}${task.id}${RESET} ${task.title}${tags}`;
}

export function formatTaskList(tasks: Task[]): string {
  if (tasks.length === 0) return "No tasks found.";
  return tasks.map(formatTask).join("\n");
}

export function formatStats(stats: { total: number; todo: number; doing: number; done: number }): string {
  const bar = (count: number, total: number): string => {
    if (total === 0) return "[---------]";
    const filled = Math.round((count / total) * 10);
    return `[${"#".repeat(filled)}${"-".repeat(10 - filled)}]`;
  };

  return [
    `Total: ${stats.total}`,
    `  Todo:  ${stats.todo}  ${bar(stats.todo, stats.total)}`,
    `  Doing: ${stats.doing} ${bar(stats.doing, stats.total)}`,
    `  Done:  ${stats.done}  ${bar(stats.done, stats.total)}`,
  ].join("\n");
}
