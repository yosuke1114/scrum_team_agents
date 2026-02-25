import type { TaskPriority, TaskStatus } from "./types.js";
import { Store } from "./store.js";
import { formatTaskList, formatStats } from "./formatter.js";

const HELP = `
task-cli - Simple task management

Usage:
  task-cli add <title> [--priority high|medium|low] [--tags tag1,tag2]
  task-cli list [--status todo|doing|done] [--priority high|medium|low] [--tag name]
  task-cli do <id>          Move task to "doing"
  task-cli done <id>        Move task to "done"
  task-cli remove <id>      Remove a task
  task-cli stats            Show task statistics
  task-cli help             Show this help
`.trim();

function parseArgs(args: string[]): { command: string; positional: string[]; flags: Record<string, string> } {
  const command = args[0] ?? "help";
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[++i] ?? "";
      flags[key] = value;
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

export async function run(args: string[], storePath: string): Promise<string> {
  const store = await Store.load(storePath);
  const { command, positional, flags } = parseArgs(args);

  switch (command) {
    case "add": {
      const title = positional.join(" ");
      if (!title) return "Error: title is required.\n\n" + HELP;
      const priority = (flags.priority ?? "medium") as TaskPriority;
      const tags = flags.tags ? flags.tags.split(",").map((t) => t.trim()) : [];
      const task = await store.add(title, priority, tags);
      return `Created: ${task.id} "${task.title}"`;
    }

    case "list": {
      const filter: { status?: TaskStatus; priority?: TaskPriority; tag?: string } = {};
      if (flags.status) filter.status = flags.status as TaskStatus;
      if (flags.priority) filter.priority = flags.priority as TaskPriority;
      if (flags.tag) filter.tag = flags.tag;
      const tasks = store.list(filter);
      return formatTaskList(tasks);
    }

    case "do": {
      const id = positional[0];
      if (!id) return "Error: task ID is required.";
      const task = await store.updateStatus(id, "doing");
      return `Started: ${task.id} "${task.title}"`;
    }

    case "done": {
      const id = positional[0];
      if (!id) return "Error: task ID is required.";
      const task = await store.updateStatus(id, "done");
      return `Completed: ${task.id} "${task.title}"`;
    }

    case "remove": {
      const id = positional[0];
      if (!id) return "Error: task ID is required.";
      await store.remove(id);
      return `Removed: ${id}`;
    }

    case "stats": {
      const s = store.stats();
      return formatStats(s);
    }

    case "help":
      return HELP;

    default:
      return `Unknown command: ${command}\n\n${HELP}`;
  }
}
