# スプリントプランニング

スプリントプランニングセレモニーを実施します。

## 実行フロー

### Step 1: 状態確認
- `project_status` でプロジェクト状況を確認する
- ceremonyState が IDLE または REFINEMENT 終了後であることを確認する
- `list_tasks` state: "READY" で READY タスクを一覧表示する
- READY タスクが 0 件の場合 → 「先に /refinement を実施してください」と案内して終了する

### Step 2: セレモニー開始
- `ceremony_start` type: "planning" を実行する

### Step 3: スプリントゴール策定
- READY タスクを優先度順に表示し、ユーザーと議論する
- `wip_status` で WIP 制限を確認する（inProgress 上限を考慮してタスク数を決定）
- ユーザーにスプリントゴール（1文で表現できる達成目標）を確認する

### Step 4: タスク選択
- ユーザーと協議して、スプリントに含めるタスクを選択する
- 選択基準:
  - 優先度 high のタスクを優先
  - WIP 制限（デフォルト: IN_PROGRESS 2）を考慮した数量
  - スプリントゴールとの整合性

### Step 5: スプリント作成
- `sprint_create` を実行する:
  - goal: ユーザーと合意したゴール
  - tasks: 選択したタスク（title, description, acceptanceCriteria, priority）
- 作成されたスプリントの内容を表示する

### Step 6: サマリーと終了
- 作成したスプリントのゴール、タスク数、優先度内訳を表示する
- `ceremony_end` type: "planning" でセレモニーを終了する
- 「次は /sprint-start でスプリントを開始してください」と案内する

## 成功条件
- スプリントが PLANNING 状態で作成されていること
- 最低1つのタスクがスプリントに含まれていること

## 参加エージェント
- **Scrum Master**: セレモニー進行
- **Product Owner**: タスク選択・ゴール策定
- **Developer**: 工数見積もり・技術的フィードバック
