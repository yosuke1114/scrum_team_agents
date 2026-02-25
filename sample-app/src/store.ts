import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Task, TaskStore, TaskStatus, TaskPriority } from "./types.js";
import { DEFAULT_STORE } from "./types.js";

export class Store {
  private data: TaskStore;
  private filePath: string;

  private constructor(filePath: string, data: TaskStore) {
    this.filePath = filePath;
    this.data = data;
  }

  static async load(filePath: string): Promise<Store> {
    try {
      const raw = await readFile(filePath, "utf-8");
      const data = JSON.parse(raw) as TaskStore;
      return new Store(filePath, data);
    } catch {
      return new Store(filePath, structuredClone(DEFAULT_STORE));
    }
  }

  private async save(): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp.${process.pid}`;
    await writeFile(tmp, JSON.stringify(this.data, null, 2), "utf-8");
    await rename(tmp, this.filePath);
  }

  async add(title: string, priority: TaskPriority = "medium", tags: string[] = []): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: `T-${this.data.nextId}`,
      title,
      status: "todo",
      priority,
      tags,
      createdAt: now,
      updatedAt: now,
    };
    this.data.tasks.push(task);
    this.data.nextId++;
    await this.save();
    return task;
  }

  async updateStatus(id: string, status: TaskStatus): Promise<Task> {
    const task = this.data.tasks.find((t) => t.id === id);
    if (!task) throw new Error(`Task ${id} not found`);
    task.status = status;
    task.updatedAt = new Date().toISOString();
    await this.save();
    return task;
  }

  async remove(id: string): Promise<void> {
    const idx = this.data.tasks.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`Task ${id} not found`);
    this.data.tasks.splice(idx, 1);
    await this.save();
  }

  list(filter?: { status?: TaskStatus; priority?: TaskPriority; tag?: string }): Task[] {
    let result = [...this.data.tasks];
    if (filter?.status) {
      result = result.filter((t) => t.status === filter.status);
    }
    if (filter?.priority) {
      result = result.filter((t) => t.priority === filter.priority);
    }
    if (filter?.tag) {
      result = result.filter((t) => t.tags.includes(filter.tag!));
    }
    return result;
  }

  find(id: string): Task | undefined {
    return this.data.tasks.find((t) => t.id === id);
  }

  stats(): { total: number; todo: number; doing: number; done: number } {
    const tasks = this.data.tasks;
    return {
      total: tasks.length,
      todo: tasks.filter((t) => t.status === "todo").length,
      doing: tasks.filter((t) => t.status === "doing").length,
      done: tasks.filter((t) => t.status === "done").length,
    };
  }
}
