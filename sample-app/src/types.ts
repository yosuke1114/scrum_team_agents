export type TaskStatus = "todo" | "doing" | "done";
export type TaskPriority = "high" | "medium" | "low";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskStore {
  tasks: Task[];
  nextId: number;
}

export const DEFAULT_STORE: TaskStore = {
  tasks: [],
  nextId: 1,
};
