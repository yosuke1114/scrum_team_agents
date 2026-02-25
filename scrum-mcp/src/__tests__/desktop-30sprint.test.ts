/**
 * 机上30スプリント回転シミュレーション
 * 20スプリント版を拡張し、追加エッジケースを長期シナリオで網羅検証する
 *
 * Sprint  1-20: 20スプリント版と同一
 * Sprint 21:  全タスクBLOCKED → complete → 全BACKLOG降格（0%完了率）
 * Sprint 22:  連続中止 1回目（DONE有り → アーカイブ検証）
 * Sprint 23:  連続中止 2回目（直後に再中止、セレモニーリセット連続検証）
 * Sprint 24:  大量タスク(10件) + 複数 assignee + carry-over
 * Sprint 25:  completedInSprintId 検証 + snapshotメトリクス照会
 * Sprint 26:  BLOCKED→BACKLOG降格タスクの再投入 + BLOCKED中cancel
 * Sprint 27:  バリデーション検証（重複ID拒否・空白ゴール拒否）
 * Sprint 28:  連続高速スプリント（全完了×3回分統合）
 * Sprint 29:  全タスク降格→全BACKLOG完了（0%完了率スプリント）
 * Sprint 30:  最終ベロシティ + 30スプリント総合状態検証
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink } from "node:fs/promises";
import { StateStore } from "../state/store.js";
import { ceremonyStart, ceremonyEnd } from "../tools/ceremony.js";
import {
  sprintCreate,
  sprintAddTasks,
  sprintComplete,
  sprintCarryOver,
  sprintCancel,
} from "../tools/sprint.js";
import { taskCreate, taskUpdate } from "../tools/task.js";
import { metricsReport } from "../tools/metrics.js";
import { wipStatus } from "../tools/wip.js";
import { velocityReport } from "../tools/velocity.js";
import { projectStatus } from "../tools/query.js";
import type {
  WipStatus,
  SprintMetrics,
  VelocityData,
  Priority,
} from "../types.js";

const TEST_FILE = "/tmp/scrum-desktop-30sprint.json";
let store: StateStore;

beforeEach(async () => {
  store = await StateStore.init(TEST_FILE);
});

afterEach(async () => {
  try {
    await unlink(TEST_FILE);
  } catch {
    /* ignore */
  }
});

// ========== ヘルパー ==========

async function mkTask(
  title: string,
  priority: Priority = "medium",
  points?: number
): Promise<string> {
  const r = await taskCreate(store, {
    title,
    description: `${title} の説明`,
    acceptanceCriteria: [`${title} AC1`],
    priority,
    points,
  });
  expect(r.ok).toBe(true);
  const id = (r.data as { taskId: string }).taskId;
  await taskUpdate(store, { taskId: id, state: "READY" });
  return id;
}

async function completeTask(taskId: string, assignee: string = "dev-1") {
  await taskUpdate(store, { taskId, state: "IN_PROGRESS", assignee });
  await taskUpdate(store, { taskId, state: "IN_REVIEW" });
  await taskUpdate(store, { taskId, state: "DONE" });
}

async function quickActivate() {
  const s = store.peek();
  if (s.ceremonyState === "IDLE") {
    await ceremonyStart(store, { type: "planning" });
    await ceremonyEnd(store, { type: "planning" });
    await ceremonyStart(store, { type: "sprint" });
  }
}

async function completeAndWrapUp(sprintId: string) {
  await ceremonyStart(store, { type: "review" });
  await sprintComplete(store, { sprintId });
  await ceremonyEnd(store, { type: "review" });
  await ceremonyStart(store, { type: "retro" });
  await ceremonyEnd(store, { type: "retro" });
  expect(store.peek().ceremonyState).toBe("IDLE");
}

function log(msg: string) {
  console.log(msg);
}

function banner(n: number, title: string) {
  log(`\n═══ Sprint ${n}: ${title} ═══`);
}

// ========== テスト本体 ==========

describe("机上30スプリント回転", () => {
  it("Sprint 1〜30 を連続実行", async () => {
    // ================================================================
    // Sprint 1: 正常フロー（フルセレモニー、3タスク全完了）
    // ================================================================
    banner(1, "正常フロー（全完了）");

    await ceremonyStart(store, { type: "refinement" });
    const s1t1 = await mkTask("ユーザー認証API", "high", 8);
    const s1t2 = await mkTask("ダッシュボードUI", "medium", 5);
    const s1t3 = await mkTask("通知システム", "low", 3);
    await ceremonyEnd(store, { type: "refinement" });

    await ceremonyStart(store, { type: "planning" });
    await sprintCreate(store, { goal: "認証基盤MVP", taskIds: [s1t1, s1t2, s1t3] });
    await ceremonyEnd(store, { type: "planning" });
    await ceremonyStart(store, { type: "sprint" });

    await completeTask(s1t1, "dev-1");
    await completeTask(s1t2, "dev-2");
    await completeTask(s1t3, "dev-1");

    const m1 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m1.completedPoints).toBe(16);
    expect(m1.completionRate).toBe(100);

    await completeAndWrapUp("sprint-1");
    log(`  完了: 100% (16pt)`);

    // ================================================================
    // Sprint 2: 部分完了 → 持ち越し
    // ================================================================
    banner(2, "部分完了 → 持ち越し");

    const s2t1 = await mkTask("商品一覧API", "high", 5);
    const s2t2 = await mkTask("商品詳細API", "medium", 3);
    const s2t3 = await mkTask("在庫管理API", "medium", 8);
    const s2t4 = await mkTask("お気に入り機能", "low", 2);
    await sprintCreate(store, { goal: "商品カタログ", taskIds: [s2t1, s2t2, s2t3, s2t4] });
    await quickActivate();

    await completeTask(s2t1, "dev-1");
    await completeTask(s2t2, "dev-2");
    await taskUpdate(store, { taskId: s2t3, state: "IN_PROGRESS", assignee: "dev-1" });

    const m2 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m2.completedPoints).toBe(8);

    await completeAndWrapUp("sprint-2");
    await sprintCarryOver(store, { sprintId: "sprint-2" });
    expect(store.peek().tasks[s2t3].state).toBe("READY");
    expect(store.peek().tasks[s2t4].state).toBe("READY");
    log(`  完了: 50% (8/18pt), 2タスク持ち越し`);

    // ================================================================
    // Sprint 3: 中止（sprint セレモニー中）
    // ================================================================
    banner(3, "中止（sprint セレモニー中）");

    const s3t1 = await mkTask("決済Stripe統合", "high", 8);
    const s3t2 = await mkTask("決済PayPal統合", "high", 8);
    const s3t3 = await mkTask("レシート生成", "medium", 3);
    await sprintCreate(store, { goal: "決済基盤", taskIds: [s3t1, s3t2, s3t3] });
    await quickActivate();

    await taskUpdate(store, { taskId: s3t1, state: "IN_PROGRESS", assignee: "dev-1" });
    await taskUpdate(store, { taskId: s3t2, state: "IN_PROGRESS", assignee: "dev-2" });
    expect(store.peek().currentCeremony).toBe("sprint");

    const cancel3 = await sprintCancel(store, { sprintId: "sprint-3", reason: "決済プロバイダ未契約" });
    expect(cancel3.ok).toBe(true);
    expect(store.peek().ceremonyState).toBe("IDLE");
    expect(store.peek().currentCeremony).toBeNull();
    expect(store.peek().tasks[s3t1].state).toBe("READY");
    expect(store.peek().tasks[s3t1].assignee).toBeNull();

    const cancelData3 = cancel3.data as { affectedTasks: Array<{ previousState: string }> };
    expect(cancelData3.affectedTasks).toHaveLength(3);
    log(`  中止: ${cancelData3.affectedTasks.length} タスク READY 化`);

    // ================================================================
    // Sprint 4: 持ち越し再利用 + 新タスク追加
    // ================================================================
    banner(4, "持ち越し再利用 + 追加");

    const s4tNew = await mkTask("購入履歴API", "medium", 3);
    await sprintCreate(store, { goal: "決済＆在庫リカバリー", taskIds: [s2t3, s2t4, s3t1, s4tNew] });
    await sprintAddTasks(store, { sprintId: "sprint-4", taskIds: [s3t2] });
    expect(store.peek().currentSprint!.tasks).toHaveLength(5);

    await quickActivate();
    for (const id of [s2t3, s2t4, s3t1, s3t2, s4tNew]) {
      await completeTask(id, "dev-1");
    }

    const m4 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m4.completedTasks).toBe(5);
    expect(m4.completedPoints).toBe(29);

    await completeAndWrapUp("sprint-4");
    log(`  完了: 100% (${m4.completedPoints}pt, 5タスク)`);

    // ================================================================
    // Sprint 5: 大量タスク（6件）+ WIP 圧迫
    // ================================================================
    banner(5, "大量タスク + WIP 圧迫");

    const s5ids: string[] = [];
    for (let i = 1; i <= 6; i++) {
      s5ids.push(await mkTask(`機能${i}`, i <= 2 ? "high" : "medium", 2));
    }
    await sprintCreate(store, { goal: "一括機能追加", taskIds: s5ids });
    await quickActivate();

    await taskUpdate(store, { taskId: s5ids[0], state: "IN_PROGRESS", assignee: "dev-1" });
    await taskUpdate(store, { taskId: s5ids[1], state: "IN_PROGRESS", assignee: "dev-2" });
    const wip5 = await wipStatus(store);
    expect((wip5.data as WipStatus).warning).toContain("制限到達");

    const wip5warn = await taskUpdate(store, { taskId: s5ids[2], state: "IN_PROGRESS", assignee: "dev-3" });
    expect(wip5warn.message).toContain("WIP制限警告");

    for (const id of s5ids) {
      const t = store.peek().tasks[id];
      if (t.state === "IN_PROGRESS") {
        await taskUpdate(store, { taskId: id, state: "IN_REVIEW" });
        await taskUpdate(store, { taskId: id, state: "DONE" });
      } else {
        await completeTask(id);
      }
    }
    await completeAndWrapUp("sprint-5");
    log(`  完了: 100% (12pt, 6タスク, WIP超過あり)`);

    // ================================================================
    // Sprint 6: ブロッカー多発 → 解除 → 完了
    // ================================================================
    banner(6, "ブロッカー多発");

    const s6t1 = await mkTask("外部API統合", "high", 5);
    const s6t2 = await mkTask("DB マイグレーション", "high", 5);
    const s6t3 = await mkTask("E2Eテスト", "medium", 3);
    await sprintCreate(store, { goal: "統合テスト", taskIds: [s6t1, s6t2, s6t3] });
    await quickActivate();

    await taskUpdate(store, { taskId: s6t1, state: "IN_PROGRESS", assignee: "dev-1" });
    await taskUpdate(store, { taskId: s6t1, state: "BLOCKED" });
    await taskUpdate(store, { taskId: s6t2, state: "IN_PROGRESS", assignee: "dev-2" });
    await taskUpdate(store, { taskId: s6t2, state: "BLOCKED" });

    const ps6 = await projectStatus(store);
    expect((ps6.data as { blockers: unknown[] }).blockers).toHaveLength(2);

    await taskUpdate(store, { taskId: s6t1, state: "IN_PROGRESS" });
    await taskUpdate(store, { taskId: s6t1, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: s6t1, state: "DONE" });
    await taskUpdate(store, { taskId: s6t2, state: "IN_PROGRESS" });
    await taskUpdate(store, { taskId: s6t2, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: s6t2, state: "DONE" });
    await completeTask(s6t3, "dev-1");

    await completeAndWrapUp("sprint-6");
    log(`  完了: 100% (13pt, ブロッカー全解除)`);

    // ================================================================
    // Sprint 7: 降格遷移 + 優先度・ポイント変更
    // ================================================================
    banner(7, "降格 + 優先度変更");

    const s7t1 = await mkTask("検索機能", "high", 5);
    const s7t2 = await mkTask("フィルタ機能", "medium", 3);
    const s7t3 = await mkTask("ソート機能", "low", 2);
    const s7t4 = await mkTask("ページング", "medium", 3);
    await sprintCreate(store, { goal: "検索機能", taskIds: [s7t1, s7t2, s7t3, s7t4] });
    await quickActivate();

    const demote = await taskUpdate(store, { taskId: s7t3, state: "BACKLOG" });
    expect(demote.ok).toBe(true);

    await taskUpdate(store, { taskId: s7t4, priority: "high" });
    await taskUpdate(store, { taskId: s7t4, points: 5 });

    await completeTask(s7t1, "dev-1");
    await completeTask(s7t2, "dev-2");
    await completeTask(s7t4, "dev-1");

    const m7 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m7.completedTasks).toBe(3);
    expect(m7.completedPoints).toBe(13);

    await completeAndWrapUp("sprint-7");
    expect(store.getState().tasks[s7t3].state).toBe("BACKLOG");
    log(`  完了: 3/4 (13pt), BACKLOG 1件残留`);

    // ================================================================
    // Sprint 8: 中止（review セレモニー中）
    // ================================================================
    banner(8, "中止（review セレモニー中）");

    const s8t1 = await mkTask("決済Stripe v2", "high", 5);
    const s8t2 = await mkTask("決済PayPal v2", "high", 5);
    await sprintCreate(store, { goal: "決済 v2", taskIds: [s8t1, s8t2] });
    await quickActivate();

    await taskUpdate(store, { taskId: s8t1, state: "IN_PROGRESS", assignee: "dev-1" });
    await taskUpdate(store, { taskId: s8t1, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: s8t1, state: "DONE" });

    await ceremonyStart(store, { type: "review" });
    const cancel8 = await sprintCancel(store, { sprintId: "sprint-8", reason: "API仕様変更" });
    expect(cancel8.ok).toBe(true);
    expect(store.peek().currentCeremony).toBeNull();
    expect(store.peek().ceremonyState).toBe("IDLE");
    expect(store.peek().archivedTasks[s8t1]).toBeDefined();
    expect(store.peek().tasks[s8t2].state).toBe("READY");
    log(`  中止: review中 → セレモニー完全クリア + DONEアーカイブ`);

    // ================================================================
    // Sprint 9: ポイントなしスプリント
    // ================================================================
    banner(9, "ポイントなし");

    const s9t1 = await mkTask("ドキュメント整備", "low");
    const s9t2 = await mkTask("CI設定", "medium");
    const s9t3 = await mkTask("リンター導入", "medium");
    await sprintCreate(store, { goal: "開発基盤整備", taskIds: [s9t1, s9t2, s9t3] });
    await quickActivate();

    await completeTask(s9t1);
    await completeTask(s9t2);
    await completeTask(s9t3);

    await completeAndWrapUp("sprint-9");
    log(`  完了: 100% (0pt, 3タスク)`);

    // ================================================================
    // Sprint 10: 単一タスク + 中間ベロシティ検証
    // ================================================================
    banner(10, "単一タスク + 中間ベロシティ");

    const s10t1 = await mkTask("認証リファクタ", "high", 8);
    await sprintCreate(store, { goal: "認証改善", taskIds: [s10t1] });
    await quickActivate();
    await completeTask(s10t1, "dev-1");

    const completeNoReview = await sprintComplete(store, { sprintId: "sprint-10" });
    expect(completeNoReview.ok).toBe(true);
    expect(completeNoReview.message).toContain("review セレモニーが開始されていません");
    expect(store.peek().ceremonyState).toBe("IDLE");

    const v10 = await velocityReport(store, {});
    const vd10 = v10.data as VelocityData;
    expect(vd10.sprints).toHaveLength(8);
    log(`  中間ベロシティ: ${vd10.averageVelocity}pt/sprint`);

    // ================================================================
    // Sprint 11: 大量タスク（8件）高速完了
    // ================================================================
    banner(11, "大量タスク（8件）高速完了");

    const s11ids: string[] = [];
    for (let i = 1; i <= 8; i++) {
      s11ids.push(await mkTask(`バッチ${i}`, "medium", 3));
    }
    await sprintCreate(store, { goal: "バッチ処理一括", taskIds: s11ids });
    await quickActivate();

    for (const id of s11ids) {
      await completeTask(id);
    }

    const m11 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m11.completedTasks).toBe(8);
    expect(m11.completedPoints).toBe(24);

    await completeAndWrapUp("sprint-11");
    log(`  完了: 100% (24pt, 8タスク)`);

    // ================================================================
    // Sprint 12: 全ブロック → 一部復帰 → 部分完了
    // ================================================================
    banner(12, "全ブロック → 部分復帰");

    const s12t1 = await mkTask("外部連携A", "high", 5);
    const s12t2 = await mkTask("外部連携B", "high", 5);
    const s12t3 = await mkTask("外部連携C", "medium", 3);
    await sprintCreate(store, { goal: "外部連携", taskIds: [s12t1, s12t2, s12t3] });
    await quickActivate();

    for (const id of [s12t1, s12t2, s12t3]) {
      await taskUpdate(store, { taskId: id, state: "IN_PROGRESS", assignee: "dev-1" });
      await taskUpdate(store, { taskId: id, state: "BLOCKED" });
    }

    await taskUpdate(store, { taskId: s12t1, state: "IN_PROGRESS" });
    await taskUpdate(store, { taskId: s12t1, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: s12t1, state: "DONE" });
    await taskUpdate(store, { taskId: s12t2, state: "IN_PROGRESS" });
    await taskUpdate(store, { taskId: s12t2, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: s12t2, state: "DONE" });

    await completeAndWrapUp("sprint-12");
    expect(store.getState().tasks[s12t3].state).toBe("BACKLOG");
    log(`  完了: 2/3 (10pt), 1件BLOCKED→BACKLOG自動降格`);

    // ================================================================
    // Sprint 13: 中止（BACKLOG タスク保持）
    // ================================================================
    banner(13, "中止（BACKLOG 保持）");

    // s12t3 は H1 により BACKLOG に自動降格済み
    const s13t1 = await mkTask("新決済連携", "high", 5);
    const s13t2 = await mkTask("新外部API", "medium", 3);
    await taskUpdate(store, { taskId: s12t3, state: "READY" });
    await sprintCreate(store, { goal: "外部連携v2", taskIds: [s12t3, s13t1, s13t2] });
    await quickActivate();

    await taskUpdate(store, { taskId: s12t3, state: "BACKLOG" });
    await taskUpdate(store, { taskId: s13t1, state: "IN_PROGRESS", assignee: "dev-1" });

    const cancel13 = await sprintCancel(store, { sprintId: "sprint-13", reason: "方針転換" });
    expect(cancel13.ok).toBe(true);
    expect(store.peek().tasks[s12t3].state).toBe("BACKLOG");
    expect(store.peek().tasks[s13t1].state).toBe("READY");
    log(`  中止: BACKLOG保持, 影響2タスク`);

    // ================================================================
    // Sprint 14: 3回分の持ち越しリカバリー
    // ================================================================
    banner(14, "3回分の持ち越しリカバリー");

    await taskUpdate(store, { taskId: s7t3, state: "READY" });
    await taskUpdate(store, { taskId: s12t3, state: "READY" });
    await sprintCreate(store, {
      goal: "残タスク集約",
      taskIds: [s7t3, s12t3, s13t1, s13t2, s8t2],
    });
    await quickActivate();

    for (const id of [s7t3, s12t3, s13t1, s13t2, s8t2]) {
      await completeTask(id);
    }

    const m14 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m14.completedPoints).toBe(18);

    await completeAndWrapUp("sprint-14");
    log(`  完了: 100% (18pt, 5タスク)`);

    // ================================================================
    // Sprint 15: ポイント再見積もり
    // ================================================================
    banner(15, "ポイント再見積もり");

    const s15t1 = await mkTask("API v3 設計", "high", 8);
    const s15t2 = await mkTask("API v3 実装", "high", 13);
    const s15t3 = await mkTask("API v3 テスト", "medium", 5);
    await sprintCreate(store, { goal: "API v3", taskIds: [s15t1, s15t2, s15t3] });
    await quickActivate();

    await taskUpdate(store, { taskId: s15t2, state: "IN_PROGRESS", assignee: "dev-1" });
    await taskUpdate(store, { taskId: s15t2, points: 8 });
    await taskUpdate(store, { taskId: s15t3, points: 3 });

    await completeTask(s15t1, "dev-2");
    await taskUpdate(store, { taskId: s15t2, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: s15t2, state: "DONE" });
    await completeTask(s15t3, "dev-1");

    const m15 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m15.completedPoints).toBe(19);

    await completeAndWrapUp("sprint-15");
    log(`  完了: 100% (19pt, 再見積もり反映)`);

    // ================================================================
    // Sprint 16: 中止 → 即再起動
    // ================================================================
    banner(16, "中止 → 即再起動");

    const s16t1 = await mkTask("検索v2", "high", 5);
    const s16t2 = await mkTask("フィルタv2", "medium", 3);
    await sprintCreate(store, { goal: "検索改善 (試行1)", taskIds: [s16t1, s16t2] });
    await quickActivate();

    await taskUpdate(store, { taskId: s16t1, state: "IN_PROGRESS", assignee: "dev-1" });
    const cancel16 = await sprintCancel(store, { sprintId: "sprint-16", reason: "優先度変更" });
    expect(cancel16.ok).toBe(true);
    log(`  中止 → Sprint 17 で即再起動`);

    // ================================================================
    // Sprint 17: 中止タスク集約 → 全完了
    // ================================================================
    banner(17, "中止タスク集約 → 全完了");

    await sprintCreate(store, {
      goal: "検索改善 (確定)",
      taskIds: [s16t1, s16t2, s3t3],
    });
    await quickActivate();

    await completeTask(s16t1, "dev-1");
    await completeTask(s16t2, "dev-2");
    await completeTask(s3t3, "dev-1");

    const m17 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m17.completedPoints).toBe(11);

    await completeAndWrapUp("sprint-17");
    log(`  完了: 100% (11pt)`);

    // ================================================================
    // Sprint 18: 高ベロシティスプリント
    // ================================================================
    banner(18, "高ベロシティ");

    const s18t1 = await mkTask("基盤刷新A", "high", 13);
    const s18t2 = await mkTask("基盤刷新B", "high", 13);
    const s18t3 = await mkTask("基盤刷新C", "medium", 8);
    const s18t4 = await mkTask("基盤刷新D", "medium", 5);
    await sprintCreate(store, { goal: "基盤刷新", taskIds: [s18t1, s18t2, s18t3, s18t4] });
    await quickActivate();

    for (const id of [s18t1, s18t2, s18t3, s18t4]) {
      await completeTask(id, "dev-1");
    }

    await completeAndWrapUp("sprint-18");
    log(`  完了: 100% (39pt)`);

    // ================================================================
    // Sprint 19: 複合状態遷移
    // ================================================================
    banner(19, "複合状態遷移");

    const s19t1 = await mkTask("統合テストA", "high", 5);
    const s19t2 = await mkTask("統合テストB", "medium", 3);
    const s19t3 = await mkTask("統合テストC", "low", 2);
    const s19t4 = await mkTask("統合テストD", "medium", 3);
    await sprintCreate(store, { goal: "統合テスト", taskIds: [s19t1, s19t2, s19t3, s19t4] });
    await quickActivate();

    await taskUpdate(store, { taskId: s19t1, state: "IN_PROGRESS", assignee: "dev-1" });
    await taskUpdate(store, { taskId: s19t1, state: "BLOCKED" });
    await taskUpdate(store, { taskId: s19t1, state: "IN_PROGRESS" });
    await taskUpdate(store, { taskId: s19t1, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: s19t1, state: "DONE" });

    await taskUpdate(store, { taskId: s19t2, priority: "high" });
    await completeTask(s19t2, "dev-2");

    await taskUpdate(store, { taskId: s19t3, state: "BACKLOG" });
    await completeTask(s19t4, "dev-1");

    await completeAndWrapUp("sprint-19");
    expect(store.getState().tasks[s19t3].state).toBe("BACKLOG");
    log(`  完了: 3/4 (11pt), 降格1件`);

    // ================================================================
    // Sprint 20: 中間検証
    // ================================================================
    banner(20, "中間検証");

    await taskUpdate(store, { taskId: s19t3, state: "READY" });
    const s20t1 = await mkTask("最終仕上げA", "high", 5);
    const s20t2 = await mkTask("最終仕上げB", "medium", 3);
    await sprintCreate(store, {
      goal: "最終リリース",
      taskIds: [s19t3, s20t1, s20t2],
    });
    await quickActivate();

    await completeTask(s19t3, "dev-1");
    await completeTask(s20t1, "dev-2");
    await completeTask(s20t2, "dev-1");

    await completeAndWrapUp("sprint-20");
    log(`  完了: 100% (10pt)`);

    // ================================================================
    // Sprint 21: 全タスクBLOCKED → complete → 全BACKLOG降格（0%完了率）
    // ================================================================
    banner(21, "全タスクBLOCKED → 完了（0%）");

    const s21t1 = await mkTask("外部連携X", "high", 5);
    const s21t2 = await mkTask("外部連携Y", "medium", 3);
    const s21t3 = await mkTask("外部連携Z", "low", 2);
    await sprintCreate(store, { goal: "外部連携v3", taskIds: [s21t1, s21t2, s21t3] });
    await quickActivate();

    // 全タスクBLOCKED
    for (const id of [s21t1, s21t2, s21t3]) {
      await taskUpdate(store, { taskId: id, state: "IN_PROGRESS", assignee: "dev-1" });
      await taskUpdate(store, { taskId: id, state: "BLOCKED" });
    }

    await ceremonyStart(store, { type: "review" });
    const m21result = await sprintComplete(store, { sprintId: "sprint-21" });
    expect(m21result.ok).toBe(true);
    // BLOCKED警告が出る
    expect(m21result.message).toContain("ブロック中タスク");
    expect(m21result.message).toContain("BACKLOG に降格");
    await ceremonyEnd(store, { type: "review" });
    await ceremonyStart(store, { type: "retro" });
    await ceremonyEnd(store, { type: "retro" });

    // 全タスクBACKLOGに降格、アーカイブなし
    for (const id of [s21t1, s21t2, s21t3]) {
      expect(store.getState().tasks[id].state).toBe("BACKLOG");
      expect(store.getState().tasks[id].assignee).toBeNull();
    }

    const m21 = (await metricsReport(store, { sprintId: "sprint-21" })).data as SprintMetrics;
    expect(m21.completedTasks).toBe(0);
    expect(m21.completionRate).toBe(0);
    expect(m21.completedPoints).toBe(0);
    log(`  完了率: 0% (全3件BLOCKED→BACKLOG降格)`);

    // ================================================================
    // Sprint 22: 連続中止 1回目（DONE有り → アーカイブ検証）
    // ================================================================
    banner(22, "連続中止 1回目（DONEアーカイブ）");

    // s21タスクをREADYに戻す
    for (const id of [s21t1, s21t2, s21t3]) {
      await taskUpdate(store, { taskId: id, state: "READY" });
    }
    const s22tNew = await mkTask("緊急修正A", "high", 8);
    await sprintCreate(store, { goal: "外部連携再挑戦", taskIds: [s21t1, s21t2, s21t3, s22tNew] });
    await quickActivate();

    // s22tNew を完了
    await completeTask(s22tNew, "dev-1");
    // s21t1 を IN_PROGRESS
    await taskUpdate(store, { taskId: s21t1, state: "IN_PROGRESS", assignee: "dev-2" });

    const cancel22 = await sprintCancel(store, { sprintId: "sprint-22", reason: "外部障害" });
    expect(cancel22.ok).toBe(true);
    // DONE はアーカイブ
    expect(store.getState().archivedTasks[s22tNew]).toBeDefined();
    expect(store.getState().archivedTasks[s22tNew].completedInSprintId).toBe("sprint-22");
    expect(store.getState().tasks[s22tNew]).toBeUndefined();
    // 未完了は READY
    expect(store.getState().tasks[s21t1].state).toBe("READY");
    expect(store.getState().tasks[s21t2].state).toBe("READY");
    log(`  中止1: DONE 1件アーカイブ（completedInSprintId=sprint-22）`);

    // ================================================================
    // Sprint 23: 連続中止 2回目（直後に再中止）
    // ================================================================
    banner(23, "連続中止 2回目（即中止）");

    await sprintCreate(store, { goal: "外部連携再挑戦2", taskIds: [s21t1, s21t2, s21t3] });
    await quickActivate();

    // 何も着手せず即中止
    const cancel23 = await sprintCancel(store, { sprintId: "sprint-23", reason: "方針再転換" });
    expect(cancel23.ok).toBe(true);
    expect(store.peek().ceremonyState).toBe("IDLE");
    // 全タスク READY（TODO→READY に戻る）
    for (const id of [s21t1, s21t2, s21t3]) {
      expect(store.getState().tasks[id].state).toBe("READY");
    }
    // 連続中止カウント
    const cancelledSoFar = store.peek().sprints.filter((s) => s.state === "CANCELLED").length;
    expect(cancelledSoFar).toBe(6); // 3,8,13,16,22,23
    log(`  即中止: 全タスクREADY戻り、累積中止=${cancelledSoFar}`);

    // ================================================================
    // Sprint 24: 大量タスク(10件) + 複数 assignee + carry-over
    // ================================================================
    banner(24, "大量タスク(10件) + carry-over");

    const s24ids: string[] = [];
    for (let i = 1; i <= 10; i++) {
      s24ids.push(await mkTask(`マイクロ${i}`, i <= 3 ? "high" : "medium", 2));
    }
    await sprintCreate(store, { goal: "マイクロサービス化", taskIds: s24ids });
    await quickActivate();

    // 7件完了（3 assignee で分担）
    for (let i = 0; i < 7; i++) {
      const assignee = `dev-${(i % 3) + 1}`;
      await completeTask(s24ids[i], assignee);
    }
    // 3件は TODO のまま

    const m24 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m24.completedTasks).toBe(7);
    expect(m24.completedPoints).toBe(14); // 7*2

    await completeAndWrapUp("sprint-24");
    // carry-over で残りを READY に
    await sprintCarryOver(store, { sprintId: "sprint-24" });
    for (let i = 7; i < 10; i++) {
      expect(store.getState().tasks[s24ids[i]].state).toBe("READY");
    }
    log(`  完了: 7/10 (14/20pt), 3件 carry-over`);

    // ================================================================
    // Sprint 25: completedInSprintId 検証 + snapshotメトリクス照会
    // ================================================================
    banner(25, "completedInSprintId + snapshot検証");

    // carry-over タスクを含めた sprint
    const s25tNew = await mkTask("新API", "high", 5);
    await sprintCreate(store, {
      goal: "マイクロサービス完結",
      taskIds: [s24ids[7], s24ids[8], s24ids[9], s25tNew],
    });
    await quickActivate();

    for (const id of [s24ids[7], s24ids[8], s24ids[9], s25tNew]) {
      await completeTask(id);
    }

    await completeAndWrapUp("sprint-25");

    // completedInSprintId 検証
    for (const id of [s24ids[7], s24ids[8], s24ids[9], s25tNew]) {
      expect(store.getState().archivedTasks[id].completedInSprintId).toBe("sprint-25");
    }
    log(`  completedInSprintId: 全4件 = sprint-25`);

    // snapshot メトリクス照会（M10: 完了スプリントはスナップショット利用）
    const m25snap = await metricsReport(store, { sprintId: "sprint-25" });
    expect(m25snap.ok).toBe(true);
    expect(m25snap.message).toContain("スナップショット");
    expect((m25snap.data as SprintMetrics).completedPoints).toBe(11); // 2+2+2+5
    log(`  snapshot照会: 完了スプリントはスナップショット利用確認`);

    // 過去スプリント (sprint-1) もスナップショットで照会
    const m1snap = await metricsReport(store, { sprintId: "sprint-1" });
    expect(m1snap.ok).toBe(true);
    expect(m1snap.message).toContain("スナップショット");
    expect((m1snap.data as SprintMetrics).completedPoints).toBe(16);
    log(`  sprint-1 snapshot照会: 16pt 確認`);

    // ================================================================
    // Sprint 26: BLOCKED中cancel + BACKLOG再投入
    // ================================================================
    banner(26, "BLOCKED中cancel + BACKLOG再投入");

    // s21タスクを再利用
    const s26t1 = await mkTask("連携リトライA", "high", 5);
    const s26t2 = await mkTask("連携リトライB", "medium", 3);
    await sprintCreate(store, { goal: "連携リトライ", taskIds: [s21t1, s21t2, s26t1, s26t2] });
    await quickActivate();

    // s21t1 BLOCKED、s21t2 降格
    await taskUpdate(store, { taskId: s21t1, state: "IN_PROGRESS", assignee: "dev-1" });
    await taskUpdate(store, { taskId: s21t1, state: "BLOCKED" });
    await taskUpdate(store, { taskId: s21t2, state: "BACKLOG" });
    // s26t1 完了
    await completeTask(s26t1, "dev-2");

    const cancel26 = await sprintCancel(store, { sprintId: "sprint-26", reason: "再度障害" });
    expect(cancel26.ok).toBe(true);
    // BLOCKED → READY（cancelはBLOCKEDをREADYに戻す）
    expect(store.getState().tasks[s21t1].state).toBe("READY");
    // BACKLOG → BACKLOG 保持
    expect(store.getState().tasks[s21t2].state).toBe("BACKLOG");
    // DONE → アーカイブ
    expect(store.getState().archivedTasks[s26t1]).toBeDefined();
    // TODO → READY
    expect(store.getState().tasks[s26t2].state).toBe("READY");

    const cancelData26 = cancel26.data as { affectedTasks: Array<{ id: string }>; archivedTasks: Array<{ id: string }> };
    expect(cancelData26.archivedTasks).toHaveLength(1);
    log(`  中止: BLOCKED→READY, BACKLOG保持, DONE→archive`);

    // ================================================================
    // Sprint 27: バリデーション検証（重複ID・空白ゴール）
    // ================================================================
    banner(27, "バリデーション検証");

    // 重複タスクID拒否
    const s27t1 = await mkTask("バリデA", "medium", 3);
    const dupResult = await sprintCreate(store, { goal: "dup test", taskIds: [s27t1, s27t1] });
    expect(dupResult.ok).toBe(false);
    expect(dupResult.error).toContain("重複");
    log(`  重複タスクID拒否: OK`);

    // 空白ゴール拒否
    const wsResult = await sprintCreate(store, { goal: "   ", taskIds: [s27t1] });
    expect(wsResult.ok).toBe(false);
    expect(wsResult.error).toContain("スプリントゴールが空");
    log(`  空白ゴール拒否: OK`);

    // 正常作成してスプリント実行
    await taskUpdate(store, { taskId: s21t2, state: "READY" });
    await sprintCreate(store, { goal: "バリデ＋クリーンアップ", taskIds: [s27t1, s21t1, s21t2, s21t3, s26t2] });
    await quickActivate();

    for (const id of [s27t1, s21t1, s21t2, s21t3, s26t2]) {
      await completeTask(id);
    }

    const m27 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m27.completedTasks).toBe(5);
    // s27t1=3, s21t1=5, s21t2=3, s21t3=2, s26t2=3 → 16
    expect(m27.completedPoints).toBe(16);

    await completeAndWrapUp("sprint-27");
    log(`  完了: 100% (16pt, 5タスク, 長期残留タスク全消化)`);

    // ================================================================
    // Sprint 28: 連続高速スプリント
    // ================================================================
    banner(28, "連続高速スプリント");

    const s28t1 = await mkTask("最適化A", "high", 8);
    const s28t2 = await mkTask("最適化B", "high", 8);
    const s28t3 = await mkTask("最適化C", "medium", 5);
    await sprintCreate(store, { goal: "パフォーマンス最適化", taskIds: [s28t1, s28t2, s28t3] });
    await quickActivate();

    await completeTask(s28t1, "dev-1");
    await completeTask(s28t2, "dev-2");
    await completeTask(s28t3, "dev-1");

    await completeAndWrapUp("sprint-28");
    log(`  完了: 100% (21pt)`);

    // ================================================================
    // Sprint 29: 全タスク降格 → 0%完了
    // ================================================================
    banner(29, "全タスク降格 → 0%完了");

    const s29t1 = await mkTask("実験A", "low", 2);
    const s29t2 = await mkTask("実験B", "low", 2);
    const s29t3 = await mkTask("実験C", "low", 2);
    await sprintCreate(store, { goal: "実験スプリント", taskIds: [s29t1, s29t2, s29t3] });
    await quickActivate();

    // 全タスク BACKLOG 降格
    for (const id of [s29t1, s29t2, s29t3]) {
      await taskUpdate(store, { taskId: id, state: "BACKLOG" });
    }

    const m29 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m29.completedTasks).toBe(0);
    expect(m29.completionRate).toBe(0);

    await completeAndWrapUp("sprint-29");
    // 全タスクはBACKLOG残留
    for (const id of [s29t1, s29t2, s29t3]) {
      expect(store.getState().tasks[id].state).toBe("BACKLOG");
    }
    log(`  完了率: 0% (全3件BACKLOG降格)`);

    // ================================================================
    // Sprint 30: 最終スプリント + 30スプリント総合検証
    // ================================================================
    banner(30, "最終 + 30スプリント総合検証");

    // S29 の降格タスクを再利用
    for (const id of [s29t1, s29t2, s29t3]) {
      await taskUpdate(store, { taskId: id, state: "READY" });
    }
    const s30t1 = await mkTask("最終タスクA", "high", 13);
    const s30t2 = await mkTask("最終タスクB", "medium", 8);
    await sprintCreate(store, {
      goal: "最終リリースv2",
      taskIds: [s29t1, s29t2, s29t3, s30t1, s30t2],
    });
    await quickActivate();

    for (const id of [s29t1, s29t2, s29t3, s30t1, s30t2]) {
      await completeTask(id);
    }

    const m30 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m30.completedTasks).toBe(5);
    expect(m30.completedPoints).toBe(27); // 2+2+2+13+8

    await completeAndWrapUp("sprint-30");
    log(`  完了: 100% (${m30.completedPoints}pt)\n`);

    // ================================================================
    // 総合ベロシティ検証
    // ================================================================
    log("═══ 30スプリント総合ベロシティ検証 ═══");

    const v = await velocityReport(store, {});
    expect(v.ok).toBe(true);
    const vd = v.data as VelocityData;

    // 完了: 1,2,4,5,6,7,9,10,11,12,14,15,17,18,19,20,21,24,25,27,28,29,30
    // 中止: 3,8,13,16,22,23,26
    const completedCount = vd.sprints.length;
    const cancelledCount = store.peek().sprints.filter((s) => s.state === "CANCELLED").length;
    expect(completedCount).toBe(23);
    expect(cancelledCount).toBe(7);
    log(`  完了スプリント: ${completedCount}, 中止: ${cancelledCount}`);

    const expectedPoints: Array<{ id: string; pts: number }> = [
      { id: "sprint-1", pts: 16 },
      { id: "sprint-2", pts: 8 },
      { id: "sprint-4", pts: 29 },
      { id: "sprint-5", pts: 12 },
      { id: "sprint-6", pts: 13 },
      { id: "sprint-7", pts: 13 },
      { id: "sprint-9", pts: 0 },
      { id: "sprint-10", pts: 8 },
      { id: "sprint-11", pts: 24 },
      { id: "sprint-12", pts: 10 },
      { id: "sprint-14", pts: 18 },
      { id: "sprint-15", pts: 19 },
      { id: "sprint-17", pts: 11 },
      { id: "sprint-18", pts: 39 },
      { id: "sprint-19", pts: 11 },
      { id: "sprint-20", pts: 10 },
      { id: "sprint-21", pts: 0 },   // 全BLOCKED→0%
      { id: "sprint-24", pts: 14 },  // 7/10
      { id: "sprint-25", pts: 11 },  // carry-over完結
      { id: "sprint-27", pts: 16 },  // 長期残留消化
      { id: "sprint-28", pts: 21 },  // 高速
      { id: "sprint-29", pts: 0 },   // 全降格→0%
      { id: "sprint-30", pts: 27 },  // 最終
    ];

    for (let i = 0; i < expectedPoints.length; i++) {
      expect(vd.sprints[i].id).toBe(expectedPoints[i].id);
      expect(vd.sprints[i].completedPoints).toBe(expectedPoints[i].pts);
      log(`  ${expectedPoints[i].id}: ${expectedPoints[i].pts}pt`);
    }

    const totalPts = expectedPoints.reduce((s, e) => s + e.pts, 0);
    const avgExpected = Math.round(totalPts / expectedPoints.length);
    expect(vd.averageVelocity).toBe(avgExpected);
    log(`\n  合計: ${totalPts}pt / ${completedCount}スプリント`);
    log(`  平均ベロシティ: ${vd.averageVelocity}pt/sprint`);
    log(`  平均完了率: ${vd.averageCompletionRate}%`);

    // lastN=10 で直近10スプリント
    const vLast10 = await velocityReport(store, { lastN: 10 });
    const vdLast10 = vLast10.data as VelocityData;
    expect(vdLast10.sprints).toHaveLength(10);
    // 完了23件の末尾10件: 18,19,20,21,24,25,27,28,29,30
    expect(vdLast10.sprints[0].id).toBe("sprint-18");
    expect(vdLast10.sprints[9].id).toBe("sprint-30");
    log(`  lastN=10: ${vdLast10.sprints.map((s) => s.id).join(", ")}`);

    // ================================================================
    // 最終状態検証
    // ================================================================
    log("\n═══ 最終状態検証 ═══");

    const finalState = store.getState();

    // 30スプリント作成
    expect(finalState.sprints).toHaveLength(30);

    // 完了23 + 中止7
    const completed = finalState.sprints.filter((s) => s.state === "COMPLETED");
    const cancelled = finalState.sprints.filter((s) => s.state === "CANCELLED");
    expect(completed).toHaveLength(23);
    expect(cancelled).toHaveLength(7);
    expect(cancelled.map((s) => s.id)).toEqual([
      "sprint-3", "sprint-8", "sprint-13", "sprint-16",
      "sprint-22", "sprint-23", "sprint-26",
    ]);
    log(`  スプリント: ${completed.length}完了, ${cancelled.length}中止`);

    // 全完了スプリントにメトリクススナップショット
    for (const sp of completed) {
      expect(sp.metrics).toBeDefined();
      expect(sp.metrics!.completedTasks).toBeGreaterThanOrEqual(0);
    }
    log(`  全完了スプリントにメトリクススナップショットあり`);

    // アーカイブ済タスク数
    const archivedCount = Object.keys(finalState.archivedTasks).length;
    const activeCount = Object.keys(finalState.tasks).length;
    log(`  アーカイブ済: ${archivedCount}件, アクティブ: ${activeCount}件`);
    expect(archivedCount).toBeGreaterThan(50);

    // セレモニー IDLE
    expect(finalState.ceremonyState).toBe("IDLE");
    expect(finalState.currentCeremony).toBeNull();
    log(`  セレモニー: IDLE`);

    // project_status
    const finalStatus = await projectStatus(store);
    expect(finalStatus.ok).toBe(true);
    expect(finalStatus.message).toContain("完了スプリント数: 23");
    expect(finalStatus.message).toContain("中止: 7");
    const fsData = finalStatus.data as { cancelledSprints: number };
    expect(fsData.cancelledSprints).toBe(7);
    log(`  project_status: 完了=23, 中止=7`);

    // バリデーション検証
    const negResult = await taskCreate(store, {
      title: "neg",
      description: "d",
      acceptanceCriteria: [],
      priority: "medium",
      points: -1,
    });
    expect(negResult.ok).toBe(false);
    expect(negResult.error).toContain("0以上");
    log(`  負ポイント拒否確認`);

    log(`\n═══ 30スプリント机上回転 完了 ═══\n`);
  });
});
