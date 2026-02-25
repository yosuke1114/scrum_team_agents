import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink } from "node:fs/promises";
import { StateStore } from "../state/store.js";
import { reflect, reflectEvaluate, knowledgeUpdate, knowledgeQuery } from "../tools/reflection.js";
import { setPhase } from "../tools/phase.js";

const TEST_FILE = "/tmp/scrum-test-reflection.json";
let store: StateStore;

beforeEach(async () => {
  store = await StateStore.init(TEST_FILE);
});

afterEach(async () => {
  try { await unlink(TEST_FILE); } catch { /* ignore */ }
});

describe("reflect", () => {
  it("振り返りを記録する", async () => {
    const result = await reflect(store, {
      trigger: "phase_end",
      what: "タスク完了率が低い",
      why: "見積もりが甘い",
      action: "次は保守的に見積もる",
    });
    expect(result.ok).toBe(true);
    expect(result.data!.id).toMatch(/^ref-/);
    expect(store.peek().reflections).toHaveLength(1);
  });

  it("EVALUATE フェーズで振り返ると LEARN に自動遷移する", async () => {
    await store.update((s) => setPhase(s, "EVALUATE"));
    await reflect(store, {
      trigger: "phase_end",
      what: "x", why: "y", action: "z",
    });
    expect(store.peek().phase).toBe("LEARN");
  });

  it("LEARN フェーズで振り返ると PLAN に自動遷移する", async () => {
    await store.update((s) => setPhase(s, "LEARN"));
    await reflect(store, {
      trigger: "phase_end",
      what: "x", why: "y", action: "z",
    });
    expect(store.peek().phase).toBe("PLAN");
  });

  it("同種の振り返りを検出する", async () => {
    await reflect(store, { trigger: "low_completion", what: "a", why: "b", action: "c" });
    const r2 = await reflect(store, { trigger: "low_completion", what: "d", why: "e", action: "f" });
    expect(r2.message).toContain("同種の振り返りが過去");
  });

  it("50 件を超えると古い振り返りが削除される", async () => {
    for (let i = 0; i < 55; i++) {
      await reflect(store, { trigger: "phase_end", what: `w-${i}`, why: "y", action: "a" });
    }
    expect(store.peek().reflections).toHaveLength(50);
  });
});

describe("reflect_evaluate", () => {
  it("振り返りの有効性を評価する", async () => {
    const r = await reflect(store, { trigger: "phase_end", what: "x", why: "y", action: "z" });
    const refId = r.data!.id;

    const result = await reflectEvaluate(store, { reflectionId: refId, effectiveness: "effective" });
    expect(result.ok).toBe(true);
    expect(store.peek().reflections[0].effectiveness).toBe("effective");
  });

  it("存在しない振り返りIDではエラー", async () => {
    const result = await reflectEvaluate(store, { reflectionId: "ref-xxx", effectiveness: "effective" });
    expect(result.ok).toBe(false);
  });
});

describe("knowledge_update", () => {
  it("知識エントリを作成する", async () => {
    const result = await knowledgeUpdate(store, {
      category: "pattern",
      insight: "小さなタスクに分割すると完了率が上がる",
    });
    expect(result.ok).toBe(true);
    expect(result.data!.confidence).toBe(0.5);
    expect(store.peek().knowledge).toHaveLength(1);
  });

  it("重複する知識の信頼度を強化する", async () => {
    await knowledgeUpdate(store, { category: "pattern", insight: "テスト重要" });
    const r2 = await knowledgeUpdate(store, { category: "pattern", insight: "テスト重要" });
    expect(r2.ok).toBe(true);
    expect(r2.data!.confidence).toBeCloseTo(0.6);
    // Should NOT create duplicate
    expect(store.peek().knowledge).toHaveLength(1);
  });

  it("LEARN フェーズで知識更新すると PLAN に自動遷移する", async () => {
    await store.update((s) => setPhase(s, "LEARN"));
    await knowledgeUpdate(store, { category: "technique", insight: "ペアプロ効果的" });
    expect(store.peek().phase).toBe("PLAN");
  });

  it("100 件を超えると低信頼度の知識が削除される", async () => {
    for (let i = 0; i < 105; i++) {
      await knowledgeUpdate(store, { category: "pattern", insight: `insight-${i}` });
    }
    expect(store.peek().knowledge).toHaveLength(100);
  });
});

describe("knowledge_query", () => {
  it("カテゴリで検索できる", async () => {
    await knowledgeUpdate(store, { category: "pattern", insight: "パターンA" });
    await knowledgeUpdate(store, { category: "antipattern", insight: "アンチパターンB" });

    const result = await knowledgeQuery(store, { category: "pattern" });
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].insight).toBe("パターンA");
  });

  it("キーワードで検索できる", async () => {
    await knowledgeUpdate(store, { category: "pattern", insight: "WIPリミットを設定する" });
    await knowledgeUpdate(store, { category: "pattern", insight: "レビューを優先する" });

    const result = await knowledgeQuery(store, { query: "WIP" });
    expect(result.data).toHaveLength(1);
    expect(result.data![0].insight).toContain("WIP");
  });

  it("結果は信頼度順にソートされる", async () => {
    await knowledgeUpdate(store, { category: "pattern", insight: "A" });
    await knowledgeUpdate(store, { category: "pattern", insight: "B" });
    // Reinforce B to increase confidence
    await knowledgeUpdate(store, { category: "pattern", insight: "B" });

    const result = await knowledgeQuery(store, {});
    expect(result.data![0].insight).toBe("B");
    expect(result.data![1].insight).toBe("A");
  });

  it("該当なしの場合は空配列を返す", async () => {
    const result = await knowledgeQuery(store, { query: "nonexistent" });
    expect(result.data).toHaveLength(0);
  });
});
