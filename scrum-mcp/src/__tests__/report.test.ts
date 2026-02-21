import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink, readFile, rm } from "node:fs/promises";
import { StateStore } from "../state/store.js";
import { ceremonyReport } from "../tools/report.js";

const TEST_FILE = "/tmp/scrum-test-report-state.json";

let store: StateStore;

beforeEach(async () => {
  process.env.SCRUM_STATE_FILE = TEST_FILE;
  store = await StateStore.init(TEST_FILE);
});

afterEach(async () => {
  delete process.env.SCRUM_STATE_FILE;
  try {
    await unlink(TEST_FILE);
  } catch { /* ignore */ }
  try {
    await rm("/tmp/reports", { recursive: true });
  } catch { /* ignore */ }
});

describe("ceremony_report", () => {
  it("レポートをファイルに保存できる", async () => {
    const result = await ceremonyReport(store, {
      type: "refinement",
      content: "## KPT\n\n### Keep\n- テスト駆動開発",
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("レポート");
    const data = result.data as { filePath: string; fileName: string };
    expect(data.fileName).toContain("refinement");

    const content = await readFile(data.filePath, "utf-8");
    expect(content).toContain("# Refinement Report");
    expect(content).toContain("テスト駆動開発");
  });

  it("スプリント ID がファイル名に含まれる", async () => {
    await store.update((s) => {
      s.currentSprint = {
        id: "sprint-1",
        number: 1,
        goal: "test",
        tasks: [],
        state: "ACTIVE",
        startedAt: new Date().toISOString(),
        completedAt: null,
      };
    });

    const result = await ceremonyReport(store, {
      type: "review",
      content: "Sprint review content",
    });

    const data = result.data as { fileName: string };
    expect(data.fileName).toContain("sprint-1");
    expect(data.fileName).toContain("review");
  });

  it("ヘッダーにメタ情報が含まれる", async () => {
    const result = await ceremonyReport(store, {
      type: "retro",
      content: "Retro content",
    });

    const data = result.data as { filePath: string };
    const content = await readFile(data.filePath, "utf-8");
    expect(content).toContain("**Sprint**");
    expect(content).toContain("**Date**");
    expect(content).toContain("**Ceremony State**");
  });

  it("pipeline タイプのレポートを保存できる", async () => {
    const result = await ceremonyReport(store, {
      type: "pipeline",
      content: "## Pipeline Summary\n\n- Refinement: OK\n- Planning: OK",
    });

    expect(result.ok).toBe(true);
    const data = result.data as { filePath: string; fileName: string };
    expect(data.fileName).toContain("pipeline");

    const content = await readFile(data.filePath, "utf-8");
    expect(content).toContain("# Pipeline Report");
    expect(content).toContain("Pipeline Summary");
  });
});
