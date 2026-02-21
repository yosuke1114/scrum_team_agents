# スプリント開始

スプリントを開始し、開発作業をキックオフします。

## 実行フロー

### Step 1: 事前確認
- `project_status` でプロジェクト状況を確認する
- currentSprint が存在し、state が PLANNING であることを確認する
- スプリントが存在しない場合 → 「先に /planning を実施してください」と案内して終了する

### Step 2: スプリント開始
- `ceremony_start` type: "sprint" を実行する
- これにより currentSprint.state が ACTIVE に変わる

### Step 3: タスク状態確認
- `list_tasks` sprintId: (現在のスプリントID) でスプリントタスク一覧を表示する
- 全タスクが TODO 状態であることを確認する

### Step 4: GitHub 同期
- 各タスクについて `github_sync` action: "update" でラベルを同期する
- GitHub Issue が未作成のタスクは `github_sync` action: "create" で作成する

### Step 5: WIP 確認
- `wip_status` で現在の WIP 状態を確認する
- 制限内であることを確認する

### Step 6: キックオフサマリー
- 以下を表示する:
  - スプリントゴール
  - タスク一覧（ID, タイトル, 優先度）
  - WIP 制限（IN_PROGRESS / IN_REVIEW）
  - 「開発を開始してください。タスクを着手するときは task_update で IN_PROGRESS に遷移してください」

## 成功条件
- スプリントが ACTIVE 状態であること
- タスクが TODO 状態で開発開始可能であること

## 参加エージェント
- **Scrum Master**: セレモニー開始、WIP 確認
- **Developer**: タスク確認、作業開始
