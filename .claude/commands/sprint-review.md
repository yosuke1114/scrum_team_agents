# スプリントレビュー

スプリントの成果を確認し、スプリントを完了します。

## 実行フロー

### Step 1: 状態確認
- `project_status` でプロジェクト状況を確認する
- currentSprint が ACTIVE 状態であることを確認する
- ACTIVE でなければ「アクティブなスプリントがありません」と案内して終了する

### Step 2: セレモニー開始
- `ceremony_start` type: "review" を実行する
- sprint 実行中の場合、sprint が暗黙的に終了し review に遷移する

### Step 3: メトリクス確認
- `metrics_report` でスプリントメトリクスを表示する
  - 完了率、状態別タスク数、優先度別タスク数を確認する
- `ooda_observe` でスプリント最終状態のスナップショットを取得する

### Step 4: DONE タスクの受入判定
- `list_tasks` state: "DONE" sprintId: (現在のスプリントID) で完了タスクを一覧表示する
- 各 DONE タスクについて:
  - `get_task` で受入条件を確認する
  - 受入条件をすべて満たしている → 受入 OK
  - 満たしていない → `task_update` state: "IN_PROGRESS" に差し戻す（理由を明記）

### Step 5: 未完了タスクの確認
- `list_tasks` sprintId: (現在のスプリントID) で未完了タスクを確認する
  - IN_PROGRESS / IN_REVIEW / TODO / BLOCKED のタスクがあれば一覧表示する
  - 各タスクの残課題をユーザーに報告する

### Step 6: GitHub クローズ
- DONE タスクで GitHub Issue が紐づいているものについて:
  - `github_sync` action: "close" で Issue をクローズする

### Step 7: スプリント完了
- `sprint_complete` sprintId: (現在のスプリントID) を実行する
- 完了メトリクス（完了率、完了タスク数）を表示する
- フェーズが自動的に EXECUTE → EVALUATE に遷移する

### Step 8: 終了
- `ceremony_end` type: "review" でセレモニーを終了する
- 「次は /retro で振り返り（reflect + knowledge_update）を実施してください」と案内する

## 成功条件
- スプリントが COMPLETED 状態であること
- DONE タスクの受入判定が完了していること

## 参加エージェント
- **Scrum Master**: セレモニー進行、メトリクス報告
- **Product Owner**: 受入判定（DONE タスクの検証）
- **Reviewer**: コード品質の最終確認
