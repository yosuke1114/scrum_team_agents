/**
 * ハイブリッドフィードバックシステム 机上フロー検証
 *
 * Phase自動遷移 (PLAN→EXECUTE→EVALUATE→LEARN) +
 * OODAループ (observe/orient/decide/log) +
 * メタ認知 (reflect/reflectEvaluate/knowledgeUpdate/knowledgeQuery) +
 * 品質ゲート (qualityCheck)
 *
 * の全サイクルを3スプリントにわたって検証する。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink } from "node:fs/promises";
import { StateStore } from "../state/store.js";
import { sprintCreate, sprintComplete, sprintCancel, sprintCarryOver } from "../tools/sprint.js";
import { taskCreate, taskUpdate } from "../tools/task.js";
import { listTasks, projectStatus } from "../tools/query.js";
import { metricsReport } from "../tools/metrics.js";
import { velocityReport } from "../tools/velocity.js";
import { setPhase, phaseStatus, phaseAdvance } from "../tools/phase.js";
import { oodaObserve, oodaOrient, oodaDecide, oodaLog } from "../tools/ooda.js";
import { reflect, reflectEvaluate, knowledgeUpdate, knowledgeQuery } from "../tools/reflection.js";
import { qualityCheck } from "../tools/quality-gate.js";
import type { Task, SprintMetrics, OodaObservation, Reflection, KnowledgeEntry } from "../types.js";

const STATE_FILE = "/tmp/scrum-hybrid-flow.json";
let store: StateStore;

const log = (msg: string) => console.log(msg);

beforeEach(async () => {
  store = await StateStore.init(STATE_FILE);
});

afterEach(async () => {
  try { await unlink(STATE_FILE); } catch { /* ignore */ }
});

// ─── ヘルパー ───
async function createReadyTask(title: string, desc: string, ac: string[], priority: "high" | "medium" | "low", points?: number): Promise<string> {
  const r = await taskCreate(store, { title, description: desc, acceptanceCriteria: ac, priority, points });
  expect(r.ok).toBe(true);
  const id = (r.data as { taskId: string }).taskId;
  await taskUpdate(store, { taskId: id, state: "READY" });
  return id;
}

async function completeTask(id: string, assignee: string) {
  await taskUpdate(store, { taskId: id, state: "IN_PROGRESS", assignee });
  await taskUpdate(store, { taskId: id, state: "IN_REVIEW" });
  await taskUpdate(store, { taskId: id, state: "DONE" });
}

// ═══════════════════════════════════════════════════════════════
// シナリオ A: フルフェーズサイクル (PLAN→EXECUTE→EVALUATE→LEARN)
// ═══════════════════════════════════════════════════════════════
describe("シナリオA: フルフェーズサイクル + OODA + 振り返り + 知識蓄積", () => {
  it("3スプリントでフィードバックループが回る", async () => {
    log("\n╔══════════════════════════════════════════════════════════╗");
    log("║  ハイブリッドフィードバック 机上フロー検証              ║");
    log("╚══════════════════════════════════════════════════════════╝\n");

    // ────────────────────────────────────────────────
    // Sprint 1: 正常フロー + OODA + 振り返り + 知識
    // ────────────────────────────────────────────────
    log("═══ Sprint 1: 正常フロー + OODA ═══\n");

    // --- PLAN フェーズ ---
    log("--- PLAN フェーズ ---");
    const ps0 = await phaseStatus(store);
    expect(ps0.data!.phase).toBe("PLAN");
    expect(ps0.data!.sprint).toBeNull();
    log(`  フェーズ: ${ps0.data!.phase} | OODA: ${ps0.data!.oodaCycleCount} | 振返り: ${ps0.data!.reflectionCount} | 知識: ${ps0.data!.knowledgeCount}`);

    // タスク作成
    const t1 = await createReadyTask("認証API", "JWT認証", ["トークン発行", "検証エンドポイント"], "high", 5);
    const t2 = await createReadyTask("プロフィールAPI", "ユーザー情報", ["取得", "更新"], "high", 3);
    const t3 = await createReadyTask("ログ基盤", "構造化ログ", ["JSON形式出力"], "medium", 2);
    log(`  タスク作成: 3件 (${5+3+2}pt)`);

    // 品質ゲートチェック（PLAN段階）
    const qc1 = await qualityCheck(store, { taskId: t1 });
    expect(qc1.data!.verdict).toBe("pass");
    log(`  品質チェック: ${qc1.data!.verdict} (${qc1.data!.checks.length} checks)`);

    // autoActivate でスプリント作成 → 自動的に EXECUTE フェーズへ
    const sprint1 = await sprintCreate(store, {
      goal: "認証基盤構築",
      taskIds: [t1, t2, t3],
      autoActivate: true,
    });
    expect(sprint1.ok).toBe(true);
    expect(store.peek().phase).toBe("EXECUTE");
    expect(store.peek().currentSprint!.state).toBe("ACTIVE");
    log(`  sprint_create autoActivate → EXECUTE フェーズ自動遷移 ✓`);

    // --- EXECUTE フェーズ ---
    log("\n--- EXECUTE フェーズ + OODA ループ ---");

    // OODA Observe: スプリント開始直後
    const obs1 = await oodaObserve(store);
    expect(obs1.ok).toBe(true);
    expect(obs1.data!.sprintProgress).toBe(0);
    expect(obs1.data!.blockers).toHaveLength(0);
    log(`  OODA Observe: 進捗 ${obs1.data!.sprintProgress}%, WIP: IP=${obs1.data!.wipStatus.inProgress} IR=${obs1.data!.wipStatus.inReview}`);

    // OODA Orient: アイドル状態を検知
    const orient1 = await oodaOrient(store);
    expect(orient1.ok).toBe(true);
    const idleSignal = orient1.data!.signals.find((s) => s.type === "idle_capacity");
    expect(idleSignal).toBeDefined();
    log(`  OODA Orient: ${orient1.data!.signals.length} シグナル → idle_capacity 検出 ✓`);

    // OODA Decide: タスク開始を推奨
    const decide1 = await oodaDecide(store);
    expect(decide1.data!.selected).toBe("start_next_task");
    log(`  OODA Decide: 推奨=${decide1.data!.selected}`);

    // タスク1着手
    await taskUpdate(store, { taskId: t1, state: "IN_PROGRESS", assignee: "dev-1" });

    // OODA Log: 遷移を記録
    const logResult = await oodaLog(store, {
      trigger: "task_transition",
      action: "start_task",
      outcome: "success",
      taskTransition: { taskId: t1, from: "TODO", to: "IN_PROGRESS" },
    });
    expect(logResult.ok).toBe(true);
    log(`  OODA Log: ${logResult.message}`);

    // タスク1完了
    await taskUpdate(store, { taskId: t1, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: t1, state: "DONE" });

    // タスク2着手→完了
    await taskUpdate(store, { taskId: t2, state: "IN_PROGRESS", assignee: "dev-1" });
    await taskUpdate(store, { taskId: t2, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: t2, state: "DONE" });

    // タスク3着手→完了
    await taskUpdate(store, { taskId: t3, state: "IN_PROGRESS", assignee: "dev-2" });
    await taskUpdate(store, { taskId: t3, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: t3, state: "DONE" });

    // OODA Orient: 全完了シグナル
    const orient2 = await oodaOrient(store);
    const completable = orient2.data!.signals.find((s) => s.type === "sprint_completable");
    expect(completable).toBeDefined();
    log(`  OODA Orient: sprint_completable 検出 ✓`);

    // OODA Decide: sprint_complete を推奨
    const decide2 = await oodaDecide(store);
    expect(decide2.data!.selected).toBe("sprint_complete");
    log(`  OODA Decide: 推奨=${decide2.data!.selected}`);

    // スプリント完了 → EVALUATE 自動遷移
    const complete1 = await sprintComplete(store, { sprintId: "sprint-1" });
    expect(complete1.ok).toBe(true);
    expect(store.peek().phase).toBe("EVALUATE");
    log(`  sprint_complete → EVALUATE 自動遷移 ✓`);
    log(`  メトリクス: ${(complete1.data as SprintMetrics).completedPoints}/${(complete1.data as SprintMetrics).totalPoints}pt (${(complete1.data as SprintMetrics).completionRate}%)`);

    // --- EVALUATE フェーズ ---
    log("\n--- EVALUATE フェーズ（振り返り） ---");

    const ps1 = await phaseStatus(store);
    expect(ps1.data!.phase).toBe("EVALUATE");
    log(`  フェーズ: ${ps1.data!.phase}`);

    // 構造化振り返り → LEARN 自動遷移
    const ref1 = await reflect(store, {
      trigger: "phase_end",
      what: "全タスク完了、ブロッカーなし",
      why: "タスク分割が適切で見積もり精度が高かった",
      action: "小さなタスク分割を継続する",
    });
    expect(ref1.ok).toBe(true);
    expect(store.peek().phase).toBe("LEARN");
    log(`  reflect → LEARN 自動遷移 ✓ (${ref1.data!.id})`);

    // --- LEARN フェーズ ---
    log("\n--- LEARN フェーズ（知識蓄積） ---");

    // 知識登録 → PLAN 自動遷移
    const know1 = await knowledgeUpdate(store, {
      category: "pattern",
      insight: "5pt以下の小さなタスクに分割すると完了率が上がる",
    });
    expect(know1.ok).toBe(true);
    expect(know1.data!.confidence).toBe(0.5);
    expect(store.peek().phase).toBe("PLAN");
    log(`  knowledge_update → PLAN 自動遷移 ✓ (confidence=${know1.data!.confidence})`);

    const know2 = await knowledgeUpdate(store, {
      category: "technique",
      insight: "autoActivateでセレモニーオーバーヘッドを削減",
    });
    expect(know2.ok).toBe(true);
    log(`  knowledge_update: ${know2.data!.id} [technique]`);

    // Sprint 1 完了サマリ
    const psEnd1 = await phaseStatus(store);
    log(`\n  Sprint 1 完了: OODA=${psEnd1.data!.oodaCycleCount}回 振返り=${psEnd1.data!.reflectionCount}件 知識=${psEnd1.data!.knowledgeCount}件`);

    // ────────────────────────────────────────────────
    // Sprint 2: ブロッカー発生 + OODA駆動判断 + 知識活用
    // ────────────────────────────────────────────────
    log("\n═══ Sprint 2: ブロッカー + OODA駆動判断 ═══\n");

    // --- PLAN フェーズ ---
    log("--- PLAN フェーズ ---");

    // 前スプリントの知識を活用
    const prevKnowledge = await knowledgeQuery(store, { category: "pattern" });
    expect(prevKnowledge.data!.length).toBeGreaterThan(0);
    log(`  知識ベース参照: ${prevKnowledge.data!.length}件のパターン発見`);
    log(`  → "${prevKnowledge.data![0].insight}" (信頼度:${prevKnowledge.data![0].confidence})`);

    // 前回の振り返りを評価
    const ref1Id = ref1.data!.id;
    const evalRef = await reflectEvaluate(store, { reflectionId: ref1Id, effectiveness: "effective" });
    expect(evalRef.ok).toBe(true);
    log(`  前回振り返り評価: ${ref1Id} → effective ✓`);

    // タスク作成（知識に従い小さく分割）
    const t4 = await createReadyTask("OAuth2基盤", "Provider抽象化", ["Google", "GitHub"], "high", 5);
    const t5 = await createReadyTask("Google OAuth", "Google連携", ["リダイレクト", "コールバック"], "high", 3);
    const t6 = await createReadyTask("GitHub OAuth", "GitHub連携", ["リダイレクト", "コールバック"], "medium", 3);
    log(`  タスク作成: 3件 (${5+3+3}pt) ← 小タスク分割パターン適用`);

    // スプリント作成 + autoActivate
    await sprintCreate(store, {
      goal: "OAuth2連携",
      taskIds: [t4, t5, t6],
      autoActivate: true,
    });
    expect(store.peek().phase).toBe("EXECUTE");
    log(`  sprint_create autoActivate → EXECUTE ✓`);

    // --- EXECUTE フェーズ ---
    log("\n--- EXECUTE フェーズ + OODA ---");

    // タスク4着手
    await taskUpdate(store, { taskId: t4, state: "IN_PROGRESS", assignee: "dev-1" });
    await oodaLog(store, { trigger: "task_transition", action: "start_task", outcome: "success" });

    // タスク5着手
    await taskUpdate(store, { taskId: t5, state: "IN_PROGRESS", assignee: "dev-2" });

    // ★ 両方ブロック！
    await taskUpdate(store, { taskId: t4, state: "BLOCKED" });
    await taskUpdate(store, { taskId: t5, state: "BLOCKED" });
    log(`  ⚠ t4, t5 → BLOCKED (外部API制約)`);

    // OODA Observe: ブロッカー検知
    const obs2 = await oodaObserve(store);
    expect(obs2.data!.blockers).toHaveLength(2);
    log(`  OODA Observe: ブロッカー ${obs2.data!.blockers.length}件`);

    // OODA Orient: 重大ブロッカーシグナル
    const orient3 = await oodaOrient(store);
    const blockerSignal = orient3.data!.signals.find((s) => s.type === "blocker_accumulation");
    expect(blockerSignal).toBeDefined();
    expect(blockerSignal!.severity).toBe("critical");
    log(`  OODA Orient: blocker_accumulation [${blockerSignal!.severity}]`);

    // OODA Decide: ブロッカー解消 or キャンセル推奨
    const decide3 = await oodaDecide(store);
    const hasResolve = decide3.data!.recommendations.some((r) => r.action === "resolve_blockers");
    const hasCancel = decide3.data!.recommendations.some((r) => r.action === "consider_sprint_cancel");
    expect(hasResolve).toBe(true);
    expect(hasCancel).toBe(true);
    log(`  OODA Decide: resolve_blockers + consider_sprint_cancel 推奨`);
    log(`  → OODA判断に従いスプリント中止を選択`);

    // スプリント中止 → EVALUATE 自動遷移
    const cancel = await sprintCancel(store, { sprintId: "sprint-2", reason: "外部API制約によりブロッカー解消不可" });
    expect(cancel.ok).toBe(true);
    expect(store.peek().phase).toBe("EVALUATE");
    expect(store.peek().ceremonyState).toBe("IDLE"); // cancel は IDLE 維持
    log(`  sprint_cancel → EVALUATE 自動遷移 ✓ (ceremonyState=IDLE)`);

    // OODA Log: キャンセル記録
    await oodaLog(store, { trigger: "blocker", action: "sprint_cancel", outcome: "partial" });

    // --- EVALUATE: 振り返り ---
    log("\n--- EVALUATE フェーズ ---");

    const ref2 = await reflect(store, {
      trigger: "blocker",
      what: "OAuth2 の外部API制約で2/3タスクがブロック",
      why: "外部依存のリスク評価が不十分だった",
      action: "外部依存タスクは事前にAPI疎通確認を必須にする",
    });
    expect(store.peek().phase).toBe("LEARN");
    log(`  reflect → LEARN ✓`);

    // --- LEARN: 知識蓄積 ---
    log("\n--- LEARN フェーズ ---");

    // 失敗パターンを記録
    await knowledgeUpdate(store, {
      category: "antipattern",
      insight: "外部API連携タスクはAPI疎通確認なしにスプリントに入れてはいけない",
    });
    // 成功パターンを強化（同じ insight → confidence 上昇）
    const reinforced = await knowledgeUpdate(store, {
      category: "pattern",
      insight: "5pt以下の小さなタスクに分割すると完了率が上がる",
    });
    expect(reinforced.data!.confidence).toBeCloseTo(0.6); // 0.5 + 0.1
    log(`  知識強化: パターン confidence 0.5→${reinforced.data!.confidence}`);
    expect(store.peek().phase).toBe("PLAN");
    log(`  knowledge_update → PLAN 自動遷移 ✓`);

    // 持ち越し
    await sprintCarryOver(store, { sprintId: "sprint-2" });
    log(`  持ち越し: 3タスクを READY に復帰`);

    const psEnd2 = await phaseStatus(store);
    log(`\n  Sprint 2 完了: OODA=${psEnd2.data!.oodaCycleCount}回 振返り=${psEnd2.data!.reflectionCount}件 知識=${psEnd2.data!.knowledgeCount}件`);

    // ────────────────────────────────────────────────
    // Sprint 3: 知識活用で改善 + phaseAdvance 検証
    // ────────────────────────────────────────────────
    log("\n═══ Sprint 3: 知識活用で改善サイクル ═══\n");

    // --- PLAN フェーズ ---
    log("--- PLAN フェーズ ---");

    // 知識ベース全件参照
    const allKnowledge = await knowledgeQuery(store, {});
    log(`  知識ベース: ${allKnowledge.data!.length}件`);
    for (const k of allKnowledge.data!) {
      log(`    [${k.category}] (${k.confidence.toFixed(1)}) ${k.insight}`);
    }

    // antipattern に従い、事前確認済みタスクのみスプリントに入れる
    // t4, t5, t6 は持ち越し済み（READY）
    // t4 (OAuth基盤) は外部依存なし → OK
    // t5, t6 (Google/GitHub OAuth) は外部依存あり → 今回は t4 のみ

    // 品質チェック
    const qc4 = await qualityCheck(store, { taskId: t4 });
    expect(qc4.data!.verdict).toBe("pass");
    log(`  品質チェック t4: ${qc4.data!.verdict}`);

    // スプリント作成（スコープを絞る）
    await sprintCreate(store, {
      goal: "OAuth2基盤のみ（外部API待ち）",
      taskIds: [t4],
      autoActivate: true,
    });
    expect(store.peek().phase).toBe("EXECUTE");
    log(`  Sprint 3: 1タスクのみ (antipattern 知識適用)`);

    // --- EXECUTE ---
    log("\n--- EXECUTE フェーズ ---");

    // ブロック解除済み想定 → 通常完了
    await taskUpdate(store, { taskId: t4, state: "IN_PROGRESS", assignee: "dev-1" });
    await oodaLog(store, { trigger: "task_transition", action: "start_task", outcome: "success" });

    // 品質チェック（IN_PROGRESS状態で担当者確認）
    const qcInProgress = await qualityCheck(store, { taskId: t4 });
    const assigneeCheck = qcInProgress.data!.checks.find((c) => c.name === "assignee");
    expect(assigneeCheck!.passed).toBe(true);
    log(`  品質チェック (IN_PROGRESS): assignee=dev-1 ✓`);

    await taskUpdate(store, { taskId: t4, state: "IN_REVIEW" });
    await taskUpdate(store, { taskId: t4, state: "DONE" });

    // OODA で完了確認
    const orient4 = await oodaOrient(store);
    expect(orient4.data!.signals.some((s) => s.type === "sprint_completable")).toBe(true);
    log(`  OODA Orient: sprint_completable ✓`);

    // スプリント完了
    const complete3 = await sprintComplete(store, { sprintId: "sprint-3" });
    expect(complete3.ok).toBe(true);
    expect(store.peek().phase).toBe("EVALUATE");
    log(`  sprint_complete → EVALUATE ✓ (${(complete3.data as SprintMetrics).completionRate}%)`);

    // --- EVALUATE ---
    log("\n--- EVALUATE フェーズ ---");

    const ref3 = await reflect(store, {
      trigger: "phase_end",
      what: "スコープを1タスクに絞り100%完了",
      why: "前回の antipattern 知識を適用し外部依存を除外した",
      action: "外部依存解消後に Google/GitHub OAuth を次スプリントに投入",
    });
    expect(store.peek().phase).toBe("LEARN");
    log(`  reflect → LEARN ✓`);

    // 前回の振り返りを評価
    const evalRef2 = await reflectEvaluate(store, { reflectionId: ref2.data!.id, effectiveness: "effective" });
    expect(evalRef2.ok).toBe(true);
    log(`  前回振り返り(blocker) → effective ✓`);

    // --- LEARN ---
    log("\n--- LEARN フェーズ ---");

    // パターン再強化
    const reinforced2 = await knowledgeUpdate(store, {
      category: "pattern",
      insight: "5pt以下の小さなタスクに分割すると完了率が上がる",
    });
    expect(reinforced2.data!.confidence).toBeCloseTo(0.7); // 0.6 + 0.1
    log(`  知識強化: パターン confidence → ${reinforced2.data!.confidence.toFixed(1)}`);

    await knowledgeUpdate(store, {
      category: "pattern",
      insight: "antipattern適用でスコープを絞ると完了率が改善する",
    });
    expect(store.peek().phase).toBe("PLAN");
    log(`  knowledge_update → PLAN ✓`);

    // ────────────────────────────────────────────────
    // 最終検証
    // ────────────────────────────────────────────────
    log("\n═══ 最終検証 ═══\n");

    // フェーズ状態
    const psFinal = await phaseStatus(store);
    expect(psFinal.data!.phase).toBe("PLAN");
    log(`  フェーズ: ${psFinal.data!.phase} ✓`);

    // OODA サイクル数
    expect(psFinal.data!.oodaCycleCount).toBeGreaterThanOrEqual(3);
    log(`  OODA サイクル: ${psFinal.data!.oodaCycleCount}回`);

    // 振り返り数
    expect(psFinal.data!.reflectionCount).toBe(3);
    log(`  振り返り: ${psFinal.data!.reflectionCount}件`);

    // 知識ベース
    expect(psFinal.data!.knowledgeCount).toBeGreaterThanOrEqual(4);
    log(`  知識ベース: ${psFinal.data!.knowledgeCount}件`);

    // 信頼度が最も高い知識
    const topKnowledge = await knowledgeQuery(store, {});
    log(`  最高信頼度: [${topKnowledge.data![0].category}] ${topKnowledge.data![0].confidence.toFixed(1)} - "${topKnowledge.data![0].insight}"`);

    // ベロシティ
    const vel = await velocityReport(store, {});
    expect(vel.ok).toBe(true);
    const vData = vel.data!;
    log(`  ベロシティ: Sprint1=${(vData as any).sprints[0].completedPoints}pt Sprint3=${(vData as any).sprints[1].completedPoints}pt (Sprint2は中止)`);
    log(`  平均: ${(vData as any).averageVelocity}pt/sprint`);

    // スプリント履歴
    const s = store.peek();
    const completed = s.sprints.filter((sp) => sp.state === "COMPLETED");
    const cancelled = s.sprints.filter((sp) => sp.state === "CANCELLED");
    log(`  スプリント: ${completed.length}完了, ${cancelled.length}中止`);

    // アーカイブ済タスク
    const archivedCount = Object.keys(s.archivedTasks).length;
    const activeCount = Object.keys(s.tasks).length;
    log(`  アーカイブ: ${archivedCount}件, アクティブ: ${activeCount}件`);

    // 振り返りの有効性評価
    const effectiveRefs = s.reflections.filter((r) => r.effectiveness === "effective");
    log(`  振り返り有効性: ${effectiveRefs.length}/${s.reflections.length} effective`);

    // 知識のカテゴリ分布
    const categories = s.knowledge.reduce((acc, k) => {
      acc[k.category] = (acc[k.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    log(`  知識カテゴリ: ${Object.entries(categories).map(([k, v]) => `${k}=${v}`).join(", ")}`);

    log("\n╔══════════════════════════════════════════════════════════╗");
    log("║  ハイブリッドフィードバック 机上フロー検証 完了          ║");
    log("╚══════════════════════════════════════════════════════════╝\n");
  });
});

// ═══════════════════════════════════════════════════════════════
// シナリオ B: phaseAdvance 手動遷移 + ガードレール
// ═══════════════════════════════════════════════════════════════
describe("シナリオB: phaseAdvance ガードレール検証", () => {
  it("手動フェーズ遷移のガードが正しく機能する", async () => {
    log("\n═══ phaseAdvance ガードレール ═══\n");

    // PLAN → EXECUTE: スプリントなしで拒否
    const r1 = await phaseAdvance(store, {});
    expect(r1.ok).toBe(false);
    log(`  PLAN→EXECUTE (スプリントなし): 拒否 ✓`);

    // タスク作成 + スプリント作成（autoActivate なし）
    const t = await createReadyTask("テスト", "d", ["ac"], "high", 3);
    await sprintCreate(store, { goal: "Test", taskIds: [t] });
    expect(store.peek().phase).toBe("PLAN"); // autoActivate なし

    // PLAN → EXECUTE: スプリントあり → 成功 + 自動ACTIVE化
    const r2 = await phaseAdvance(store, {});
    expect(r2.ok).toBe(true);
    expect(store.peek().phase).toBe("EXECUTE");
    expect(store.peek().currentSprint!.state).toBe("ACTIVE");
    log(`  PLAN→EXECUTE (スプリントあり): 成功 + ACTIVE化 ✓`);

    // EXECUTE → EVALUATE: ACTIVE スプリントありで拒否
    const r3 = await phaseAdvance(store, {});
    expect(r3.ok).toBe(false);
    log(`  EXECUTE→EVALUATE (ACTIVE): 拒否 ✓`);

    // EXECUTE → EVALUATE: force=true で強制遷移
    const r4 = await phaseAdvance(store, { force: true });
    expect(r4.ok).toBe(true);
    expect(store.peek().phase).toBe("EVALUATE");
    log(`  EXECUTE→EVALUATE (force): 成功 ✓`);

    // EVALUATE → LEARN
    const r5 = await phaseAdvance(store, {});
    expect(r5.ok).toBe(true);
    expect(store.peek().phase).toBe("LEARN");
    log(`  EVALUATE→LEARN: 成功 ✓`);

    // LEARN → PLAN
    const r6 = await phaseAdvance(store, {});
    expect(r6.ok).toBe(true);
    expect(store.peek().phase).toBe("PLAN");
    log(`  LEARN→PLAN: 成功 ✓`);

    log(`\n  フルサイクル手動遷移完了 ✓\n`);
  });
});

// ═══════════════════════════════════════════════════════════════
// シナリオ C: 知識の信頼度上昇と上限テスト
// ═══════════════════════════════════════════════════════════════
describe("シナリオC: 知識ベースの信頼度・上限テスト", () => {
  it("繰り返し強化で信頼度が1.0に収束する", async () => {
    log("\n═══ 知識信頼度テスト ═══\n");

    const insight = "テスト駆動開発がバグを減らす";
    let conf = 0;

    // 初回: 0.5
    const k1 = await knowledgeUpdate(store, { category: "technique", insight });
    conf = k1.data!.confidence;
    expect(conf).toBe(0.5);
    log(`  初回: confidence=${conf}`);

    // 6回強化: 0.5 → 0.6 → 0.7 → 0.8 → 0.9 → 1.0 → 1.0 (cap)
    for (let i = 0; i < 6; i++) {
      const kr = await knowledgeUpdate(store, { category: "technique", insight });
      conf = kr.data!.confidence;
    }
    expect(conf).toBe(1.0);
    log(`  6回強化後: confidence=${conf} (1.0 cap) ✓`);

    // 重複なし（1エントリのみ）
    expect(store.peek().knowledge).toHaveLength(1);
    log(`  エントリ数: ${store.peek().knowledge.length} (重複なし) ✓\n`);
  });
});
