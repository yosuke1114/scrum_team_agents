import { describe, it, expect } from "vitest";
import { formatTask, formatTaskList, formatStats } from "../formatter.js";
import type { Task } from "../types.js";

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "T-1",
  title: "Test task",
  status: "todo",
  priority: "medium",
  tags: [],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  ...overrides,
});

describe("formatter", () => {
  it("formats a todo task", () => {
    const output = formatTask(makeTask());
    expect(output).toContain("[ ]");
    expect(output).toContain("T-1");
    expect(output).toContain("Test task");
  });

  it("formats a doing task", () => {
    const output = formatTask(makeTask({ status: "doing" }));
    expect(output).toContain("[~]");
  });

  it("formats a done task", () => {
    const output = formatTask(makeTask({ status: "done" }));
    expect(output).toContain("[x]");
  });

  it("shows tags", () => {
    const output = formatTask(makeTask({ tags: ["api", "urgent"] }));
    expect(output).toContain("api");
    expect(output).toContain("urgent");
  });

  it("formats empty list", () => {
    expect(formatTaskList([])).toBe("No tasks found.");
  });

  it("formats multiple tasks", () => {
    const tasks = [makeTask({ id: "T-1" }), makeTask({ id: "T-2", title: "Other" })];
    const output = formatTaskList(tasks);
    expect(output).toContain("T-1");
    expect(output).toContain("T-2");
  });

  it("formats stats with progress bars", () => {
    const output = formatStats({ total: 10, todo: 3, doing: 3, done: 4 });
    expect(output).toContain("Total: 10");
    expect(output).toContain("Todo:");
    expect(output).toContain("Doing:");
    expect(output).toContain("Done:");
    expect(output).toContain("#");
  });

  it("formats stats with zero total", () => {
    const output = formatStats({ total: 0, todo: 0, doing: 0, done: 0 });
    expect(output).toContain("Total: 0");
    expect(output).toContain("---------");
  });
});
