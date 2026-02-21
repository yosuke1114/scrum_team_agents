# スプリントパイプライン

スプリントサイクルのセレモニーを連続して実行するパイプラインモードです。
CI 環境やデモ、一気通貫のスプリント実行に使用します。

## モード

### フルサイクル（デフォルト）
全セレモニーを順に実行する:
1. Refinement → 2. Planning → 3. Sprint Start → 4. Sprint (実装) → 5. Sprint Review → 6. Retro

### ハーフサイクル（from で開始位置を指定）
途中のセレモニーから実行を開始する:
- `from: "planning"` → Planning から Retro まで
- `from: "sprint"` → Sprint Start から Retro まで
- `from: "review"` → Sprint Review から Retro まで

## 実行フロー

### Step 1: 状態確認と実行計画
- `project_status` でプロジェクト状況を確認する
- 現在の ceremonyState に基づいて実行可能なセレモニーを判定する
- パイプラインの実行計画を表示する:
  ```
  パイプライン実行計画:
  [1] Refinement    ← 開始
  [2] Planning
  [3] Sprint Start
  [4] Sprint (実装)
  [5] Sprint Review
  [6] Retro          ← 終了
  ```

### Step 2: Refinement 実行
**スキップ条件**: from が "planning" 以降の場合、または READY タスクが十分にある場合
- `/refinement` コマンドと同等のフローを実行する
- **自動判定**: 各タスクの受入条件が定義されていれば自動で READY に遷移する
- セレモニー完了後、次のステップへ進む

### Step 3: Planning 実行
**スキップ条件**: from が "sprint" 以降の場合
- `/planning` コマンドと同等のフローを実行する
- **自動判定**: READY タスクをすべてスプリントに含める（WIP 制限を考慮）
- セレモニー完了後、次のステップへ進む

### Step 4: Sprint Start 実行
**スキップ条件**: from が "review" 以降の場合
- `/sprint-start` コマンドと同等のフローを実行する
- Sprint 開始後、実装フェーズに移る

### Step 5: Sprint (実装フェーズ)
- Developer エージェントのワークフローに従い、タスクを実装する
- 各タスクについて:
  1. `task_update` state: "IN_PROGRESS" で作業開始
  2. 実装・テスト作成
  3. `task_update` state: "IN_REVIEW" でレビュー依頼
  4. Reviewer がレビュー → DONE or 差し戻し
- **完了条件**: 全タスクが DONE または BLOCKED になった時点で次へ進む

### Step 6: Sprint Review 実行
- `/sprint-review` コマンドと同等のフローを実行する
- **並列レビュー**: PO（受入条件）と Reviewer（コード品質）が同時に判定する
- セレモニー完了後、次のステップへ進む

### Step 7: Retro 実行
- `/retro` コマンドと同等のフローを実行する
- KPT を実施し、アクションアイテムを策定する
- パイプライン完了

### Step 8: パイプライン完了サマリー
- 全セレモニーの実行結果を表示する:
  ```
  パイプライン完了:
  ✓ Refinement  - READY タスク: N 件
  ✓ Planning    - スプリントゴール: "..."
  ✓ Sprint      - 完了タスク: N/M 件
  ✓ Review      - 受入: N 件, 差し戻し: N 件
  ✓ Retro       - アクション: N 件

  次のサイクル: /pipeline または /refinement
  ```
- `ceremony_report` type: "pipeline" でパイプライン全体のレポートを保存する

## エラーハンドリング

### セレモニー失敗時
- 失敗したセレモニーでパイプラインを停止する
- 失敗理由と復旧方法を表示する
- 「`/pipeline from: "{次のセレモニー}"` で再開できます」と案内する

### ブロッカー検知時
- Sprint 中に BLOCKED タスクが発生した場合:
  - ブロッカーの内容を表示する
  - ユーザーに続行するか確認する（BLOCKED タスクを除外して続行 or 停止）

## 成功条件
- ceremonyState が IDLE に戻っていること
- 少なくとも1つのタスクが DONE であること
- Retro の KPT が実施されていること

## 参加エージェント
- **全エージェント**: 各セレモニーの役割に従う
