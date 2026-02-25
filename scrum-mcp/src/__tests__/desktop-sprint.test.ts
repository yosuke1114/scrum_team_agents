/**
 * 机上スプリント4回転シミュレーション
 * 10改善すべてを網羅的に検証する
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink } from "node:fs/promises";
import { StateStore } from "../state/store.js";
import { ceremonyStart, ceremonyEnd } from "../tools/ceremony.js";
import { sprintCreate, sprintAddTasks, sprintComplete, sprintCarryOver, sprintCancel } from "../tools/sprint.js";
import { taskCreate, taskUpdate } from "../tools/task.js";
import { metricsReport } from "../tools/metrics.js";
import { wipStatus } from "../tools/wip.js";
import { velocityReport } from "../tools/velocity.js";
import { listTasks, getTask, projectStatus } from "../tools/query.js";
import type { Task, WipStatus, SprintMetrics, VelocityData } from "../types.js";

const TEST_FILE = "/tmp/scrum-desktop-sprint.json";
let store: StateStore;

beforeEach(async () => {
  store = await StateStore.init(TEST_FILE);
});

afterEach(async () => {
  try { await unlink(TEST_FILE); } catch { /* ignore */ }
});

describe("机上4スプリント回転", () => {

  it("Sprint 1: 正常フロー（Refinement → Planning → Sprint → Review → Retro）", async () => {
    console.log("\n=== Sprint 1: 正常フロー ===");

    // ---- Refinement ----
    console.log("--- Refinement ---");
    await ceremonyStart(store, { type: "refinement" });
    expect(store.peek().ceremonyState).toBe("REFINEMENT");

    // PO がタスク作成（#2 UUID ID 検証）
    const t1 = await taskCreate(store, {
      title: "ユーザー認証API",
      description: "JWT ベースの認証エンドポイント",
      acceptanceCriteria: ["POST /login", "POST /register", "GET /me"],
      priority: "high",
      points: 8,  // #4 ポイント付き
    });
    expect(t1.ok).toBe(true);
    const t1Id = (t1.data as { taskId: string }).taskId;
    expect(t1Id).toMatch(/^task-[0-9a-f-]{36}$/);  // #2 UUID 形式

    const t2 = await taskCreate(store, {
      title: "ダッシュボードUI",
      description: "メトリクス表示画面",
      acceptanceCriteria: ["グラフ表示", "リアルタイム更新"],
      priority: "medium",
      points: 5,
    });
    const t2Id = (t2.data as { taskId: string }).taskId;

    const t3 = await taskCreate(store, {
      title: "通知システム",
      description: "Slack/メール通知",
      acceptanceCriteria: ["Slack webhook", "メールテンプレート"],
      priority: "low",
      points: 3,
    });
    const t3Id = (t3.data as { taskId: string }).taskId;

    // ID がすべて異なること（#2 衝突回避）
    expect(new Set([t1Id, t2Id, t3Id]).size).toBe(3);

    // PO が READY に昇格
    await taskUpdate(store, { taskId: t1Id, state: "READY" });
    await taskUpdate(store, { taskId: t2Id, state: "READY" });
    await taskUpdate(store, { taskId: t3Id, state: "READY" });

    // #7 ポイントのみ更新（状態変更なし）
    const pointsUpdate = await taskUpdate(store, { taskId: t3Id, points: 5 });
    expect(pointsUpdate.ok).toBe(true);
    expect(store.peek().tasks[t3Id].points).toBe(5);
    expect(store.peek().tasks[t3Id].state).toBe("READY");  // 状態は変わらない

    await ceremonyEnd(store, { type: "refinement" });
    expect(store.peek().ceremonyState).toBe("IDLE");
    console.log("  タスク3件作成、READY化、ポイント更新OK");

    // ---- Planning ----
    console.log("--- Planning ---");
    await ceremonyStart(store, { type: "planning" });

    // #1 既存タスクIDでスプリント作成
    const sprintResult = await sprintCreate(store, {
      goal: "認証基盤MVP",
      taskIds: [t1Id, t2Id],  // t3 はバックログに残す
    });
    expect(sprintResult.ok).toBe(true);
    expect(store.peek().currentSprint!.tasks).toHaveLength(2);
    expect(store.peek().tasks[t1Id].state).toBe("TODO");  // READY → TODO 自動遷移
    expect(store.peek().tasks[t2Id].state).toBe("TODO");

    // #1 sprint_add_tasks でタスク追加
    const addResult = await sprintAddTasks(store, {
      sprintId: "sprint-1",
      taskIds: [t3Id],
    });
    expect(addResult.ok).toBe(true);
    expect(store.peek().currentSprint!.tasks).toHaveLength(3);

    await ceremonyEnd(store, { type: "planning" });
    console.log("  スプリント作成、タスク追加OK");

    // ---- Sprint Active ----
    console.log("--- Sprint ---");
    await ceremonyStart(store, { type: "sprint" });
    expect(store.peek().ceremonyState).toBe("SPRINT_ACTIVE");
    expect(store.peek().currentSprint!.state).toBe("ACTIVE");

    // Dev がタスク着手
    await taskUpdate(store, { taskId: t1Id, state: "IN_PROGRESS", assignee: "dev-1" });
    await taskUpdate(store, { taskId: t2Id, state: "IN_PROGRESS", assignee: "dev-2" });

    // #6 WIP がスプリントスコープ
    const wip1 = await wipStatus(store);
    const wipData1 = wip1.data as WipStatus;
    expect(wipData1.inProgress).toBe(2);
    expect(wipData1.warning).toContain("制限到達");  // WIP制限 = 2
    console.log(`  WIP: ${wipData1.inProgress} (warning: ${wipData1.warning})`);

    // t1 完了
    await taskUpdate(store, { taskId: t1Id, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: t1Id, state: "DONE" });

    // t3 着手
    await taskUpdate(store, { taskId: t3Id, state: "IN_PROGRESS", assignee: "dev-1" });
    await taskUpdate(store, { taskId: t3Id, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: t3Id, state: "DONE" });

    // t2 は IN_PROGRESS のまま（未完了で持ち越し対象）

    // project_status 確認
    const status1 = await projectStatus(store);
    expect(status1.ok).toBe(true);
    expect(status1.message).toContain("認証基盤MVP");
    console.log(`  project_status: OK`);

    // ---- Review ----
    console.log("--- Review ---");
    await ceremonyStart(store, { type: "review" });
    expect(store.peek().ceremonyState).toBe("SPRINT_REVIEW");

    // #4 メトリクス（ポイント計算）
    const metrics = await metricsReport(store, {});
    const metricsData = metrics.data as SprintMetrics;
    expect(metricsData.totalTasks).toBe(3);
    expect(metricsData.completedTasks).toBe(2);
    expect(metricsData.completionRate).toBe(67);
    expect(metricsData.totalPoints).toBe(18);      // 8 + 5 + 5
    expect(metricsData.completedPoints).toBe(13);   // 8 + 5 (t1 + t3)
    console.log(`  メトリクス: ${metricsData.completedTasks}/${metricsData.totalTasks} tasks, ${metricsData.completedPoints}/${metricsData.totalPoints} pt`);

    // #5 スプリント完了 → DONE タスク自動アーカイブ
    const completeResult = await sprintComplete(store, { sprintId: "sprint-1" });
    expect(completeResult.ok).toBe(true);
    expect(completeResult.data!.completedPoints).toBe(13);

    // DONE タスク (t1, t3) がアーカイブされたことを確認
    const stateAfterComplete = store.getState();
    expect(stateAfterComplete.archivedTasks[t1Id]).toBeDefined();
    expect(stateAfterComplete.archivedTasks[t3Id]).toBeDefined();
    expect(stateAfterComplete.tasks[t1Id]).toBeUndefined();
    expect(stateAfterComplete.tasks[t3Id]).toBeUndefined();
    // 未完了 (t2) はまだ tasks に残る
    expect(stateAfterComplete.tasks[t2Id]).toBeDefined();
    console.log(`  DONE 2件アーカイブ、未完了 1件残留`);

    // アーカイブ済みタスクを get_task で取得（#5）
    const archivedTask = await getTask(store, { taskId: t1Id });
    expect(archivedTask.ok).toBe(true);
    expect(archivedTask.message).toContain("アーカイブ済");
    console.log(`  アーカイブ済タスク取得OK`);

    await ceremonyEnd(store, { type: "review" });

    // ---- Retro ----
    console.log("--- Retro ---");
    await ceremonyStart(store, { type: "retro" });
    await ceremonyEnd(store, { type: "retro" });
    expect(store.peek().ceremonyState).toBe("IDLE");

    // #3 持ち越し
    const carryOver = await sprintCarryOver(store, { sprintId: "sprint-1" });
    expect(carryOver.ok).toBe(true);
    expect(store.peek().tasks[t2Id].state).toBe("READY");  // IN_PROGRESS → READY に戻る
    console.log(`  Sprint 1 完了、未完了タスク持ち越しOK\n`);
  });

  it("Sprint 2: 中止フロー + Sprint 3: ベロシティ検証", async () => {
    console.log("\n=== Sprint 2+3: 中止フロー & ベロシティ ===");

    // -- Sprint 1 完了（ベロシティ蓄積用） --
    const s1Tasks: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await taskCreate(store, {
        title: `S1-Task${i + 1}`, description: "d", acceptanceCriteria: [],
        priority: "high", points: 5,
      });
      const id = (r.data as { taskId: string }).taskId;
      await taskUpdate(store, { taskId: id, state: "READY" });
      s1Tasks.push(id);
    }
    await sprintCreate(store, { goal: "Sprint 1", taskIds: s1Tasks });
    await store.update((s) => {
      s.currentSprint!.state = "ACTIVE";
      s.currentSprint!.startedAt = new Date().toISOString();
    });
    for (const id of s1Tasks) {
      await taskUpdate(store, { taskId: id, state: "IN_PROGRESS" });
      await taskUpdate(store, { taskId: id, state: "IN_REVIEW" });
      await taskUpdate(store, { taskId: id, state: "DONE" });
    }
    await sprintComplete(store, { sprintId: "sprint-1" });
    console.log("  Sprint 1: 2タスク x 5pt 全完了");

    // -- Sprint 2: 中止フロー (#9) --
    console.log("--- Sprint 2: 中止 ---");
    const s2Tasks: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await taskCreate(store, {
        title: `S2-Task${i + 1}`, description: "d", acceptanceCriteria: [],
        priority: "medium", points: 3,
      });
      const id = (r.data as { taskId: string }).taskId;
      await taskUpdate(store, { taskId: id, state: "READY" });
      s2Tasks.push(id);
    }
    await sprintCreate(store, { goal: "Sprint 2 - 中止予定", taskIds: s2Tasks });
    await store.update((s) => {
      s.currentSprint!.state = "ACTIVE";
      s.currentSprint!.startedAt = new Date().toISOString();
    });

    // 1タスクだけ着手
    await taskUpdate(store, { taskId: s2Tasks[0], state: "IN_PROGRESS", assignee: "dev-1" });

    // #9 スプリント中止
    const cancelResult = await sprintCancel(store, {
      sprintId: "sprint-2",
      reason: "要件変更により方針転換",
    });
    expect(cancelResult.ok).toBe(true);
    expect(store.peek().currentSprint!.state).toBe("CANCELLED");
    console.log(`  Sprint 2 中止: ${cancelResult.message}`);

    // #3 中止スプリントからの持ち越し
    const carryOver2 = await sprintCarryOver(store, { sprintId: "sprint-2" });
    expect(carryOver2.ok).toBe(true);
    for (const id of s2Tasks) {
      const task = store.peek().tasks[id];
      expect(task.state).toBe("READY");  // 全タスクが READY に戻る
    }
    console.log("  中止スプリントからの持ち越しOK");

    // Retro（中止後もRetrospective可能）
    await store.update((s) => { s.ceremonyState = "SPRINT_REVIEW"; });
    await ceremonyStart(store, { type: "retro" });
    await ceremonyEnd(store, { type: "retro" });

    // -- Sprint 3: ベロシティ検証 --
    console.log("--- Sprint 3: ベロシティ検証 ---");
    // s2Tasks を再利用（持ち越し済みREADY）
    await sprintCreate(store, { goal: "Sprint 3 - 再起動", taskIds: s2Tasks });
    await store.update((s) => {
      s.currentSprint!.state = "ACTIVE";
      s.currentSprint!.startedAt = new Date().toISOString();
    });

    // 2/3 タスク完了
    for (const id of s2Tasks.slice(0, 2)) {
      await taskUpdate(store, { taskId: id, state: "IN_PROGRESS" });
      await taskUpdate(store, { taskId: id, state: "IN_REVIEW" });
      await taskUpdate(store, { taskId: id, state: "DONE" });
    }
    await sprintComplete(store, { sprintId: "sprint-3" });
    console.log("  Sprint 3: 2/3タスク完了 (6/9 pt)");

    // #10 ベロシティレポート
    const velocity = await velocityReport(store, {});
    expect(velocity.ok).toBe(true);
    const vData = velocity.data as VelocityData;
    // sprint-1 (10pt) + sprint-3 (6pt) = 2 sprints (中止は除外)
    expect(vData.sprints).toHaveLength(2);
    expect(vData.sprints[0].completedPoints).toBe(10);  // Sprint 1
    expect(vData.sprints[1].completedPoints).toBe(6);   // Sprint 3
    expect(vData.averageVelocity).toBe(8);               // (10+6)/2
    console.log(`  ベロシティ: avg=${vData.averageVelocity} pt/sprint`);
    console.log(`    Sprint 1: ${vData.sprints[0].completedPoints} pt`);
    console.log(`    Sprint 3: ${vData.sprints[1].completedPoints} pt`);

    // #10 lastN でスプリント数を制限
    const velocityLast1 = await velocityReport(store, { lastN: 1 });
    const vLast1 = velocityLast1.data as VelocityData;
    expect(vLast1.sprints).toHaveLength(1);
    expect(vLast1.sprints[0].id).toBe("sprint-3");
    console.log(`  lastN=1: Sprint 3 のみ取得OK`);

    // list_tasks で sprintId フィルタ（アーカイブ含む）
    const sprint1Tasks = await listTasks(store, { sprintId: "sprint-1" });
    expect(sprint1Tasks.ok).toBe(true);
    expect((sprint1Tasks.data as Task[]).length).toBe(2);
    console.log("  Sprint 1 のアーカイブ済タスク一覧取得OK\n");
  });

  it("Sprint 4: ブロッカー + WIPスコープ + 優先度変更", async () => {
    console.log("\n=== Sprint 4: ブロッカー＆WIP＆優先度 ===");

    // バックログにスプリント外タスクを作成
    const outsideTask = await taskCreate(store, {
      title: "スプリント外タスク",
      description: "バックログに残る",
      acceptanceCriteria: [],
      priority: "low",
    });
    const outsideId = (outsideTask.data as { taskId: string }).taskId;
    await taskUpdate(store, { taskId: outsideId, state: "READY" });
    await taskUpdate(store, { taskId: outsideId, state: "TODO" });
    await taskUpdate(store, { taskId: outsideId, state: "IN_PROGRESS" });

    // スプリントタスク
    const sprintTasks: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await taskCreate(store, {
        title: `S4-Task${i + 1}`, description: "d", acceptanceCriteria: [],
        priority: i === 0 ? "high" : "medium", points: 3,
      });
      const id = (r.data as { taskId: string }).taskId;
      await taskUpdate(store, { taskId: id, state: "READY" });
      sprintTasks.push(id);
    }

    await sprintCreate(store, { goal: "Sprint 4", taskIds: sprintTasks });
    await store.update((s) => {
      s.currentSprint!.state = "ACTIVE";
      s.currentSprint!.startedAt = new Date().toISOString();
    });

    // #6 WIP はスプリントスコープ（スプリント外の outsideId はカウントされない）
    await taskUpdate(store, { taskId: sprintTasks[0], state: "IN_PROGRESS", assignee: "dev-1" });
    const wipBefore = await wipStatus(store);
    const wipDataBefore = wipBefore.data as WipStatus;
    expect(wipDataBefore.inProgress).toBe(1);  // outsideId はカウントされない
    console.log(`  WIP スプリントスコープ: inProgress=${wipDataBefore.inProgress} (スプリント外除外OK)`);

    // #7 優先度のみ変更（状態は変わらない）
    const priorityChange = await taskUpdate(store, { taskId: sprintTasks[1], priority: "high" });
    expect(priorityChange.ok).toBe(true);
    expect(store.peek().tasks[sprintTasks[1]].priority).toBe("high");
    expect(store.peek().tasks[sprintTasks[1]].state).toBe("TODO");
    console.log("  優先度変更のみ（状態不変）OK");

    // ブロッカー発生
    await taskUpdate(store, { taskId: sprintTasks[0], state: "BLOCKED" });
    expect(store.peek().tasks[sprintTasks[0]].state).toBe("BLOCKED");

    // project_status でブロッカー検出
    const statusWithBlocker = await projectStatus(store);
    expect(statusWithBlocker.message).toContain("ブロッカー");
    const statusData = statusWithBlocker.data as { blockers: Array<{ id: string }> };
    expect(statusData.blockers).toHaveLength(1);
    expect(statusData.blockers[0].id).toBe(sprintTasks[0]);
    console.log(`  ブロッカー検出OK: ${statusData.blockers[0].id}`);

    // ブロッカー解除して完了まで
    await taskUpdate(store, { taskId: sprintTasks[0], state: "IN_PROGRESS" });
    await taskUpdate(store, { taskId: sprintTasks[0], state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: sprintTasks[0], state: "DONE" });

    // 残りも完了
    await taskUpdate(store, { taskId: sprintTasks[1], state: "IN_PROGRESS" });
    await taskUpdate(store, { taskId: sprintTasks[1], state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: sprintTasks[1], state: "DONE" });

    await taskUpdate(store, { taskId: sprintTasks[2], state: "IN_PROGRESS" });
    await taskUpdate(store, { taskId: sprintTasks[2], state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: sprintTasks[2], state: "DONE" });

    // スプリント完了
    const complete = await sprintComplete(store, { sprintId: "sprint-1" });
    expect(complete.ok).toBe(true);
    expect(complete.data!.completionRate).toBe(100);
    expect(complete.data!.completedPoints).toBe(9);
    console.log(`  Sprint 4 完了: ${complete.data!.completionRate}% (${complete.data!.completedPoints} pt)`);

    // 全タスクアーカイブ確認
    for (const id of sprintTasks) {
      expect(store.getState().archivedTasks[id]).toBeDefined();
      expect(store.getState().tasks[id]).toBeUndefined();
    }
    // スプリント外タスクはアーカイブされない
    expect(store.getState().tasks[outsideId]).toBeDefined();
    console.log("  全スプリントタスクアーカイブ、外部タスク残留OK\n");
  });

  it("エラーケース網羅", async () => {
    console.log("\n=== エラーケース網羅 ===");

    // #7 更新フィールドなし
    const t = await taskCreate(store, {
      title: "Error Test", description: "d", acceptanceCriteria: [], priority: "medium",
    });
    const tId = (t.data as { taskId: string }).taskId;
    const noField = await taskUpdate(store, { taskId: tId });
    expect(noField.ok).toBe(false);
    console.log("  更新フィールドなしエラーOK");

    // #1 存在しないタスクIDでスプリント作成
    await taskUpdate(store, { taskId: tId, state: "READY" });
    const badCreate = await sprintCreate(store, {
      goal: "Bad", taskIds: [tId, "task-nonexistent"],
    });
    expect(badCreate.ok).toBe(false);
    expect(badCreate.error).toContain("見つかりません");
    console.log("  存在しないタスクIDエラーOK");

    // #1 READY でないタスクでスプリント作成
    const t2 = await taskCreate(store, {
      title: "Not Ready", description: "d", acceptanceCriteria: [], priority: "low",
    });
    const t2Id = (t2.data as { taskId: string }).taskId;
    const notReady = await sprintCreate(store, { goal: "Bad", taskIds: [t2Id] });
    expect(notReady.ok).toBe(false);
    expect(notReady.error).toContain("READY 状態でない");
    console.log("  READY でないタスクエラーOK");

    // #9 完了済みスプリントは中止不可
    await sprintCreate(store, { goal: "Sprint 1", taskIds: [tId] });
    await store.update((s) => {
      s.currentSprint!.state = "COMPLETED";
      s.currentSprint!.completedAt = new Date().toISOString();
    });
    const cancelCompleted = await sprintCancel(store, { sprintId: "sprint-1", reason: "test" });
    expect(cancelCompleted.ok).toBe(false);
    console.log("  完了スプリント中止エラーOK");

    // #3 ACTIVE スプリントからは持ち越し不可
    await store.update((s) => { s.currentSprint!.state = "ACTIVE"; });
    const carryActive = await sprintCarryOver(store, { sprintId: "sprint-1" });
    expect(carryActive.ok).toBe(false);
    console.log("  ACTIVEスプリント持ち越しエラーOK");

    // #10 完了スプリントなしでベロシティエラー
    const store2 = await StateStore.init("/tmp/scrum-desktop-sprint-2.json");
    const velEmpty = await velocityReport(store2, {});
    expect(velEmpty.ok).toBe(false);
    expect(velEmpty.error).toContain("完了したスプリント");
    console.log("  ベロシティ（スプリントなし）エラーOK");
    try { await unlink("/tmp/scrum-desktop-sprint-2.json"); } catch { /* ignore */ }

    console.log("  全エラーケースOK\n");
  });
});
