/**
 * 机上10スプリント回転シミュレーション
 * 多様なシナリオを通じてスクラムMCPの堅牢性を網羅的に検証する
 *
 * Sprint 1:  正常フロー（全タスク完了、フルセレモニー）
 * Sprint 2:  部分完了 → 持ち越し
 * Sprint 3:  中止フロー（H1/H2 セレモニー＆タスクリセット検証）
 * Sprint 4:  持ち越しタスク再利用 + 新タスク追加
 * Sprint 5:  大量タスク（6件）＋ WIP 圧迫
 * Sprint 6:  ブロッカー多発 → 解除 → 完了
 * Sprint 7:  降格遷移（TODO→BACKLOG）+ 優先度変更
 * Sprint 8:  ポイントなしスプリント
 * Sprint 9:  中止 → 即再起動（同一タスク）
 * Sprint 10: 最終ベロシティ検証（全スプリント横断）
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
import { listTasks, getTask, projectStatus } from "../tools/query.js";
import type {
  Task,
  WipStatus,
  SprintMetrics,
  VelocityData,
  Priority,
} from "../types.js";

const TEST_FILE = "/tmp/scrum-desktop-10sprint.json";
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

/** タスク作成 → READY にして ID を返す */
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

/** フルセレモニーサイクル: refinement→planning→sprint→review→retro */
async function fullCeremony(
  phase: "refinement" | "planning-start" | "planning-end" | "sprint-start" | "review" | "retro"
) {
  switch (phase) {
    case "refinement":
      await ceremonyStart(store, { type: "refinement" });
      break;
    case "planning-start":
      await ceremonyEnd(store, { type: "refinement" });
      await ceremonyStart(store, { type: "planning" });
      break;
    case "planning-end":
      await ceremonyEnd(store, { type: "planning" });
      break;
    case "sprint-start":
      await ceremonyStart(store, { type: "sprint" });
      break;
    case "review":
      await ceremonyStart(store, { type: "review" });
      break;
    case "retro":
      await ceremonyEnd(store, { type: "review" });
      await ceremonyStart(store, { type: "retro" });
      await ceremonyEnd(store, { type: "retro" });
      break;
  }
}

/** タスクを TODO → IN_PROGRESS → IN_REVIEW → DONE に遷移 */
async function completeTask(taskId: string, assignee: string = "dev-1") {
  await taskUpdate(store, { taskId, state: "IN_PROGRESS", assignee });
  await taskUpdate(store, { taskId, state: "IN_REVIEW" });
  await taskUpdate(store, { taskId, state: "DONE" });
}

/** セレモニー省略でスプリントを ACTIVE にする */
async function quickActivate() {
  const s = store.peek();
  if (s.ceremonyState === "IDLE") {
    await ceremonyStart(store, { type: "planning" });
    await ceremonyEnd(store, { type: "planning" });
    await ceremonyStart(store, { type: "sprint" });
  }
}

/** review中にスプリント完了 → retro で IDLE に戻す */
async function completeAndWrapUp(sprintId: string) {
  // review は ACTIVE 中に開始する必要がある
  await ceremonyStart(store, { type: "review" });
  await sprintComplete(store, { sprintId });
  await ceremonyEnd(store, { type: "review" });
  await ceremonyStart(store, { type: "retro" });
  await ceremonyEnd(store, { type: "retro" });
  expect(store.peek().ceremonyState).toBe("IDLE");
}

describe("机上10スプリント回転", () => {
  it("Sprint 1〜10 を連続実行", async () => {
    // ================================================================
    // Sprint 1: 正常フロー（フルセレモニー、3タスク全完了）
    // ================================================================
    console.log("\n╔═══════════════════════════════════════╗");
    console.log("║  Sprint 1: 正常フロー（全完了）       ║");
    console.log("╚═══════════════════════════════════════╝");

    await fullCeremony("refinement");
    expect(store.peek().ceremonyState).toBe("REFINEMENT");

    const s1t1 = await mkTask("ユーザー認証API", "high", 8);
    const s1t2 = await mkTask("ダッシュボードUI", "medium", 5);
    const s1t3 = await mkTask("通知システム", "low", 3);

    await fullCeremony("planning-start");
    expect(store.peek().ceremonyState).toBe("PLANNING");

    const sp1 = await sprintCreate(store, {
      goal: "認証基盤MVP",
      taskIds: [s1t1, s1t2, s1t3],
    });
    expect(sp1.ok).toBe(true);
    console.log(`  スプリント作成: ${(sp1.data as any).sprintId} (3タスク, 16pt)`);

    await fullCeremony("planning-end");
    await fullCeremony("sprint-start");
    expect(store.peek().currentSprint!.state).toBe("ACTIVE");

    await completeTask(s1t1, "dev-1");
    await completeTask(s1t2, "dev-2");
    await completeTask(s1t3, "dev-1");

    const m1 = await metricsReport(store, {});
    const md1 = m1.data as SprintMetrics;
    expect(md1.completedTasks).toBe(3);
    expect(md1.completionRate).toBe(100);
    expect(md1.completedPoints).toBe(16);

    // review 中にスプリント完了（review は ACTIVE 中に開始が必要）
    await ceremonyStart(store, { type: "review" });
    await sprintComplete(store, { sprintId: "sprint-1" });
    expect(store.peek().currentSprint!.state).toBe("COMPLETED");

    // アーカイブ確認
    expect(store.getState().archivedTasks[s1t1]).toBeDefined();
    expect(store.getState().archivedTasks[s1t2]).toBeDefined();
    expect(store.getState().archivedTasks[s1t3]).toBeDefined();

    await ceremonyEnd(store, { type: "review" });
    await ceremonyStart(store, { type: "retro" });
    await ceremonyEnd(store, { type: "retro" });
    expect(store.peek().ceremonyState).toBe("IDLE");
    console.log(`  完了: 100% (16pt), 3タスクアーカイブ済\n`);

    // ================================================================
    // Sprint 2: 部分完了 → 持ち越し
    // ================================================================
    console.log("╔═══════════════════════════════════════╗");
    console.log("║  Sprint 2: 部分完了 → 持ち越し       ║");
    console.log("╚═══════════════════════════════════════╝");

    const s2t1 = await mkTask("商品一覧API", "high", 5);
    const s2t2 = await mkTask("商品詳細API", "medium", 3);
    const s2t3 = await mkTask("在庫管理API", "medium", 8);
    const s2t4 = await mkTask("お気に入り機能", "low", 2);

    await sprintCreate(store, { goal: "商品カタログ", taskIds: [s2t1, s2t2, s2t3, s2t4] });
    await quickActivate();

    await completeTask(s2t1, "dev-1");
    await completeTask(s2t2, "dev-2");
    // s2t3, s2t4 は未完了
    await taskUpdate(store, { taskId: s2t3, state: "IN_PROGRESS", assignee: "dev-1" });

    const m2 = await metricsReport(store, {});
    const md2 = m2.data as SprintMetrics;
    expect(md2.completedTasks).toBe(2);
    expect(md2.completionRate).toBe(50);
    expect(md2.completedPoints).toBe(8);
    expect(md2.totalPoints).toBe(18);

    await ceremonyStart(store, { type: "review" });
    await sprintComplete(store, { sprintId: "sprint-2" });

    // DONE の2件アーカイブ、未完了2件は残留
    expect(store.getState().archivedTasks[s2t1]).toBeDefined();
    expect(store.getState().archivedTasks[s2t2]).toBeDefined();
    expect(store.getState().tasks[s2t3]).toBeDefined();
    expect(store.getState().tasks[s2t4]).toBeDefined();

    await ceremonyEnd(store, { type: "review" });
    await ceremonyStart(store, { type: "retro" });
    await ceremonyEnd(store, { type: "retro" });

    // 持ち越し
    const carry2 = await sprintCarryOver(store, { sprintId: "sprint-2" });
    expect(carry2.ok).toBe(true);
    expect(store.peek().tasks[s2t3].state).toBe("READY");
    expect(store.peek().tasks[s2t4].state).toBe("READY");
    console.log(`  完了: 50% (8/18pt), 2タスク持ち越し\n`);

    // ================================================================
    // Sprint 3: 中止フロー（H1/H2 セレモニー＆タスクリセット検証）
    // ================================================================
    console.log("╔═══════════════════════════════════════╗");
    console.log("║  Sprint 3: 中止フロー                ║");
    console.log("╚═══════════════════════════════════════╝");

    const s3t1 = await mkTask("決済Stripe統合", "high", 8);
    const s3t2 = await mkTask("決済PayPal統合", "high", 8);
    const s3t3 = await mkTask("レシート生成", "medium", 3);

    await sprintCreate(store, { goal: "決済基盤", taskIds: [s3t1, s3t2, s3t3] });
    await quickActivate();

    // 2タスク着手
    await taskUpdate(store, { taskId: s3t1, state: "IN_PROGRESS", assignee: "dev-1" });
    await taskUpdate(store, { taskId: s3t2, state: "IN_PROGRESS", assignee: "dev-2" });
    expect(store.peek().ceremonyState).toBe("SPRINT_ACTIVE");
    expect(store.peek().currentCeremony).toBe("sprint");

    // H1/H2: スプリント中止 → セレモニー状態リセット + タスクREADY化
    const cancel3 = await sprintCancel(store, {
      sprintId: "sprint-3",
      reason: "決済プロバイダ未契約",
    });
    expect(cancel3.ok).toBe(true);

    // H1: セレモニー状態がクリーンアップされること
    expect(store.peek().ceremonyState).toBe("IDLE");
    expect(store.peek().currentCeremony).toBeNull();

    // H2: 全タスクが READY に戻ること
    expect(store.peek().tasks[s3t1].state).toBe("READY");
    expect(store.peek().tasks[s3t2].state).toBe("READY");
    expect(store.peek().tasks[s3t3].state).toBe("READY");
    expect(store.peek().tasks[s3t1].assignee).toBeNull();
    expect(store.peek().tasks[s3t2].assignee).toBeNull();

    // H2: 影響タスク警告 (IN_PROGRESS 2件 + TODO 1件 = 3件)
    const cancelData = cancel3.data as { affectedTasks: Array<{ previousState: string }> };
    expect(cancelData.affectedTasks).toHaveLength(3);
    expect(cancel3.message).toContain("READY に戻しました");

    console.log(`  中止: セレモニーIDLE化、3タスクREADY化`);
    console.log(`  影響タスク: ${cancelData.affectedTasks.length} 件 (IN_PROGRESS 2 + TODO 1)\n`);

    // ================================================================
    // Sprint 4: 持ち越しタスク再利用 + 新タスク追加
    // ================================================================
    console.log("╔═══════════════════════════════════════╗");
    console.log("║  Sprint 4: 持ち越し再利用 + 追加     ║");
    console.log("╚═══════════════════════════════════════╝");

    // Sprint 2 持ち越しタスク (s2t3, s2t4) + Sprint 3 中止タスク (s3t1) を再利用
    // s3t1 は既に READY（sprint_cancel が戻した）
    const sp4 = await sprintCreate(store, {
      goal: "決済＆在庫リカバリー",
      taskIds: [s2t3, s2t4, s3t1],
    });
    expect(sp4.ok).toBe(true);

    // sprint_add_tasks で追加
    const s4tNew = await mkTask("購入履歴API", "medium", 3);
    const add4 = await sprintAddTasks(store, {
      sprintId: "sprint-4",
      taskIds: [s4tNew],
    });
    expect(add4.ok).toBe(true);
    expect(store.peek().currentSprint!.tasks).toHaveLength(4);

    await quickActivate();

    // 全完了
    await completeTask(s2t3, "dev-1");
    await completeTask(s2t4, "dev-2");
    await completeTask(s3t1, "dev-1");
    await completeTask(s4tNew, "dev-2");

    const m4 = await metricsReport(store, {});
    const md4 = m4.data as SprintMetrics;
    expect(md4.completedTasks).toBe(4);
    expect(md4.completionRate).toBe(100);
    expect(md4.completedPoints).toBe(21); // 8+2+8+3
    console.log(`  4タスク全完了 (${md4.completedPoints}pt)`);

    await completeAndWrapUp("sprint-4");
    console.log(`  完了: 100% (21pt)\n`);

    // ================================================================
    // Sprint 5: 大量タスク（6件）＋ WIP 圧迫
    // ================================================================
    console.log("╔═══════════════════════════════════════╗");
    console.log("║  Sprint 5: 大量タスク + WIP圧迫      ║");
    console.log("╚═══════════════════════════════════════╝");

    const s5ids: string[] = [];
    for (let i = 1; i <= 6; i++) {
      s5ids.push(await mkTask(`機能${i}`, i <= 2 ? "high" : "medium", 2));
    }

    await sprintCreate(store, { goal: "一括機能追加", taskIds: s5ids });
    await quickActivate();

    // WIP 制限 (inProgress=2) を超える着手
    await taskUpdate(store, { taskId: s5ids[0], state: "IN_PROGRESS", assignee: "dev-1" });
    await taskUpdate(store, { taskId: s5ids[1], state: "IN_PROGRESS", assignee: "dev-2" });
    const wip5a = await wipStatus(store);
    expect((wip5a.data as WipStatus).warning).toContain("制限到達");

    // 3つ目着手 → WIP超過警告
    const wip5warn = await taskUpdate(store, { taskId: s5ids[2], state: "IN_PROGRESS", assignee: "dev-3" });
    expect(wip5warn.ok).toBe(true);
    expect(wip5warn.message).toContain("WIP制限警告");
    console.log(`  WIP超過警告: ${wip5warn.message?.split("\n")[1]}`);

    const wip5b = await wipStatus(store);
    expect((wip5b.data as WipStatus).warning).toContain("制限超過");

    // 順次完了
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
    console.log(`  完了: 100% (12pt, 6タスク)\n`);

    // ================================================================
    // Sprint 6: ブロッカー多発 → 解除 → 完了
    // ================================================================
    console.log("╔═══════════════════════════════════════╗");
    console.log("║  Sprint 6: ブロッカー多発             ║");
    console.log("╚═══════════════════════════════════════╝");

    const s6t1 = await mkTask("外部API統合", "high", 5);
    const s6t2 = await mkTask("DB マイグレーション", "high", 5);
    const s6t3 = await mkTask("E2Eテスト", "medium", 3);

    await sprintCreate(store, { goal: "統合テスト", taskIds: [s6t1, s6t2, s6t3] });
    await quickActivate();

    // 全タスク着手 → ブロック
    await taskUpdate(store, { taskId: s6t1, state: "IN_PROGRESS", assignee: "dev-1" });
    await taskUpdate(store, { taskId: s6t1, state: "BLOCKED" });
    await taskUpdate(store, { taskId: s6t2, state: "IN_PROGRESS", assignee: "dev-2" });
    await taskUpdate(store, { taskId: s6t2, state: "BLOCKED" });

    // project_status でブロッカー検出
    const ps6 = await projectStatus(store);
    const ps6data = ps6.data as { blockers: Array<{ id: string }> };
    expect(ps6data.blockers).toHaveLength(2);
    expect(ps6.message).toContain("ブロッカー: 2 件");
    console.log(`  ブロッカー: ${ps6data.blockers.length} 件検出`);

    // ブロック解除 → 完了
    await taskUpdate(store, { taskId: s6t1, state: "IN_PROGRESS" });
    await taskUpdate(store, { taskId: s6t1, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: s6t1, state: "DONE" });

    await taskUpdate(store, { taskId: s6t2, state: "IN_PROGRESS" });
    await taskUpdate(store, { taskId: s6t2, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: s6t2, state: "DONE" });

    await completeTask(s6t3, "dev-1");

    await completeAndWrapUp("sprint-6");
    console.log(`  完了: 100% (13pt, ブロッカー全解除)\n`);

    // ================================================================
    // Sprint 7: 降格遷移（TODO→BACKLOG）+ 優先度変更
    // ================================================================
    console.log("╔═══════════════════════════════════════╗");
    console.log("║  Sprint 7: 降格 + 優先度変更          ║");
    console.log("╚═══════════════════════════════════════╝");

    const s7t1 = await mkTask("検索機能", "high", 5);
    const s7t2 = await mkTask("フィルタ機能", "medium", 3);
    const s7t3 = await mkTask("ソート機能", "low", 2);
    const s7t4 = await mkTask("ページング", "medium", 3);

    await sprintCreate(store, { goal: "検索機能", taskIds: [s7t1, s7t2, s7t3, s7t4] });
    await quickActivate();

    // s7t3 を TODO → BACKLOG に降格（スプリントから外す意思表示）
    const demote = await taskUpdate(store, { taskId: s7t3, state: "BACKLOG" });
    expect(demote.ok).toBe(true);
    expect(store.peek().tasks[s7t3].state).toBe("BACKLOG");
    console.log(`  降格: ${s7t3} TODO → BACKLOG`);

    // 優先度変更（状態不変）
    const prioChange = await taskUpdate(store, { taskId: s7t4, priority: "high" });
    expect(prioChange.ok).toBe(true);
    expect(store.peek().tasks[s7t4].priority).toBe("high");
    expect(store.peek().tasks[s7t4].state).toBe("TODO");
    console.log(`  優先度変更: ${s7t4} medium → high（状態不変）`);

    // ポイント変更（状態不変）
    const ptsChange = await taskUpdate(store, { taskId: s7t4, points: 5 });
    expect(ptsChange.ok).toBe(true);
    expect(store.peek().tasks[s7t4].points).toBe(5);
    console.log(`  ポイント変更: ${s7t4} 3pt → 5pt`);

    // 残り3タスク完了
    await completeTask(s7t1, "dev-1");
    await completeTask(s7t2, "dev-2");
    await completeTask(s7t4, "dev-1");

    const m7 = await metricsReport(store, {});
    const md7 = m7.data as SprintMetrics;
    // s7t3 は BACKLOG だが sprint.tasks にはまだ含まれる
    expect(md7.totalTasks).toBe(4);
    expect(md7.completedTasks).toBe(3);
    expect(md7.completedPoints).toBe(13); // 5+3+5

    await completeAndWrapUp("sprint-7");

    // s7t3 は BACKLOG なので DONE ではない → アーカイブされない
    expect(store.getState().tasks[s7t3]).toBeDefined();
    expect(store.getState().tasks[s7t3].state).toBe("BACKLOG");
    console.log(`  完了: 3/4タスク (13pt), BACKLOG降格タスク残留\n`);

    // ================================================================
    // Sprint 8: ポイントなしスプリント
    // ================================================================
    console.log("╔═══════════════════════════════════════╗");
    console.log("║  Sprint 8: ポイントなし               ║");
    console.log("╚═══════════════════════════════════════╝");

    const s8t1 = await mkTask("ドキュメント整備", "low");
    const s8t2 = await mkTask("CI設定", "medium");
    const s8t3 = await mkTask("リンター導入", "medium");

    await sprintCreate(store, { goal: "開発基盤整備", taskIds: [s8t1, s8t2, s8t3] });
    await quickActivate();

    await completeTask(s8t1, "dev-1");
    await completeTask(s8t2, "dev-1");
    await completeTask(s8t3, "dev-2");

    const m8 = await metricsReport(store, {});
    const md8 = m8.data as SprintMetrics;
    expect(md8.completedTasks).toBe(3);
    expect(md8.completionRate).toBe(100);
    expect(md8.totalPoints).toBe(0);
    expect(md8.completedPoints).toBe(0);
    console.log(`  ポイントなし: 3タスク完了、0pt (正常動作)`);

    await completeAndWrapUp("sprint-8");
    console.log(`  完了: 100% (0pt)\n`);

    // ================================================================
    // Sprint 9: 中止 → 即再起動（同一タスク）
    // ================================================================
    console.log("╔═══════════════════════════════════════╗");
    console.log("║  Sprint 9: 中止 → 即再起動            ║");
    console.log("╚═══════════════════════════════════════╝");

    // Sprint 3 の未使用タスク (s3t2, s3t3) + Sprint 7 のBACKLOG残 (s7t3) を再利用
    // s3t2, s3t3 は sprint_cancel で READY に戻っている
    // s7t3 は BACKLOG → READY に戻す
    await taskUpdate(store, { taskId: s7t3, state: "READY" });

    await sprintCreate(store, {
      goal: "残タスク消化 (試行1)",
      taskIds: [s3t2, s3t3, s7t3],
    });
    await quickActivate();

    // 1タスクだけ着手
    await taskUpdate(store, { taskId: s3t2, state: "IN_PROGRESS", assignee: "dev-1" });

    // 即中止
    const cancel9 = await sprintCancel(store, {
      sprintId: "sprint-9",
      reason: "方針再検討",
    });
    expect(cancel9.ok).toBe(true);
    expect(store.peek().ceremonyState).toBe("IDLE");
    // 全タスクが READY に戻る
    expect(store.peek().tasks[s3t2].state).toBe("READY");
    expect(store.peek().tasks[s3t3].state).toBe("READY");
    expect(store.peek().tasks[s7t3].state).toBe("READY");
    console.log(`  中止後: 全3タスク READY 状態`);

    // IDLE なので直接 planning から再起動
    // 同じタスクで Sprint 10 を作成（sprint_cancel がタスクを READY に戻すので可能）
    console.log(`  → Sprint 10 に同一タスクで再起動\n`);

    // ================================================================
    // Sprint 10: 最終スプリント + ベロシティ検証
    // ================================================================
    console.log("╔═══════════════════════════════════════╗");
    console.log("║  Sprint 10: 最終 + ベロシティ総括     ║");
    console.log("╚═══════════════════════════════════════╝");

    await sprintCreate(store, {
      goal: "残タスク消化 (確定)",
      taskIds: [s3t2, s3t3, s7t3],
    });
    await quickActivate();

    await completeTask(s3t2, "dev-1");
    await completeTask(s3t3, "dev-2");
    await completeTask(s7t3, "dev-1");

    const m10 = await metricsReport(store, {});
    const md10 = m10.data as SprintMetrics;
    expect(md10.completedTasks).toBe(3);
    expect(md10.completionRate).toBe(100);
    expect(md10.completedPoints).toBe(13); // 8+3+2

    await completeAndWrapUp("sprint-10");
    console.log(`  完了: 100% (${md10.completedPoints}pt)\n`);

    // ================================================================
    // ベロシティ総括
    // ================================================================
    console.log("╔═══════════════════════════════════════════════════╗");
    console.log("║  ベロシティ総括                                  ║");
    console.log("╚═══════════════════════════════════════════════════╝");

    const v = await velocityReport(store, {});
    expect(v.ok).toBe(true);
    const vd = v.data as VelocityData;

    // 完了スプリント: 1,2,4,5,6,7,8,10 (Sprint 3,9 は CANCELLED)
    expect(vd.sprints).toHaveLength(8);
    expect(store.peek().sprints.filter((s) => s.state === "CANCELLED")).toHaveLength(2);

    // 各スプリントのポイント確認
    // ※ velocityReport はタスクの「現在の」状態を見るため、
    //   後のスプリントで完了したタスクも遡及的に DONE としてカウントされる
    const expectedPoints = [
      { id: "sprint-1", pts: 16 },    // 全完了
      { id: "sprint-2", pts: 18 },    // s2t3,s2t4 は Sprint 4 で完了 → 遡及的に全DONE
      { id: "sprint-4", pts: 21 },    // 全完了
      { id: "sprint-5", pts: 12 },    // 全完了
      { id: "sprint-6", pts: 13 },    // 全完了
      { id: "sprint-7", pts: 15 },    // s7t3 は Sprint 10 で完了 → 遡及的に全DONE
      { id: "sprint-8", pts: 0 },     // ポイントなし
      { id: "sprint-10", pts: 13 },   // 全完了
    ];

    for (let i = 0; i < expectedPoints.length; i++) {
      expect(vd.sprints[i].id).toBe(expectedPoints[i].id);
      expect(vd.sprints[i].completedPoints).toBe(expectedPoints[i].pts);
      console.log(`  ${expectedPoints[i].id}: ${expectedPoints[i].pts}pt`);
    }

    const totalPts = expectedPoints.reduce((s, e) => s + e.pts, 0);
    const avgExpected = Math.round(totalPts / expectedPoints.length);
    expect(vd.averageVelocity).toBe(avgExpected);
    console.log(`\n  合計: ${totalPts}pt / ${expectedPoints.length}スプリント`);
    console.log(`  平均ベロシティ: ${vd.averageVelocity}pt/sprint`);
    console.log(`  平均完了率: ${vd.averageCompletionRate}%`);

    // lastN=3 で直近3スプリントのみ
    const vLast3 = await velocityReport(store, { lastN: 3 });
    const vd3 = vLast3.data as VelocityData;
    expect(vd3.sprints).toHaveLength(3);
    expect(vd3.sprints[0].id).toBe("sprint-7");
    expect(vd3.sprints[1].id).toBe("sprint-8");
    expect(vd3.sprints[2].id).toBe("sprint-10");
    console.log(`  lastN=3: ${vd3.sprints.map((s) => s.id).join(", ")}`);

    // ================================================================
    // 最終状態検証
    // ================================================================
    console.log("\n╔═══════════════════════════════════════════════════╗");
    console.log("║  最終状態検証                                    ║");
    console.log("╚═══════════════════════════════════════════════════╝");

    const finalState = store.getState();

    // 10スプリント作成されたこと
    expect(finalState.sprints).toHaveLength(10);

    // 完了 8 + 中止 2
    const completed = finalState.sprints.filter((s) => s.state === "COMPLETED");
    const cancelled = finalState.sprints.filter((s) => s.state === "CANCELLED");
    expect(completed).toHaveLength(8);
    expect(cancelled).toHaveLength(2);
    expect(cancelled[0].id).toBe("sprint-3");
    expect(cancelled[1].id).toBe("sprint-9");
    console.log(`  スプリント: ${completed.length}完了, ${cancelled.length}中止`);

    // アーカイブ済タスク数
    const archivedCount = Object.keys(finalState.archivedTasks).length;
    console.log(`  アーカイブ済タスク: ${archivedCount}件`);
    expect(archivedCount).toBeGreaterThan(15);

    // アクティブタスクはほぼ空
    const activeTasks = Object.values(finalState.tasks);
    console.log(`  アクティブタスク: ${activeTasks.length}件`);

    // セレモニー状態が IDLE
    expect(finalState.ceremonyState).toBe("IDLE");
    expect(finalState.currentCeremony).toBeNull();
    console.log(`  セレモニー: IDLE`);

    // project_status が正常に取得できる
    const finalStatus = await projectStatus(store);
    expect(finalStatus.ok).toBe(true);
    expect(finalStatus.message).toContain("完了スプリント数: 8");

    // M2: ポイント情報が含まれること
    const fsData = finalStatus.data as { backlog: { totalPoints: number } };
    expect(fsData.backlog).toHaveProperty("totalPoints");
    console.log(`  project_status: OK (完了スプリント数=8)\n`);

    console.log("╔═══════════════════════════════════════════════════╗");
    console.log("║  10スプリント机上回転 完了                       ║");
    console.log("╚═══════════════════════════════════════════════════╝\n");
  });
});
