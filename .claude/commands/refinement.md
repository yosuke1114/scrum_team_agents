# リファインメント

バックログリファインメントセレモニーを実施します。

## 実行フロー

### Step 1: 状態確認
- `project_status` でプロジェクト状況を確認する
- ceremonyState が IDLE であることを確認する
- IDLE でなければ「先に現在のセレモニーを完了してください」と案内して終了する

### Step 2: セレモニー開始
- `ceremony_start` type: "refinement" を実行する

### Step 3: バックログ確認
- `list_tasks` state: "BACKLOG" で現在のバックログタスクを一覧表示する
- タスクがある場合は、ユーザーに確認を求める（追加が必要か、既存タスクの修正が必要か）

### Step 4: タスク追加・修正
- ユーザーと対話しながら以下を繰り返す:
  - `task_create` で新規タスクを追加する
    - **必須**: title, description, acceptanceCriteria（最低1つ）, priority
  - 受入条件が明確であることを確認する
  - 必要なら `github_sync` action: "create" で GitHub Issue を作成する

### Step 5: READY 判定
- 各タスクについてユーザーと READY 判定を行う:
  - 受入条件が明確 → `task_update` state: "READY" に遷移
  - まだ不明確 → BACKLOG のまま残す（理由をユーザーに説明）

### Step 6: サマリーと終了
- `list_tasks` state: "READY" で READY タスクを表示する
- `list_tasks` state: "BACKLOG" で残りのバックログを表示する
- `ceremony_end` type: "refinement" でセレモニーを終了する

## 成功条件
- 最低1つのタスクが READY 状態になっていること
- 全タスクに受入条件が設定されていること

## 参加エージェント
- **Scrum Master**: セレモニー進行（ceremony_start/end）
- **Product Owner**: タスク定義・READY 判定（task_create, task_update, github_sync）
