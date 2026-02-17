import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink } from "node:fs/promises";
import { Store } from "../store.js";

const TEST_FILE = "/tmp/task-cli-test-store.json";

let store: Store;

beforeEach(async () => {
  store = await Store.load(TEST_FILE);
});

afterEach(async () => {
  try {
    await unlink(TEST_FILE);
  } catch {
    // ignore
  }
});

describe("Store", () => {
  it("starts empty", () => {
    expect(store.list()).toEqual([]);
    expect(store.stats()).toEqual({ total: 0, todo: 0, doing: 0, done: 0 });
  });

  it("adds a task with defaults", async () => {
    const task = await store.add("Buy milk");
    expect(task.id).toBe("T-1");
    expect(task.title).toBe("Buy milk");
    expect(task.status).toBe("todo");
    expect(task.priority).toBe("medium");
    expect(task.tags).toEqual([]);
  });

  it("adds a task with priority and tags", async () => {
    const task = await store.add("Fix bug", "high", ["backend", "urgent"]);
    expect(task.priority).toBe("high");
    expect(task.tags).toEqual(["backend", "urgent"]);
  });

  it("auto-increments IDs", async () => {
    const t1 = await store.add("Task 1");
    const t2 = await store.add("Task 2");
    expect(t1.id).toBe("T-1");
    expect(t2.id).toBe("T-2");
  });

  it("updates task status", async () => {
    const task = await store.add("Write tests");
    const updated = await store.updateStatus(task.id, "doing");
    expect(updated.status).toBe("doing");
    expect(updated.updatedAt).not.toBe(task.createdAt);
  });

  it("throws on update of non-existent task", async () => {
    await expect(store.updateStatus("T-999", "done")).rejects.toThrow("not found");
  });

  it("removes a task", async () => {
    const task = await store.add("Delete me");
    await store.remove(task.id);
    expect(store.list()).toHaveLength(0);
  });

  it("throws on remove of non-existent task", async () => {
    await expect(store.remove("T-999")).rejects.toThrow("not found");
  });

  it("filters by status", async () => {
    await store.add("Task 1");
    const t2 = await store.add("Task 2");
    await store.updateStatus(t2.id, "doing");

    expect(store.list({ status: "todo" })).toHaveLength(1);
    expect(store.list({ status: "doing" })).toHaveLength(1);
  });

  it("filters by priority", async () => {
    await store.add("Low", "low");
    await store.add("High", "high");
    await store.add("High 2", "high");

    expect(store.list({ priority: "high" })).toHaveLength(2);
    expect(store.list({ priority: "low" })).toHaveLength(1);
  });

  it("filters by tag", async () => {
    await store.add("Tagged", "medium", ["api"]);
    await store.add("Untagged");

    expect(store.list({ tag: "api" })).toHaveLength(1);
    expect(store.list({ tag: "frontend" })).toHaveLength(0);
  });

  it("computes stats correctly", async () => {
    const t1 = await store.add("A");
    const t2 = await store.add("B");
    await store.add("C");
    await store.updateStatus(t1.id, "doing");
    await store.updateStatus(t2.id, "done");

    expect(store.stats()).toEqual({ total: 3, todo: 1, doing: 1, done: 1 });
  });

  it("persists and restores data", async () => {
    await store.add("Persistent task", "high", ["test"]);
    const store2 = await Store.load(TEST_FILE);
    const tasks = store2.list();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Persistent task");
    expect(tasks[0].priority).toBe("high");
  });

  it("finds a task by ID", async () => {
    const task = await store.add("Find me");
    expect(store.find(task.id)).toBeDefined();
    expect(store.find("T-999")).toBeUndefined();
  });
});
