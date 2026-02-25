import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { unlink } from "node:fs/promises";
import { StateStore } from "../state/store.js";
import { githubSync } from "../tools/github.js";
import * as childProcess from "node:child_process";

const TEST_FILE = "/tmp/scrum-test-github-state.json";

// gh コマンドをモック
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof childProcess>("node:child_process");
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

const { execFile: mockExecFile } = vi.mocked(childProcess);

function setupExecFileMock(responses: Record<string, { stdout: string; stderr: string }>) {
  mockExecFile.mockImplementation((_cmd: string, args?: readonly string[] | null, ..._rest: unknown[]) => {
    const argsArr = args as string[] | undefined;
    // gh issue create → return URL
    if (argsArr?.[0] === "issue" && argsArr?.[1] === "create") {
      const resp = responses["issue_create"] ?? { stdout: "https://github.com/test/repo/issues/42\n", stderr: "" };
      const cb = _rest[_rest.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
      if (typeof cb === "function") {
        cb(null, resp);
      }
      return undefined as any;
    }
    // gh issue edit → success
    if (argsArr?.[0] === "issue" && argsArr?.[1] === "edit") {
      const cb = _rest[_rest.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
      if (typeof cb === "function") {
        cb(null, { stdout: "", stderr: "" });
      }
      return undefined as any;
    }
    // gh issue close → success
    if (argsArr?.[0] === "issue" && argsArr?.[1] === "close") {
      const cb = _rest[_rest.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
      if (typeof cb === "function") {
        cb(null, { stdout: "", stderr: "" });
      }
      return undefined as any;
    }
    // gh label create → success
    if (argsArr?.[0] === "label" && argsArr?.[1] === "create") {
      const cb = _rest[_rest.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
      if (typeof cb === "function") {
        cb(null, { stdout: "", stderr: "" });
      }
      return undefined as any;
    }
    // default
    const cb = _rest[_rest.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
    if (typeof cb === "function") {
      cb(null, { stdout: "", stderr: "" });
    }
    return undefined as any;
  });
}

let store: StateStore;

beforeEach(async () => {
  store = await StateStore.init(TEST_FILE);
  // githubRepo を設定
  await store.update((s) => {
    s.config.githubRepo = "test-owner/test-repo";
  });
  vi.clearAllMocks();
});

afterEach(async () => {
  try { await unlink(TEST_FILE); } catch { /* ignore */ }
});

describe("github_sync", () => {
  it("githubRepo 未設定でエラーを返す", async () => {
    await store.update((s) => { s.config.githubRepo = ""; });
    await store.update((s) => {
      s.tasks["task-1"] = {
        id: "task-1", title: "Test", description: "desc",
        acceptanceCriteria: ["AC1"], state: "BACKLOG", priority: "high",
        assignee: null, githubIssueNumber: null, points: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
    });
    const result = await githubSync(store, { taskId: "task-1", action: "create" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("GitHub リポジトリが設定されていません");
  });

  it("存在しないタスク ID でエラーを返す", async () => {
    const result = await githubSync(store, { taskId: "nonexistent", action: "create" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("見つかりません");
  });

  it("create アクションで Issue を作成し、番号を保存する", async () => {
    setupExecFileMock({
      issue_create: { stdout: "https://github.com/test/repo/issues/42\n", stderr: "" },
    });
    await store.update((s) => {
      s.tasks["task-1"] = {
        id: "task-1", title: "Test Task", description: "Do the thing",
        acceptanceCriteria: ["It works", "Tests pass"], state: "BACKLOG", priority: "high",
        assignee: null, githubIssueNumber: null, points: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
    });

    const result = await githubSync(store, { taskId: "task-1", action: "create" });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("#42");
    expect((result.data as any).issueNumber).toBe(42);

    // state に保存されていることを確認
    const state = store.getState();
    expect(state.tasks["task-1"].githubIssueNumber).toBe(42);
  });

  it("update アクションで Issue 未紐づけ時にエラーを返す", async () => {
    setupExecFileMock({});
    await store.update((s) => {
      s.tasks["task-1"] = {
        id: "task-1", title: "Test", description: "desc",
        acceptanceCriteria: ["AC1"], state: "IN_PROGRESS", priority: "medium",
        assignee: "dev", githubIssueNumber: null, points: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
    });
    const result = await githubSync(store, { taskId: "task-1", action: "update" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("GitHub Issue が紐づいていません");
  });

  it("update アクションでラベルを更新する", async () => {
    setupExecFileMock({});
    await store.update((s) => {
      s.tasks["task-1"] = {
        id: "task-1", title: "Test", description: "desc",
        acceptanceCriteria: ["AC1"], state: "IN_PROGRESS", priority: "medium",
        assignee: "dev", githubIssueNumber: 42, points: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
    });
    const result = await githubSync(store, { taskId: "task-1", action: "update" });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("#42");
    expect(result.message).toContain("in-progress");
  });

  it("close アクションで Issue 未紐づけ時にエラーを返す", async () => {
    setupExecFileMock({});
    await store.update((s) => {
      s.tasks["task-1"] = {
        id: "task-1", title: "Test", description: "desc",
        acceptanceCriteria: ["AC1"], state: "DONE", priority: "low",
        assignee: "dev", githubIssueNumber: null, points: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
    });
    const result = await githubSync(store, { taskId: "task-1", action: "close" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("GitHub Issue が紐づいていません");
  });

  it("close アクションで Issue をクローズする", async () => {
    setupExecFileMock({});
    await store.update((s) => {
      s.tasks["task-1"] = {
        id: "task-1", title: "Test", description: "desc",
        acceptanceCriteria: ["AC1"], state: "DONE", priority: "low",
        assignee: "dev", githubIssueNumber: 42, points: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
    });
    const result = await githubSync(store, { taskId: "task-1", action: "close" });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("#42");
    expect(result.message).toContain("クローズ");
  });

  it("gh コマンド失敗時にエラーを返す", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args?: readonly string[] | null, ..._rest: unknown[]) => {
      const cb = _rest[_rest.length - 1] as (err: Error | null, result: unknown) => void;
      if (typeof cb === "function") {
        cb(new Error("gh: command not found"), null);
      }
      return undefined as any;
    });
    await store.update((s) => {
      s.tasks["task-1"] = {
        id: "task-1", title: "Test", description: "desc",
        acceptanceCriteria: ["AC1"], state: "DONE", priority: "low",
        assignee: null, githubIssueNumber: 42, points: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
    });
    const result = await githubSync(store, { taskId: "task-1", action: "close" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("GitHub 操作に失敗しました");
  });
});
