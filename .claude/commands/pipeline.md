# スプリントパイプライン

スプリントサイクルのセレモニーを連続して実行するパイプラインモードです。
CI 環境やデモ、一気通貫のスプリント実行に使用します。

## 引数

$ARGUMENTS

### 引数の解釈ルール

引数文字列から以下のパラメータを抽出する（順不同、省略可）:

| パラメータ | 形式 | デフォルト | 説明 |
|-----------|------|-----------|------|
| `sprints` | `sprints: N` または数値のみ | `1` | 実行するスプリントの回数 |
| `from` | `from: "ceremony"` | なし | 開始セレモニー（1周目のみ有効） |

**解釈例**:
- `/pipeline 3` → sprints=3
- `/pipeline sprints: 5` → sprints=5
- `/pipeline sprints: 3 from: planning` → sprints=3, 1周目は planning から開始
- `/pipeline from: review` → sprints=1, review から開始
- `/pipeline` → sprints=1, フルサイクル

## モード

### フルサイクル（デフォルト）
4フェーズ（PLAN→EXECUTE→EVALUATE→LEARN）を一気通貫で実行する:
1. Refinement → 2. Planning → 3. Sprint Start → 4. Sprint (実装 + OODA) → 5. Sprint Review → 6. Retro (振り返り + 知識蓄積)

### ハーフサイクル（from で開始位置を指定 — 1周目のみ）
途中のセレモニーから実行を開始する:
- `from: "planning"` → Planning から Retro まで
- `from: "sprint"` → Sprint Start から Retro まで
- `from: "review"` → Sprint Review から Retro まで

**注意**: `from` は1周目のみ適用される。2周目以降は常にフルサイクルで実行する。

## マルチスプリント実行フロー

```
sprints: N の場合

Sprint 1: [Refinement → Planning → Sprint → Review → Retro]
    ↓ carry over + knowledge 適用
Sprint 2: [Refinement → Planning → Sprint → Review → Retro]
    ↓ carry over + knowledge 適用
  ...
Sprint N: [Refinement → Planning → Sprint → Review → Retro]
    ↓
全体サマリー表示
```

### スプリント間の自動処理

各スプリント完了後、次のスプリント開始前に以下を自動実行する:

1. **タスク持ち越し**: 未完了タスク（BLOCKED, IN_PROGRESS）を `sprint_carry_over` で READY に戻す
2. **知識適用**: `knowledge_query` で前スプリントの学びを取得し、次の計画に反映する
3. **進捗表示**: 現在のスプリント番号と全体進捗を表示する:
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Sprint 2/3 開始
   前回: 完了 4/5 タスク, Velocity 12pt
   持ち越し: 1 タスク
   適用知識: 3 件
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```

## 実行フロー（各スプリント共通）

### Step 1: 状態確認と実行計画
- `project_status` + `phase_status` でプロジェクト状況を確認する
- 現在のフェーズと ceremonyState に基づいて実行可能なセレモニーを判定する
- `knowledge_query` で前サイクルの知識を参照する
- パイプラインの実行計画を表示する:
  ```
  パイプライン実行計画 (Sprint 1/3):
  [1] Refinement    ← 開始
  [2] Planning
  [3] Sprint Start
  [4] Sprint (実装)
  [5] Sprint Review
  [6] Retro          ← 終了
  ```

### Step 2: Refinement 実行
**スキップ条件**: from が "planning" 以降の場合（1周目のみ）、または READY タスクが十分にある場合
- `/refinement` コマンドと同等のフローを実行する
- **自動判定**: 各タスクの受入条件が定義されていれば自動で READY に遷移する
- セレモニー完了後、次のステップへ進む

### Step 3: Planning 実行
**スキップ条件**: from が "sprint" 以降の場合（1周目のみ）
- `/planning` コマンドと同等のフローを実行する
- **自動判定**: READY タスクをすべてスプリントに含める（WIP 制限を考慮）
- **2周目以降**: 持ち越しタスク + 新規バックログタスクを対象にする
- セレモニー完了後、次のステップへ進む

### Step 4: Sprint Start 実行
**スキップ条件**: from が "review" 以降の場合（1周目のみ）
- `/sprint-start` コマンドと同等のフローを実行する
- Sprint 開始後、実装フェーズに移る

### Step 5: Sprint (実装フェーズ + OODA ループ)
- Developer エージェントのワークフローに従い、タスクを実装する
- 各タスクについて:
  1. `task_update` state: "IN_PROGRESS" で作業開始
  2. 実装・テスト作成
  3. `quality_check` でセルフチェック
  4. `task_update` state: "IN_REVIEW" でレビュー依頼
  5. Reviewer がレビュー → DONE or 差し戻し
- **OODA ループ**: タスク遷移ごとに `ooda_observe` → `ooda_orient` → `ooda_decide` で状況判断
  - ボトルネック検出時は推奨アクションに従う
  - `ooda_log` でサイクルを記録
- **完了条件**: 全タスクが DONE または BLOCKED になった時点で次へ進む

### Step 6: Sprint Review 実行
- `/sprint-review` コマンドと同等のフローを実行する
- **並列レビュー**: PO（受入条件）と Reviewer（コード品質）が同時に判定する
- セレモニー完了後、次のステップへ進む

### Step 7: Retro 実行（EVALUATE → LEARN → PLAN）
- `/retro` コマンドと同等のフローを実行する
- KPT を実施し、アクションアイテムを策定する
- `reflect` で構造化振り返りを記録（EVALUATE → LEARN 自動遷移）
- `knowledge_update` で学びを知識ベースに記録（LEARN → PLAN 自動遷移）
- スプリント完了

### Step 8: スプリント間処理（次のスプリントがある場合のみ）
- `sprint_carry_over` で未完了タスクを READY に戻す
- `velocity_report` で累積ベロシティを確認する
- `knowledge_query` で蓄積された知識を取得する
- 次のスプリント（Step 1）へ進む

## 全体サマリー（全スプリント完了後）

全スプリントの実行結果を集約して表示する:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  パイプライン完了: 全 3 スプリント
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Sprint 1: ✓ 完了 4/5 タスク | 12pt | ゴール: "認証機能"
Sprint 2: ✓ 完了 3/3 タスク |  8pt | ゴール: "API 連携"
Sprint 3: ✓ 完了 5/5 タスク | 15pt | ゴール: "UI 改善"

累計:
  完了タスク: 12/13
  総ポイント: 35pt
  平均 Velocity: 11.7pt/sprint
  OODA サイクル: 9 回
  振り返り: 6 件 (有効: 4)
  知識蓄積: 8 件

ベロシティ推移:
  Sprint 1: ████████████ 12pt
  Sprint 2: ████████ 8pt
  Sprint 3: ███████████████ 15pt

次のアクション: /pipeline N または /scrum
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

`ceremony_report` type: "pipeline" でパイプライン全体のレポートを保存する

## エラーハンドリング

### セレモニー失敗時
- 失敗したセレモニーでパイプラインを停止する
- 失敗理由と復旧方法を表示する
- 「`/pipeline from: "{次のセレモニー}"` で再開できます」と案内する
- マルチスプリントの途中で失敗した場合、完了済みスプリントの結果は保持される

### ブロッカー検知時
- Sprint 中に BLOCKED タスクが発生した場合:
  - ブロッカーの内容を表示する
  - ユーザーに続行するか確認する（BLOCKED タスクを除外して続行 or 停止）

### 全タスク BLOCKED 時（マルチスプリント）
- 全タスクが BLOCKED のスプリントが発生した場合:
  - 現在のスプリントを `sprint_cancel` で中止する
  - ブロッカー情報を `reflect` に記録する
  - 残りのスプリントを続行するかユーザーに確認する

## 成功条件
- phase が PLAN に戻っていること
- ceremonyState が IDLE に戻っていること
- 少なくとも1つのタスクが DONE であること
- Retro の KPT が実施されていること
- 最低1つの `reflect` と `knowledge_update` が記録されていること

## 参加エージェント
- **全エージェント**: 各セレモニーの役割に従う
