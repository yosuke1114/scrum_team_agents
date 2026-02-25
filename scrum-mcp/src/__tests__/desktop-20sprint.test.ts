/**
 * 机上20スプリント回転シミュレーション
 * 10スプリント版を拡張し、改善H1〜M6の全修正を長期シナリオで網羅検証する
 *
 * Sprint  1:  正常フロー（フルセレモニー、全完了）
 * Sprint  2:  部分完了 → 持ち越し
 * Sprint  3:  中止（sprint セレモニー中）
 * Sprint  4:  持ち越しタスク再利用 + 新タスク追加
 * Sprint  5:  大量タスク（6件）+ WIP 圧迫
 * Sprint  6:  ブロッカー多発 → 解除 → 完了
 * Sprint  7:  降格遷移（TODO→BACKLOG）+ 優先度・ポイント変更
 * Sprint  8:  中止（review セレモニー中 → M1 クリーンアップ検証）
 * Sprint  9:  ポイントなしスプリント
 * Sprint 10:  単一タスクスプリント + 中間ベロシティ検証
 * Sprint 11:  大量タスク（8件）高速完了
 * Sprint 12:  全タスクブロック → 一部復帰 → 部分完了
 * Sprint 13:  中止（BACKLOG タスク保持 → H2 検証）
 * Sprint 14:  3回分の持ち越し＆中止リカバリー
 * Sprint 15:  ポイント再見積もり（mid-sprint re-estimation）
 * Sprint 16:  中止 → 即再起動（同一タスク）
 * Sprint 17:  中止タスク集約 → 全完了
 * Sprint 18:  高ベロシティスプリント（大型タスク）
 * Sprint 19:  複合状態遷移（BLOCKED+降格+優先度変更）
 * Sprint 20:  最終ベロシティ検証 + 総合状態確認
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

const TEST_FILE = "/tmp/scrum-desktop-20sprint.json";
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

describe("机上20スプリント回転", () => {
  it("Sprint 1〜20 を連続実行", async () => {
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
    expect(m4.completedPoints).toBe(29); // s2t3=8, s2t4=2, s3t1=8, s3t2=8, s4tNew=3

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

    // s7t3 降格
    const demote = await taskUpdate(store, { taskId: s7t3, state: "BACKLOG" });
    expect(demote.ok).toBe(true);
    expect(store.peek().tasks[s7t3].state).toBe("BACKLOG");

    // 優先度・ポイント変更
    await taskUpdate(store, { taskId: s7t4, priority: "high" });
    await taskUpdate(store, { taskId: s7t4, points: 5 });

    await completeTask(s7t1, "dev-1");
    await completeTask(s7t2, "dev-2");
    await completeTask(s7t4, "dev-1");

    const m7 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m7.completedTasks).toBe(3);
    expect(m7.completedPoints).toBe(13); // 5+3+5

    await completeAndWrapUp("sprint-7");
    expect(store.getState().tasks[s7t3].state).toBe("BACKLOG");
    log(`  完了: 3/4 (13pt), BACKLOG 1件残留`);

    // ================================================================
    // Sprint 8: 中止（review セレモニー中 → M1 検証）
    // ================================================================
    banner(8, "中止（review セレモニー中 → M1 検証）");

    const s8t1 = await mkTask("決済Stripe v2", "high", 5);
    const s8t2 = await mkTask("決済PayPal v2", "high", 5);
    await sprintCreate(store, { goal: "決済 v2", taskIds: [s8t1, s8t2] });
    await quickActivate();

    await taskUpdate(store, { taskId: s8t1, state: "IN_PROGRESS", assignee: "dev-1" });
    await taskUpdate(store, { taskId: s8t1, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: s8t1, state: "DONE" });

    // review セレモニー開始中に中止
    await ceremonyStart(store, { type: "review" });
    expect(store.peek().currentCeremony).toBe("review");
    expect(store.peek().ceremonyState).toBe("SPRINT_REVIEW");

    const cancel8 = await sprintCancel(store, { sprintId: "sprint-8", reason: "API仕様変更" });
    expect(cancel8.ok).toBe(true);
    // M1: review セレモニーもクリアされる
    expect(store.peek().currentCeremony).toBeNull();
    expect(store.peek().ceremonyState).toBe("IDLE");
    // H1: DONE タスクはアーカイブされる、未完了は READY
    expect(store.peek().archivedTasks[s8t1]).toBeDefined();
    expect(store.peek().archivedTasks[s8t1].state).toBe("DONE");
    expect(store.peek().tasks[s8t1]).toBeUndefined();
    expect(store.peek().tasks[s8t2].state).toBe("READY");
    log(`  M1+H1 検証: review 中の中止 → セレモニー完全クリア + DONE アーカイブ`);

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

    const m9 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m9.completedPoints).toBe(0);
    expect(m9.completionRate).toBe(100);

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

    // H3 検証: review なしで完了 → 警告
    const completeNoReview = await sprintComplete(store, { sprintId: "sprint-10" });
    expect(completeNoReview.ok).toBe(true);
    expect(completeNoReview.message).toContain("review セレモニーが開始されていません");
    log(`  H3 検証: review なし完了 → 警告メッセージ確認`);

    // H2 検証: sprint セレモニー中の complete で自動リセットされる
    expect(store.peek().currentCeremony).toBeNull();
    expect(store.peek().ceremonyState).toBe("IDLE");
    log(`  H2 検証: sprint セレモニー → 自動 IDLE リセット`);

    // 中間ベロシティ検証
    const v10 = await velocityReport(store, {});
    expect(v10.ok).toBe(true);
    const vd10 = v10.data as VelocityData;
    // 完了: 1,2,4,5,6,7,9,10 (3,8 は CANCELLED)
    expect(vd10.sprints).toHaveLength(8);
    log(`  中間ベロシティ: ${vd10.averageVelocity}pt/sprint (${vd10.sprints.length}スプリント)`);

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

    // 全タスク着手 → 全ブロック
    for (const id of [s12t1, s12t2, s12t3]) {
      await taskUpdate(store, { taskId: id, state: "IN_PROGRESS", assignee: "dev-1" });
      await taskUpdate(store, { taskId: id, state: "BLOCKED" });
    }
    const ps12 = await projectStatus(store);
    expect((ps12.data as { blockers: unknown[] }).blockers).toHaveLength(3);

    // 2件のみ復帰・完了
    await taskUpdate(store, { taskId: s12t1, state: "IN_PROGRESS" });
    await taskUpdate(store, { taskId: s12t1, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: s12t1, state: "DONE" });
    await taskUpdate(store, { taskId: s12t2, state: "IN_PROGRESS" });
    await taskUpdate(store, { taskId: s12t2, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: s12t2, state: "DONE" });
    // s12t3 はブロック継続

    const m12 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m12.completedTasks).toBe(2);
    expect(m12.completedPoints).toBe(10);

    await completeAndWrapUp("sprint-12");
    // H1: s12t3 は BLOCKED → BACKLOG に自動降格
    expect(store.getState().tasks[s12t3]).toBeDefined();
    expect(store.getState().tasks[s12t3].state).toBe("BACKLOG");
    expect(store.getState().tasks[s12t3].assignee).toBeNull();
    log(`  完了: 2/3 (10/13pt), 1件ブロック→BACKLOG自動降格`);

    // ================================================================
    // Sprint 13: 中止（BACKLOG タスク保持 → H2 検証）
    // ================================================================
    banner(13, "中止（BACKLOG 保持 → H2 検証）");

    // s12t3 は H1 により BACKLOG に自動降格済み
    // 新タスク追加
    const s13t1 = await mkTask("新決済連携", "high", 5);
    const s13t2 = await mkTask("新外部API", "medium", 3);
    // s12t3 は BACKLOG なので READY に戻してからスプリント追加
    await taskUpdate(store, { taskId: s12t3, state: "READY" });
    await sprintCreate(store, { goal: "外部連携v2", taskIds: [s12t3, s13t1, s13t2] });
    await quickActivate();

    // s12t3 を明示的に BACKLOG に降格（スプリント内で降格する意思表示）
    await taskUpdate(store, { taskId: s12t3, state: "BACKLOG" });
    expect(store.peek().tasks[s12t3].state).toBe("BACKLOG");

    await taskUpdate(store, { taskId: s13t1, state: "IN_PROGRESS", assignee: "dev-1" });

    // 中止 → H2: BACKLOG は保持される
    const cancel13 = await sprintCancel(store, { sprintId: "sprint-13", reason: "方針転換" });
    expect(cancel13.ok).toBe(true);

    // H2 検証: BACKLOG タスクは BACKLOG のまま
    expect(store.peek().tasks[s12t3].state).toBe("BACKLOG");
    // IN_PROGRESS, TODO は READY に
    expect(store.peek().tasks[s13t1].state).toBe("READY");
    expect(store.peek().tasks[s13t2].state).toBe("READY");

    const affectedTasks13 = (cancel13.data as { affectedTasks: Array<{ id: string }> }).affectedTasks;
    // IN_PROGRESS 1件 + TODO 1件 = 2件（BACKLOG は除外）
    expect(affectedTasks13).toHaveLength(2);
    log(`  H2 検証: BACKLOG 保持, 影響 ${affectedTasks13.length} タスク`);

    // ================================================================
    // Sprint 14: 3回分の持ち越し＆中止リカバリー
    // ================================================================
    banner(14, "3回分の持ち越しリカバリー");

    // s7t3(S7 BACKLOG残), s12t3(S13 BACKLOG残), s13t1(S13 READY戻), s13t2(S13 READY戻)
    await taskUpdate(store, { taskId: s7t3, state: "READY" });
    await taskUpdate(store, { taskId: s12t3, state: "READY" });
    // s8t1 は H1 によりキャンセル時にアーカイブ済み
    // s8t2 は READY
    await sprintCreate(store, {
      goal: "残タスク集約",
      taskIds: [s7t3, s12t3, s13t1, s13t2, s8t2],
    });
    await quickActivate();

    for (const id of [s7t3, s12t3, s13t1, s13t2, s8t2]) {
      await completeTask(id);
    }

    const m14 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m14.completedTasks).toBe(5);
    // s7t3=2, s12t3=3, s13t1=5, s13t2=3, s8t2=5 → 18
    expect(m14.completedPoints).toBe(18);

    await completeAndWrapUp("sprint-14");
    log(`  完了: 100% (${m14.completedPoints}pt, 5タスク = 3回分の残タスク)`);

    // ================================================================
    // Sprint 15: ポイント再見積もり（mid-sprint）
    // ================================================================
    banner(15, "ポイント再見積もり");

    const s15t1 = await mkTask("API v3 設計", "high", 8);
    const s15t2 = await mkTask("API v3 実装", "high", 13);
    const s15t3 = await mkTask("API v3 テスト", "medium", 5);
    await sprintCreate(store, { goal: "API v3", taskIds: [s15t1, s15t2, s15t3] });
    await quickActivate();

    // 着手後に再見積もり
    await taskUpdate(store, { taskId: s15t2, state: "IN_PROGRESS", assignee: "dev-1" });
    await taskUpdate(store, { taskId: s15t2, points: 8 }); // 13 → 8 に下方修正
    expect(store.peek().tasks[s15t2].points).toBe(8);
    expect(store.peek().tasks[s15t2].state).toBe("IN_PROGRESS"); // 状態不変

    await taskUpdate(store, { taskId: s15t3, points: 3 }); // 5 → 3 に下方修正

    await completeTask(s15t1, "dev-2");
    await taskUpdate(store, { taskId: s15t2, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: s15t2, state: "DONE" });
    await completeTask(s15t3, "dev-1");

    const m15 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m15.completedPoints).toBe(19); // 8+8+3
    expect(m15.totalPoints).toBe(19);

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
    expect(store.peek().tasks[s16t1].state).toBe("READY");
    expect(store.peek().tasks[s16t2].state).toBe("READY");

    // 即再起動（Sprint 17）
    log(`  中止 → Sprint 17 で即再起動`);

    // ================================================================
    // Sprint 17: 中止タスク集約 → 全完了
    // ================================================================
    banner(17, "中止タスク集約 → 全完了");

    // s3t3(S3中止, READY) + s16t1, s16t2(S16中止, READY)
    await sprintCreate(store, {
      goal: "検索改善 (確定)",
      taskIds: [s16t1, s16t2, s3t3],
    });
    await quickActivate();

    await completeTask(s16t1, "dev-1");
    await completeTask(s16t2, "dev-2");
    await completeTask(s3t3, "dev-1");

    const m17 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m17.completedPoints).toBe(11); // 5+3+3

    await completeAndWrapUp("sprint-17");
    log(`  完了: 100% (${m17.completedPoints}pt, 中止タスク全消化)`);

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

    const m18 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m18.completedPoints).toBe(39); // 13+13+8+5

    await completeAndWrapUp("sprint-18");
    log(`  完了: 100% (${m18.completedPoints}pt, 高ベロシティ)`);

    // ================================================================
    // Sprint 19: 複合状態遷移（BLOCKED+降格+優先度変更）
    // ================================================================
    banner(19, "複合状態遷移");

    const s19t1 = await mkTask("統合テストA", "high", 5);
    const s19t2 = await mkTask("統合テストB", "medium", 3);
    const s19t3 = await mkTask("統合テストC", "low", 2);
    const s19t4 = await mkTask("統合テストD", "medium", 3);
    await sprintCreate(store, { goal: "統合テスト", taskIds: [s19t1, s19t2, s19t3, s19t4] });
    await quickActivate();

    // s19t1: 着手 → ブロック → 復帰 → 完了
    await taskUpdate(store, { taskId: s19t1, state: "IN_PROGRESS", assignee: "dev-1" });
    await taskUpdate(store, { taskId: s19t1, state: "BLOCKED" });
    await taskUpdate(store, { taskId: s19t1, state: "IN_PROGRESS" });
    await taskUpdate(store, { taskId: s19t1, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: s19t1, state: "DONE" });

    // s19t2: 優先度変更 → 完了
    await taskUpdate(store, { taskId: s19t2, priority: "high" });
    await completeTask(s19t2, "dev-2");

    // s19t3: BACKLOG 降格
    await taskUpdate(store, { taskId: s19t3, state: "BACKLOG" });

    // s19t4: 完了
    await completeTask(s19t4, "dev-1");

    const m19 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m19.completedTasks).toBe(3);
    expect(m19.completedPoints).toBe(11); // 5+3+3

    await completeAndWrapUp("sprint-19");
    expect(store.getState().tasks[s19t3].state).toBe("BACKLOG");
    log(`  完了: 3/4 (${m19.completedPoints}pt), 降格1件, ブロック解除1件`);

    // ================================================================
    // Sprint 20: 最終スプリント + 総合検証
    // ================================================================
    banner(20, "最終 + 総合ベロシティ検証");

    // S19 の降格タスクを再利用 + s8t1(H1 によりアーカイブ済み)
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

    const m20 = (await metricsReport(store, {})).data as SprintMetrics;
    expect(m20.completedPoints).toBe(10); // 2+5+3

    await completeAndWrapUp("sprint-20");
    log(`  完了: 100% (${m20.completedPoints}pt)\n`);

    // ================================================================
    // 総合ベロシティ検証
    // ================================================================
    log("═══ 総合ベロシティ検証 ═══");

    const v = await velocityReport(store, {});
    expect(v.ok).toBe(true);
    const vd = v.data as VelocityData;

    // 完了スプリント: 1,2,4,5,6,7,9,10,11,12,14,15,17,18,19,20
    // 中止: 3,8,13,16
    const completedSprintIds = vd.sprints.map((s) => s.id);
    expect(vd.sprints).toHaveLength(16);
    expect(store.peek().sprints.filter((s) => s.state === "CANCELLED")).toHaveLength(4);

    // H1 検証: スナップショットベースの正確なベロシティ
    const expectedPoints: Array<{ id: string; pts: number }> = [
      { id: "sprint-1", pts: 16 },
      { id: "sprint-2", pts: 8 },     // 完了時点 2/4 タスク
      { id: "sprint-4", pts: 29 },    // 5タスク全完了
      { id: "sprint-5", pts: 12 },
      { id: "sprint-6", pts: 13 },
      { id: "sprint-7", pts: 13 },    // 完了時点 3/4 (BACKLOG除外)
      { id: "sprint-9", pts: 0 },
      { id: "sprint-10", pts: 8 },
      { id: "sprint-11", pts: 24 },
      { id: "sprint-12", pts: 10 },   // 完了時点 2/3
      { id: "sprint-14", pts: 18 },
      { id: "sprint-15", pts: 19 },   // 再見積もり反映
      { id: "sprint-17", pts: 11 },
      { id: "sprint-18", pts: 39 },   // 高ベロシティ
      { id: "sprint-19", pts: 11 },   // 3/4 (BACKLOG除外)
      { id: "sprint-20", pts: 10 },
    ];

    for (let i = 0; i < expectedPoints.length; i++) {
      expect(vd.sprints[i].id).toBe(expectedPoints[i].id);
      expect(vd.sprints[i].completedPoints).toBe(expectedPoints[i].pts);
      log(`  ${expectedPoints[i].id}: ${expectedPoints[i].pts}pt`);
    }

    const totalPts = expectedPoints.reduce((s, e) => s + e.pts, 0);
    const avgExpected = Math.round(totalPts / expectedPoints.length);
    expect(vd.averageVelocity).toBe(avgExpected);
    log(`\n  合計: ${totalPts}pt / ${expectedPoints.length}スプリント`);
    log(`  平均ベロシティ: ${vd.averageVelocity}pt/sprint`);
    log(`  平均完了率: ${vd.averageCompletionRate}%`);

    // lastN=5 で直近5スプリント
    const vLast5 = await velocityReport(store, { lastN: 5 });
    const vd5 = vLast5.data as VelocityData;
    expect(vd5.sprints).toHaveLength(5);
    expect(vd5.sprints[0].id).toBe("sprint-15");
    expect(vd5.sprints[4].id).toBe("sprint-20");
    log(`  lastN=5: ${vd5.sprints.map((s) => s.id).join(", ")}`);

    // ================================================================
    // 最終状態検証
    // ================================================================
    log("\n═══ 最終状態検証 ═══");

    const finalState = store.getState();

    // 20スプリント作成
    expect(finalState.sprints).toHaveLength(20);

    // 完了16 + 中止4
    const completed = finalState.sprints.filter((s) => s.state === "COMPLETED");
    const cancelled = finalState.sprints.filter((s) => s.state === "CANCELLED");
    expect(completed).toHaveLength(16);
    expect(cancelled).toHaveLength(4);
    expect(cancelled.map((s) => s.id)).toEqual(["sprint-3", "sprint-8", "sprint-13", "sprint-16"]);
    log(`  スプリント: ${completed.length}完了, ${cancelled.length}中止`);

    // H1: 全完了スプリントにメトリクススナップショットがある
    for (const sp of completed) {
      expect(sp.metrics).toBeDefined();
      expect(sp.metrics!.completedTasks).toBeGreaterThanOrEqual(0);
    }
    log(`  H1: 全完了スプリントにメトリクススナップショットあり`);

    // アーカイブ済タスク数
    const archivedCount = Object.keys(finalState.archivedTasks).length;
    const activeCount = Object.keys(finalState.tasks).length;
    log(`  アーカイブ済: ${archivedCount}件, アクティブ: ${activeCount}件`);
    expect(archivedCount).toBeGreaterThan(30);

    // セレモニー IDLE
    expect(finalState.ceremonyState).toBe("IDLE");
    expect(finalState.currentCeremony).toBeNull();
    log(`  セレモニー: IDLE`);

    // project_status
    const finalStatus = await projectStatus(store);
    expect(finalStatus.ok).toBe(true);
    expect(finalStatus.message).toContain("完了スプリント数: 16");
    expect(finalStatus.message).toContain("中止: 4");
    const fsData = finalStatus.data as { cancelledSprints: number; backlog: { totalPoints: number } };
    expect(fsData.cancelledSprints).toBe(4);
    log(`  project_status: 完了=16, 中止=4`);

    // M6: 負のポイントバリデーション
    const negResult = await taskCreate(store, {
      title: "neg",
      description: "d",
      acceptanceCriteria: [],
      priority: "medium",
      points: -1,
    });
    expect(negResult.ok).toBe(false);
    expect(negResult.error).toContain("0以上");
    log(`  M6: 負ポイント拒否確認`);

    log(`\n═══ 20スプリント机上回転 完了 ═══\n`);
  });
});
