# プロジェクトステータス

プロジェクトの現在の状態をダッシュボード形式で表示します。
パイプラインモードの事前確認やデイリーチェックに使用します。

## 実行フロー

### Step 1: プロジェクト全体状態
- `project_status` でプロジェクト状況を取得する
- 以下を表示する:
  - セレモニー状態（IDLE / REFINEMENT / PLANNING / ...）
  - 現在のスプリント情報（ID, ゴール, 状態）

### Step 2: タスク状態サマリー
- `list_tasks` で全タスクを取得する
- 状態別のカウントを表示する:
  ```
  タスク状態:
    BACKLOG:     N 件
    READY:       N 件
    TODO:        N 件
    IN_PROGRESS: N 件
    IN_REVIEW:   N 件
    DONE:        N 件
    BLOCKED:     N 件
  ```

### Step 3: WIP 状態
- `wip_status` で WIP 制限の状態を表示する
- 警告がある場合はハイライトする

### Step 4: ブロッカー確認
- `list_tasks` state: "BLOCKED" でブロックされたタスクを確認する
- ブロッカーがあれば詳細を表示する

### Step 5: 次のアクション提案
- 現在の状態に基づいて、次に実行すべきコマンドを提案する:
  - IDLE → `/refinement` または `/pipeline`
  - REFINEMENT 完了後 → `/planning`
  - PLANNING 完了後 → `/sprint-start`
  - SPRINT_ACTIVE → 「実装を続けてください」
  - SPRINT_REVIEW 完了後 → `/retro`

## 参加エージェント
- **Scrum Master**: ステータス確認
