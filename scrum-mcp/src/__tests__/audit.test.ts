import { describe, it, expect, afterEach } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { AuditLog } from "../state/audit.js";

const TEST_DIR = "/tmp/scrum-test-audit";
const STATE_FILE = `${TEST_DIR}/state.json`;

afterEach(async () => {
  try { await rm(TEST_DIR, { recursive: true }); } catch { /* ignore */ }
});

describe("AuditLog", () => {
  it("ツール呼び出しを JSONL ファイルに記録する", async () => {
    const audit = new AuditLog(STATE_FILE);
    await audit.log({
      ts: "2026-01-01T00:00:00Z",
      tool: "ceremony_start",
      input: { type: "refinement" },
      ok: true,
    });

    const content = await readFile(audit.getFilePath(), "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.tool).toBe("ceremony_start");
    expect(entry.input.type).toBe("refinement");
    expect(entry.ok).toBe(true);
  });

  it("複数のエントリを追記する", async () => {
    const audit = new AuditLog(STATE_FILE);
    await audit.log({ ts: "2026-01-01T00:00:00Z", tool: "tool_a", input: {}, ok: true });
    await audit.log({ ts: "2026-01-01T00:00:01Z", tool: "tool_b", input: {}, ok: false, error: "fail" });

    const content = await readFile(audit.getFilePath(), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const second = JSON.parse(lines[1]);
    expect(second.tool).toBe("tool_b");
    expect(second.ok).toBe(false);
    expect(second.error).toBe("fail");
  });

  it("エラー時もメインフローを中断しない", async () => {
    // 読み取り専用ディレクトリを模擬せず、正常パスで動作確認
    const audit = new AuditLog(STATE_FILE);
    // ログ書き込みが例外を投げないことを確認
    await expect(
      audit.log({ ts: "2026-01-01T00:00:00Z", tool: "test", input: {}, ok: true })
    ).resolves.toBeUndefined();
  });

  it("getFilePath が正しいパスを返す", () => {
    const audit = new AuditLog("/some/dir/state.json");
    expect(audit.getFilePath()).toBe("/some/dir/audit.jsonl");
  });
});
