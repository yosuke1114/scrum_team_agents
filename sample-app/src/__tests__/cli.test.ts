import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink } from "node:fs/promises";
import { run } from "../cli.js";

const TEST_FILE = "/tmp/task-cli-test-cli.json";

beforeEach(async () => {
  try {
    await unlink(TEST_FILE);
  } catch {
    // ignore
  }
});

afterEach(async () => {
  try {
    await unlink(TEST_FILE);
  } catch {
    // ignore
  }
});

describe("CLI", () => {
  it("shows help for unknown command", async () => {
    const output = await run(["unknown"], TEST_FILE);
    expect(output).toContain("Unknown command");
  });

  it("shows help", async () => {
    const output = await run(["help"], TEST_FILE);
    expect(output).toContain("task-cli");
  });

  it("adds and lists tasks", async () => {
    const add = await run(["add", "Buy", "milk", "--priority", "high"], TEST_FILE);
    expect(add).toContain("Created");
    expect(add).toContain("T-1");

    const list = await run(["list"], TEST_FILE);
    expect(list).toContain("Buy milk");
  });

  it("moves task through workflow", async () => {
    await run(["add", "Test", "task"], TEST_FILE);
    const doOutput = await run(["do", "T-1"], TEST_FILE);
    expect(doOutput).toContain("Started");

    const doneOutput = await run(["done", "T-1"], TEST_FILE);
    expect(doneOutput).toContain("Completed");
  });

  it("removes a task", async () => {
    await run(["add", "Remove", "me"], TEST_FILE);
    const output = await run(["remove", "T-1"], TEST_FILE);
    expect(output).toContain("Removed");

    const list = await run(["list"], TEST_FILE);
    expect(list).toContain("No tasks found");
  });

  it("shows stats", async () => {
    await run(["add", "Task 1"], TEST_FILE);
    await run(["add", "Task 2"], TEST_FILE);
    await run(["done", "T-1"], TEST_FILE);

    const output = await run(["stats"], TEST_FILE);
    expect(output).toContain("Total: 2");
  });

  it("filters by status", async () => {
    await run(["add", "Todo task"], TEST_FILE);
    await run(["add", "Done task"], TEST_FILE);
    await run(["done", "T-2"], TEST_FILE);

    const output = await run(["list", "--status", "done"], TEST_FILE);
    expect(output).toContain("Done task");
    expect(output).not.toContain("Todo task");
  });

  it("adds with tags", async () => {
    await run(["add", "Tagged", "--tags", "api,backend"], TEST_FILE);
    const output = await run(["list", "--tag", "api"], TEST_FILE);
    expect(output).toContain("Tagged");
  });

  it("errors on add without title", async () => {
    const output = await run(["add"], TEST_FILE);
    expect(output).toContain("Error");
  });

  it("errors on do without id", async () => {
    const output = await run(["do"], TEST_FILE);
    expect(output).toContain("Error");
  });
});
