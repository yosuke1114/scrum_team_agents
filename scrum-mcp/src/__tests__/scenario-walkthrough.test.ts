/**
 * シナリオベース机上ウォークスルー
 *
 * 4エージェント（SM, PO, Dev, Reviewer）がペルソナ切り替えしながら
 * 2スプリントを回す。エラーリカバリ・監査ログ・レポート生成を含む
 * 実運用に近いシナリオで検証する。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlink, readFile } from "node:fs/promises";
import { StateStore } from "../state/store.js";
import { AuditLog, type AuditEntry } from "../state/audit.js";
import { ceremonyStart, ceremonyEnd } from "../tools/ceremony.js";
import { sprintCreate, sprintAddTasks, sprintComplete, sprintCarryOver, sprintCancel } from "../tools/sprint.js";
import { taskCreate, taskUpdate } from "../tools/task.js";
import { metricsReport } from "../tools/metrics.js";
import { wipStatus } from "../tools/wip.js";
import { velocityReport } from "../tools/velocity.js";
import { listTasks, getTask, projectStatus } from "../tools/query.js";
import { ceremonyReport } from "../tools/report.js";
import type { Task, WipStatus, SprintMetrics, VelocityData } from "../types.js";

const STATE_FILE = "/tmp/scrum-scenario-state.json";
const AUDIT_FILE = "/tmp/scrum-scenario/audit.jsonl";

let store: StateStore;
let audit: AuditLog;
let currentPersona: string | null = null;

/** ペルソナ切替（index.ts の set_context 相当） */
function setPersona(persona: string) {
  currentPersona = persona;
}

/** 監査ログ付きツール呼び出し（index.ts の withAudit 相当） */
async function withAudit<T extends { ok: boolean; error?: string }>(
  toolName: string,
  input: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const result = await fn();
  await audit.log({
    ts: new Date().toISOString(),
    tool: toolName,
    input,
    ok: result.ok,
    error: result.error,
    persona: currentPersona ?? undefined,
  });
  return result;
}

beforeEach(async () => {
  store = await StateStore.init(STATE_FILE);
  audit = new AuditLog(STATE_FILE);
  currentPersona = null;
});

afterEach(async () => {
  try { await unlink(STATE_FILE); } catch { /* ignore */ }
  try { await unlink(audit.getFilePath()); } catch { /* ignore */ }
});

// ─── ヘルパー ───
async function createTask(title: string, desc: string, ac: string[], priority: "high" | "medium" | "low", points?: number) {
  return withAudit("task_create", { title, priority, points }, () =>
    taskCreate(store, { title, description: desc, acceptanceCriteria: ac, priority, points })
  );
}

async function updateTask(taskId: string, opts: { state?: string; priority?: string; points?: number; assignee?: string | null }) {
  return withAudit("task_update", { taskId, ...opts }, () =>
    taskUpdate(store, { taskId, ...opts } as any)
  );
}

function taskId(result: { data?: unknown }): string {
  return (result.data as { taskId: string }).taskId;
}

// ─── シナリオ 1: フルスプリントサイクル（正常系） ───
describe("シナリオ1: ECサイト認証基盤スプリント", () => {
  it("SM→PO→Dev→Reviewer の4エージェント協調フロー", async () => {
    console.log("\n╔══════════════════════════════════════════════╗");
    console.log("║  シナリオ1: ECサイト認証基盤スプリント       ║");
    console.log("╚══════════════════════════════════════════════╝\n");

    // ──── Phase 1: SM がリファインメント開始 ────
    setPersona("scrum-master");
    console.log("[SM] リファインメント開始");

    const startRef = await withAudit("ceremony_start", { type: "refinement" }, () =>
      ceremonyStart(store, { type: "refinement" })
    );
    expect(startRef.ok).toBe(true);

    // 初期ステータス確認
    const initStatus = await withAudit("project_status", {}, () => projectStatus(store));
    expect(initStatus.ok).toBe(true);
    expect(initStatus.message).toContain("REFINEMENT");
    console.log("[SM] ステータス確認OK → REFINEMENT 状態\n");

    // ──── Phase 2: PO がバックログ作成 ────
    setPersona("product-owner");
    console.log("[PO] バックログ作成開始");

    const auth = await createTask(
      "JWT認証エンドポイント",
      "POST /api/auth/login と POST /api/auth/register を実装",
      ["正しい認証情報でJWTトークンを返す", "不正な認証情報で401を返す", "トークン期限は24時間"],
      "high", 8
    );
    expect(auth.ok).toBe(true);
    const authId = taskId(auth);
    console.log(`[PO] ✓ ${authId.slice(0, 12)}... JWT認証エンドポイント (8pt)`);

    const profile = await createTask(
      "ユーザープロフィールAPI",
      "GET/PUT /api/users/me を実装",
      ["認証済みユーザーのプロフィール取得", "プロフィール更新"],
      "high", 5
    );
    const profileId = taskId(profile);
    console.log(`[PO] ✓ ${profileId.slice(0, 12)}... プロフィールAPI (5pt)`);

    const password = await createTask(
      "パスワードリセット",
      "パスワードリセットメール送信 + トークン検証",
      ["リセットメール送信", "トークンで新パスワード設定"],
      "medium", 3
    );
    const passwordId = taskId(password);
    console.log(`[PO] ✓ ${passwordId.slice(0, 12)}... パスワードリセット (3pt)`);

    const oauth = await createTask(
      "OAuth2連携",
      "Google/GitHub OAuth2 フロー実装",
      ["Google ログイン", "GitHub ログイン", "既存アカウントとのリンク"],
      "low", 13
    );
    const oauthId = taskId(oauth);
    console.log(`[PO] ✓ ${oauthId.slice(0, 12)}... OAuth2連携 (13pt)`);

    // PO がREADYに昇格
    for (const id of [authId, profileId, passwordId, oauthId]) {
      await updateTask(id, { state: "READY" });
    }
    console.log("[PO] 全4タスクを READY に昇格");

    // PO がポイント再見積もり (#7)
    const reestimate = await updateTask(oauthId, { points: 8 });
    expect(reestimate.ok).toBe(true);
    expect(store.peek().tasks[oauthId].points).toBe(8);
    expect(store.peek().tasks[oauthId].state).toBe("READY");  // 状態不変
    console.log("[PO] OAuth2 を 13pt → 8pt に再見積もり（状態変更なし）");

    // list_tasks でバックログ確認
    const readyTasks = await withAudit("list_tasks", { state: "READY" }, () =>
      listTasks(store, { state: "READY" })
    );
    expect((readyTasks.data as Task[]).length).toBe(4);
    console.log(`[PO] READY タスク: ${(readyTasks.data as Task[]).length}件\n`);

    // SM がリファインメント終了
    setPersona("scrum-master");
    await withAudit("ceremony_end", { type: "refinement" }, () =>
      ceremonyEnd(store, { type: "refinement" })
    );
    console.log("[SM] リファインメント終了\n");

    // ──── Phase 3: SM がプランニング開始 ────
    console.log("[SM] プランニング開始");
    await withAudit("ceremony_start", { type: "planning" }, () =>
      ceremonyStart(store, { type: "planning" })
    );

    // PO がスプリントスコープ決定 (#1)
    setPersona("product-owner");
    const sprint = await withAudit("sprint_create", { goal: "認証基盤MVP", taskCount: 3 }, () =>
      sprintCreate(store, { goal: "認証基盤MVP", taskIds: [authId, profileId, passwordId] })
    );
    expect(sprint.ok).toBe(true);
    expect(store.peek().currentSprint!.tasks).toHaveLength(3);
    console.log("[PO] スプリント作成: 認証基盤MVP (3タスク, 16pt)");

    // 途中でタスク追加検討 → ACTIVE でなければ追加可能 (#1)
    const addOauth = await withAudit("sprint_add_tasks", { sprintId: "sprint-1", taskIds: [oauthId] }, () =>
      sprintAddTasks(store, { sprintId: "sprint-1", taskIds: [oauthId] })
    );
    expect(addOauth.ok).toBe(true);
    expect(store.peek().currentSprint!.tasks).toHaveLength(4);
    console.log("[PO] OAuth2 もスプリントに追加 → 4タスク, 24pt");

    // SM がプランニング終了
    setPersona("scrum-master");
    await withAudit("ceremony_end", { type: "planning" }, () =>
      ceremonyEnd(store, { type: "planning" })
    );
    console.log("[SM] プランニング終了\n");

    // ──── Phase 4: SM がスプリント開始 ────
    console.log("[SM] スプリント開始");
    const sprintStart = await withAudit("ceremony_start", { type: "sprint" }, () =>
      ceremonyStart(store, { type: "sprint" })
    );
    expect(sprintStart.ok).toBe(true);
    expect(store.peek().currentSprint!.state).toBe("ACTIVE");
    expect(store.peek().currentSprint!.startedAt).not.toBeNull();
    console.log("[SM] スプリント ACTIVE 化完了\n");

    // ──── Phase 5: Dev がタスク実行 ────
    setPersona("developer");
    console.log("[Dev] タスク着手開始");

    // Dev-1: JWT認証
    await updateTask(authId, { state: "IN_PROGRESS", assignee: "dev-1" });
    console.log("[Dev-1] JWT認証 着手");

    // Dev-2: プロフィールAPI
    await updateTask(profileId, { state: "IN_PROGRESS", assignee: "dev-2" });
    console.log("[Dev-2] プロフィールAPI 着手");

    // WIP チェック (#6 スプリントスコープ)
    const wipCheck = await withAudit("wip_status", {}, () => wipStatus(store));
    const wipData = wipCheck.data as WipStatus;
    expect(wipData.inProgress).toBe(2);
    expect(wipData.warning).toContain("制限到達");
    console.log(`[SM] WIP確認: IN_PROGRESS=${wipData.inProgress} ⚡制限到達\n`);

    // Dev-1: JWT認証完了 → レビューへ
    await updateTask(authId, { state: "IN_REVIEW" });
    console.log("[Dev-1] JWT認証 → IN_REVIEW");

    // ──── Phase 6: Reviewer がコードレビュー ────
    setPersona("reviewer");
    console.log("[Reviewer] JWT認証コードレビュー開始");

    // レビューOK → DONE
    await updateTask(authId, { state: "DONE" });
    console.log("[Reviewer] JWT認証 → DONE ✓\n");

    // ──── Phase 7: Dev が次のタスクへ ────
    setPersona("developer");

    // Dev-1: パスワードリセット着手
    await updateTask(passwordId, { state: "IN_PROGRESS", assignee: "dev-1" });
    console.log("[Dev-1] パスワードリセット 着手");

    // Dev-2: プロフィール完了 → レビュー
    await updateTask(profileId, { state: "IN_REVIEW" });
    console.log("[Dev-2] プロフィールAPI → IN_REVIEW");

    setPersona("reviewer");
    await updateTask(profileId, { state: "DONE" });
    console.log("[Reviewer] プロフィールAPI → DONE ✓");

    setPersona("developer");
    // Dev-2: OAuth2 着手
    await updateTask(oauthId, { state: "IN_PROGRESS", assignee: "dev-2" });
    console.log("[Dev-2] OAuth2連携 着手");

    // ★ ブロッカー発生！ Google API の認証情報が取得できない
    await updateTask(oauthId, { state: "BLOCKED" });
    console.log("[Dev-2] ⚠ OAuth2連携 → BLOCKED (Google API 認証情報なし)");

    // SM がブロッカーを検知
    setPersona("scrum-master");
    const statusWithBlocker = await withAudit("project_status", {}, () => projectStatus(store));
    const blockerData = statusWithBlocker.data as { blockers: Array<{ id: string; title: string }> };
    expect(blockerData.blockers).toHaveLength(1);
    expect(blockerData.blockers[0].id).toBe(oauthId);
    console.log(`[SM] ブロッカー検知: ${blockerData.blockers[0].title}`);

    // ブロッカー解消
    setPersona("developer");
    await updateTask(oauthId, { state: "IN_PROGRESS" });
    console.log("[Dev-2] OAuth2連携 ブロック解除 → IN_PROGRESS 復帰");

    // 残りを完了へ
    await updateTask(passwordId, { state: "IN_REVIEW" });
    setPersona("reviewer");
    await updateTask(passwordId, { state: "DONE" });
    console.log("[Reviewer] パスワードリセット → DONE ✓");

    setPersona("developer");
    await updateTask(oauthId, { state: "IN_REVIEW" });
    setPersona("reviewer");
    await updateTask(oauthId, { state: "DONE" });
    console.log("[Reviewer] OAuth2連携 → DONE ✓\n");

    // ──── Phase 8: SM がレビュー開始（sprint→review 暗黙遷移） ────
    setPersona("scrum-master");
    console.log("[SM] スプリントレビュー開始");
    await withAudit("ceremony_start", { type: "review" }, () =>
      ceremonyStart(store, { type: "review" })
    );
    expect(store.peek().ceremonyState).toBe("SPRINT_REVIEW");

    // メトリクス確認 (#4)
    const metrics = await withAudit("metrics_report", {}, () => metricsReport(store, {}));
    const mData = metrics.data as SprintMetrics;
    expect(mData.completionRate).toBe(100);
    expect(mData.totalPoints).toBe(24);     // 8+5+3+8
    expect(mData.completedPoints).toBe(24);
    console.log(`[SM] メトリクス: ${mData.completedTasks}/${mData.totalTasks} tasks, ${mData.completedPoints}/${mData.totalPoints} pt (${mData.completionRate}%)`);

    // スプリント完了 → 自動アーカイブ (#5)
    const complete = await withAudit("sprint_complete", { sprintId: "sprint-1" }, () =>
      sprintComplete(store, { sprintId: "sprint-1" })
    );
    expect(complete.ok).toBe(true);
    expect(complete.data!.completedPoints).toBe(24);

    // 全タスクがアーカイブされた
    const s = store.getState();
    for (const id of [authId, profileId, passwordId, oauthId]) {
      expect(s.archivedTasks[id]).toBeDefined();
      expect(s.tasks[id]).toBeUndefined();
    }
    console.log("[SM] 全4タスク自動アーカイブ完了");

    // アーカイブ済タスクの参照 (#5)
    const archived = await withAudit("get_task", { taskId: authId }, () =>
      getTask(store, { taskId: authId })
    );
    expect(archived.ok).toBe(true);
    expect(archived.message).toContain("アーカイブ済");
    console.log(`[SM] アーカイブ済タスク参照OK: ${(archived.data as Task).title}`);

    // sprintId フィルタで一覧取得（アーカイブ含む）
    const s1Tasks = await listTasks(store, { sprintId: "sprint-1" });
    expect((s1Tasks.data as Task[]).length).toBe(4);
    console.log(`[SM] Sprint-1 タスク一覧: ${(s1Tasks.data as Task[]).length}件（アーカイブ含む）`);

    // レポート保存
    await withAudit("ceremony_report", { type: "review" }, () =>
      ceremonyReport(store, {
        type: "review",
        content: "## レビュー結果\n- 全4タスク完了\n- ブロッカー1件を解消\n- 完了率100%",
      })
    );
    console.log("[SM] レビューレポート保存");

    await withAudit("ceremony_end", { type: "review" }, () =>
      ceremonyEnd(store, { type: "review" })
    );

    // ──── Phase 9: レトロスペクティブ ────
    console.log("\n[SM] レトロスペクティブ開始");
    await withAudit("ceremony_start", { type: "retro" }, () =>
      ceremonyStart(store, { type: "retro" })
    );

    await withAudit("ceremony_report", { type: "retro" }, () =>
      ceremonyReport(store, {
        type: "retro",
        content: "## 振り返り\n### Good\n- 全タスク完了\n### Problem\n- OAuth2でブロッカー発生\n### Try\n- 外部API認証情報を事前確認",
      })
    );

    await withAudit("ceremony_end", { type: "retro" }, () =>
      ceremonyEnd(store, { type: "retro" })
    );
    expect(store.peek().ceremonyState).toBe("IDLE");
    console.log("[SM] レトロスペクティブ終了 → IDLE\n");

    // ──── 監査ログ検証 (#8) ────
    const auditRaw = await readFile(audit.getFilePath(), "utf-8");
    const auditEntries: AuditEntry[] = auditRaw.trim().split("\n").map((l) => JSON.parse(l));

    // ペルソナが記録されている
    const smEntries = auditEntries.filter((e) => e.persona === "scrum-master");
    const poEntries = auditEntries.filter((e) => e.persona === "product-owner");
    const devEntries = auditEntries.filter((e) => e.persona === "developer");
    const reviewerEntries = auditEntries.filter((e) => e.persona === "reviewer");

    expect(smEntries.length).toBeGreaterThan(0);
    expect(poEntries.length).toBeGreaterThan(0);
    expect(devEntries.length).toBeGreaterThan(0);
    expect(reviewerEntries.length).toBeGreaterThan(0);

    console.log("=== 監査ログ集計 ===");
    console.log(`  SM: ${smEntries.length} entries`);
    console.log(`  PO: ${poEntries.length} entries`);
    console.log(`  Dev: ${devEntries.length} entries`);
    console.log(`  Reviewer: ${reviewerEntries.length} entries`);
    console.log(`  合計: ${auditEntries.length} entries`);

    // 全エントリにタイムスタンプがある
    for (const entry of auditEntries) {
      expect(entry.ts).toBeDefined();
      expect(entry.tool).toBeDefined();
    }

    // エラーエントリがない（正常フローなので）
    const errorEntries = auditEntries.filter((e) => !e.ok);
    expect(errorEntries).toHaveLength(0);
    console.log("  エラーエントリ: 0\n");

    console.log("╔══════════════════════════════════════════════╗");
    console.log("║  シナリオ1 完了: 全チェック合格              ║");
    console.log("╚══════════════════════════════════════════════╝\n");
  });
});

// ─── シナリオ 2: 中止 → 再計画 → ベロシティ追跡 ───
describe("シナリオ2: スプリント中止からの復帰", () => {
  it("中止 → 持ち越し → 新スプリント → ベロシティ蓄積", async () => {
    console.log("\n╔══════════════════════════════════════════════╗");
    console.log("║  シナリオ2: スプリント中止からの復帰         ║");
    console.log("╚══════════════════════════════════════════════╝\n");

    // ──── Sprint 1: 正常完了（ベロシティ蓄積用） ────
    setPersona("scrum-master");
    console.log("--- Sprint 1: 基盤構築 (正常完了) ---");
    await ceremonyStart(store, { type: "refinement" });

    setPersona("product-owner");
    const t1 = await createTask("DB設計", "スキーマ設計", ["ER図", "マイグレーション"], "high", 5);
    const t2 = await createTask("API設計", "OpenAPI仕様書", ["エンドポイント定義"], "high", 5);
    const t1Id = taskId(t1);
    const t2Id = taskId(t2);
    await updateTask(t1Id, { state: "READY" });
    await updateTask(t2Id, { state: "READY" });

    setPersona("scrum-master");
    await ceremonyEnd(store, { type: "refinement" });
    await ceremonyStart(store, { type: "planning" });

    setPersona("product-owner");
    await sprintCreate(store, { goal: "基盤構築", taskIds: [t1Id, t2Id] });

    setPersona("scrum-master");
    await ceremonyEnd(store, { type: "planning" });
    await ceremonyStart(store, { type: "sprint" });

    setPersona("developer");
    for (const id of [t1Id, t2Id]) {
      await updateTask(id, { state: "IN_PROGRESS", assignee: "dev-1" });
      await updateTask(id, { state: "IN_REVIEW" });
      setPersona("reviewer");
      await updateTask(id, { state: "DONE" });
      setPersona("developer");
    }

    setPersona("scrum-master");
    await ceremonyStart(store, { type: "review" });
    await sprintComplete(store, { sprintId: "sprint-1" });
    await ceremonyEnd(store, { type: "review" });
    await ceremonyStart(store, { type: "retro" });
    await ceremonyEnd(store, { type: "retro" });
    console.log("[完了] Sprint 1: 2タスク x 5pt = 10pt\n");

    // ──── Sprint 2: 中止フロー (#9) ────
    console.log("--- Sprint 2: 決済連携 (中止) ---");
    setPersona("scrum-master");
    await ceremonyStart(store, { type: "refinement" });

    setPersona("product-owner");
    const pay1 = await createTask("Stripe統合", "Stripe Payment Intent API", ["カード支払い", "Webhook処理"], "high", 8);
    const pay2 = await createTask("PayPal統合", "PayPal Checkout", ["PayPal支払い"], "medium", 5);
    const pay3 = await createTask("請求書生成", "PDF請求書", ["PDF出力", "メール送信"], "low", 3);
    const pay1Id = taskId(pay1);
    const pay2Id = taskId(pay2);
    const pay3Id = taskId(pay3);
    for (const id of [pay1Id, pay2Id, pay3Id]) {
      await updateTask(id, { state: "READY" });
    }

    setPersona("scrum-master");
    await ceremonyEnd(store, { type: "refinement" });
    await ceremonyStart(store, { type: "planning" });

    setPersona("product-owner");
    await sprintCreate(store, { goal: "決済連携", taskIds: [pay1Id, pay2Id, pay3Id] });

    setPersona("scrum-master");
    await ceremonyEnd(store, { type: "planning" });
    await ceremonyStart(store, { type: "sprint" });

    // Dev が作業開始
    setPersona("developer");
    await updateTask(pay1Id, { state: "IN_PROGRESS", assignee: "dev-1" });
    await updateTask(pay2Id, { state: "IN_PROGRESS", assignee: "dev-2" });
    console.log("[Dev] Stripe, PayPal 着手");

    // ★ 外部要因でスプリント中止が必要に
    setPersona("scrum-master");
    console.log("[SM] ⚠ 決済プロバイダの契約問題で中止判断");

    const cancelResult = await withAudit("sprint_cancel", { sprintId: "sprint-2", reason: "決済プロバイダ契約待ち" }, () =>
      sprintCancel(store, { sprintId: "sprint-2", reason: "決済プロバイダ契約待ち" })
    );
    expect(cancelResult.ok).toBe(true);
    expect(store.peek().currentSprint!.state).toBe("CANCELLED");
    console.log(`[SM] Sprint 2 中止: ${cancelResult.message}`);

    // 中止後のセレモニーフロー: sprint→review(暗黙遷移)→retro→IDLE
    // sprint ceremony は ceremony_end できないので review 経由で抜ける
    await ceremonyStart(store, { type: "review" });
    await ceremonyEnd(store, { type: "review" });
    await ceremonyStart(store, { type: "retro" });
    await ceremonyEnd(store, { type: "retro" });
    expect(store.peek().ceremonyState).toBe("IDLE");

    // 持ち越し (#3)
    const carryOver = await withAudit("sprint_carry_over", { sprintId: "sprint-2" }, () =>
      sprintCarryOver(store, { sprintId: "sprint-2" })
    );
    expect(carryOver.ok).toBe(true);
    for (const id of [pay1Id, pay2Id, pay3Id]) {
      expect(store.peek().tasks[id].state).toBe("READY");
    }
    console.log("[SM] 全3タスクを READY に持ち越し");

    // 優先度再評価 (#7)
    setPersona("product-owner");
    await updateTask(pay3Id, { priority: "high" });
    expect(store.peek().tasks[pay3Id].priority).toBe("high");
    console.log("[PO] 請求書生成の優先度を low → high に変更\n");

    // ──── Sprint 3: 再計画 ────
    console.log("--- Sprint 3: 決済連携リトライ ---");
    setPersona("scrum-master");
    await ceremonyStart(store, { type: "planning" });

    setPersona("product-owner");
    // 持ち越しタスクで新スプリント
    await sprintCreate(store, { goal: "決済連携リトライ", taskIds: [pay1Id, pay3Id] });
    // pay2 (PayPal) はスコープ外に
    console.log("[PO] Sprint 3 スコープ: Stripe + 請求書 (PayPalは次回以降)");

    setPersona("scrum-master");
    await ceremonyEnd(store, { type: "planning" });
    await ceremonyStart(store, { type: "sprint" });

    // Dev が作業
    setPersona("developer");
    await updateTask(pay1Id, { state: "IN_PROGRESS", assignee: "dev-1" });
    await updateTask(pay1Id, { state: "IN_REVIEW" });
    setPersona("reviewer");
    await updateTask(pay1Id, { state: "DONE" });
    console.log("[完了] Stripe統合 → DONE");

    setPersona("developer");
    await updateTask(pay3Id, { state: "IN_PROGRESS", assignee: "dev-2" });
    await updateTask(pay3Id, { state: "IN_REVIEW" });
    setPersona("reviewer");
    await updateTask(pay3Id, { state: "DONE" });
    console.log("[完了] 請求書生成 → DONE");

    // レビュー＆完了
    setPersona("scrum-master");
    await ceremonyStart(store, { type: "review" });

    const metrics = await metricsReport(store, {});
    const mData = metrics.data as SprintMetrics;
    expect(mData.completionRate).toBe(100);
    expect(mData.totalPoints).toBe(11);     // 8 + 3
    expect(mData.completedPoints).toBe(11);
    console.log(`[SM] Sprint 3 メトリクス: ${mData.completedPoints}/${mData.totalPoints} pt (${mData.completionRate}%)`);

    await sprintComplete(store, { sprintId: "sprint-3" });
    await ceremonyEnd(store, { type: "review" });
    await ceremonyStart(store, { type: "retro" });
    await ceremonyEnd(store, { type: "retro" });

    // アーカイブ確認
    expect(store.getState().archivedTasks[pay1Id]).toBeDefined();
    expect(store.getState().archivedTasks[pay3Id]).toBeDefined();
    // pay2 はバックログに残る（スプリント未投入）
    expect(store.getState().tasks[pay2Id]).toBeDefined();
    expect(store.getState().tasks[pay2Id].state).toBe("READY");
    console.log("[SM] Stripe/請求書アーカイブ、PayPal はバックログ残留\n");

    // ──── ベロシティレポート (#10) ────
    console.log("=== ベロシティレポート ===");
    const velocity = await withAudit("velocity_report", {}, () => velocityReport(store, {}));
    expect(velocity.ok).toBe(true);
    const vData = velocity.data as VelocityData;

    // Sprint 1 (10pt) + Sprint 3 (11pt) = 2 完了スプリント (中止 Sprint 2 は除外)
    expect(vData.sprints).toHaveLength(2);
    expect(vData.sprints[0].id).toBe("sprint-1");
    expect(vData.sprints[0].completedPoints).toBe(10);
    expect(vData.sprints[1].id).toBe("sprint-3");
    expect(vData.sprints[1].completedPoints).toBe(11);
    expect(vData.averageVelocity).toBe(11);  // Math.round((10+11)/2) = Math.round(10.5) = 11
    console.log(`  Sprint 1: ${vData.sprints[0].completedPoints} pt (基盤構築)`);
    console.log(`  Sprint 2: [中止 - ベロシティ除外]`);
    console.log(`  Sprint 3: ${vData.sprints[1].completedPoints} pt (決済連携リトライ)`);
    console.log(`  平均ベロシティ: ${vData.averageVelocity} pt/sprint`);
    console.log(`  平均完了率: ${vData.averageCompletionRate}%`);

    // lastN=1 で最新のみ
    const vLast = await velocityReport(store, { lastN: 1 });
    const vLastData = vLast.data as VelocityData;
    expect(vLastData.sprints).toHaveLength(1);
    expect(vLastData.sprints[0].id).toBe("sprint-3");
    console.log(`  lastN=1: Sprint 3 (${vLastData.sprints[0].completedPoints} pt) のみ取得OK\n`);

    console.log("╔══════════════════════════════════════════════╗");
    console.log("║  シナリオ2 完了: 中止→復帰→ベロシティOK     ║");
    console.log("╚══════════════════════════════════════════════╝\n");
  });
});

// ─── シナリオ 3: エラーリカバリ＆ガードレール検証 ───
describe("シナリオ3: エラーリカバリとガードレール", () => {
  it("不正操作を適切にブロックする", async () => {
    console.log("\n╔══════════════════════════════════════════════╗");
    console.log("║  シナリオ3: エラーリカバリ＆ガードレール     ║");
    console.log("╚══════════════════════════════════════════════╝\n");

    // ── セレモニー重複ブロック ──
    setPersona("scrum-master");
    await ceremonyStart(store, { type: "refinement" });
    const dupe = await ceremonyStart(store, { type: "planning" });
    expect(dupe.ok).toBe(false);
    expect(dupe.error).toContain("refinement」が実行中");
    console.log("[Guard] セレモニー重複ブロック OK");
    await ceremonyEnd(store, { type: "refinement" });

    // ── READY でないタスクでのスプリント作成ブロック ──
    setPersona("product-owner");
    const t = await createTask("Not Ready", "d", [], "medium");
    const tId = taskId(t);
    const badSprint = await sprintCreate(store, { goal: "Bad", taskIds: [tId] });
    expect(badSprint.ok).toBe(false);
    expect(badSprint.error).toContain("READY 状態でない");
    console.log("[Guard] READY以外でスプリント作成ブロック OK");

    // ── 不正な状態遷移ブロック ──
    const badTransition = await updateTask(tId, { state: "IN_PROGRESS" });
    expect(badTransition.ok).toBe(false);
    expect(badTransition.error).toContain("遷移はできません");
    console.log("[Guard] BACKLOG→IN_PROGRESS 不正遷移ブロック OK");

    // ── 更新フィールドなしブロック (#7) ──
    const noField = await updateTask(tId, {});
    expect(noField.ok).toBe(false);
    console.log("[Guard] 更新フィールドなしブロック OK");

    // ── 正常にスプリント作成して追加のガードレール検証 ──
    await updateTask(tId, { state: "READY" });
    await ceremonyStart(store, { type: "planning" });
    await sprintCreate(store, { goal: "Test Sprint", taskIds: [tId] });
    await ceremonyEnd(store, { type: "planning" });

    // ACTIVE スプリントへの追加ブロック
    await ceremonyStart(store, { type: "sprint" });
    const t2 = await createTask("Extra", "d", [], "low");
    const t2Id = taskId(t2);
    await updateTask(t2Id, { state: "READY" });
    const addToActive = await sprintAddTasks(store, { sprintId: "sprint-1", taskIds: [t2Id] });
    expect(addToActive.ok).toBe(false);
    console.log("[Guard] ACTIVEスプリントへのタスク追加ブロック OK");

    // PLANNING スプリントは完了できない
    const store2 = await StateStore.init("/tmp/scrum-scenario-guard.json");
    const tg = await taskCreate(store2, { title: "G", description: "d", acceptanceCriteria: [], priority: "high" });
    const tgId = (tg.data as { taskId: string }).taskId;
    await taskUpdate(store2, { taskId: tgId, state: "READY" });
    await sprintCreate(store2, { goal: "G", taskIds: [tgId] });
    const badComplete = await sprintComplete(store2, { sprintId: "sprint-1" });
    expect(badComplete.ok).toBe(false);
    expect(badComplete.error).toContain("PLANNING");
    console.log("[Guard] PLANNINGスプリント完了ブロック OK");
    try { await unlink("/tmp/scrum-scenario-guard.json"); } catch { /* ignore */ }

    // ACTIVE スプリントからの持ち越しブロック (#3)
    const badCarry = await sprintCarryOver(store, { sprintId: "sprint-1" });
    expect(badCarry.ok).toBe(false);
    console.log("[Guard] ACTIVEスプリント持ち越しブロック OK");

    // sprint を ceremony_end で終了させようとするとブロック
    const badEnd = await ceremonyEnd(store, { type: "sprint" });
    expect(badEnd.ok).toBe(false);
    expect(badEnd.error).toContain("ceremony_end では終了できません");
    console.log("[Guard] sprint ceremony_end ブロック OK");

    // 完了済みスプリントの中止ブロック (#9)
    await updateTask(tId, { state: "IN_PROGRESS" });
    await updateTask(tId, { state: "IN_REVIEW" });
    await updateTask(tId, { state: "DONE" });
    await ceremonyStart(store, { type: "review" });
    await sprintComplete(store, { sprintId: "sprint-1" });
    const badCancel = await sprintCancel(store, { sprintId: "sprint-1", reason: "test" });
    expect(badCancel.ok).toBe(false);
    console.log("[Guard] 完了済みスプリント中止ブロック OK");

    // 存在しないタスク参照ブロック
    const noTask = await getTask(store, { taskId: "task-nonexistent" });
    expect(noTask.ok).toBe(false);
    expect(noTask.error).toContain("見つかりません");
    console.log("[Guard] 存在しないタスク参照ブロック OK");

    // ベロシティレポート（完了スプリントなし）
    const emptyStore = await StateStore.init("/tmp/scrum-scenario-empty.json");
    const noVelocity = await velocityReport(emptyStore, {});
    expect(noVelocity.ok).toBe(false);
    console.log("[Guard] ベロシティ（完了なし）ブロック OK");
    try { await unlink("/tmp/scrum-scenario-empty.json"); } catch { /* ignore */ }

    console.log("\n╔══════════════════════════════════════════════╗");
    console.log("║  シナリオ3 完了: 全ガードレール合格          ║");
    console.log("╚══════════════════════════════════════════════╝\n");
  });
});
