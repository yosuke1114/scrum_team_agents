# レトロスペクティブ

スプリントの振り返りを実施し、改善アクションを策定します。

## 実行フロー

### Step 1: 状態確認
- `project_status` でプロジェクト状況を確認する
- ceremonyState が SPRINT_REVIEW であることを確認する
- currentSprint が COMPLETED 状態であることを確認する
- 条件を満たさなければ「先に /sprint-review を完了してください」と案内して終了する

### Step 2: セレモニー開始
- `ceremony_start` type: "retro" を実行する

### Step 3: メトリクス振り返り
- `metrics_report` でスプリントメトリクスを表示する
- 以下を確認・報告する:
  - 完了率（目標 vs 実績）
  - BLOCKED タスクがあったか（ブロッカー分析）
  - WIP 制限は適切だったか

### Step 4: KPT 実施
- ユーザーと対話して以下を整理する:

**Keep（継続すべきこと）**
- 今スプリントで効果的だったプラクティスや習慣
- チームで維持したい良い点

**Problem（課題）**
- 今スプリントで問題になったこと
- ブロッカーの原因分析
- プロセスの改善点

**Try（次に試すこと）**
- Problem を解決するための具体的なアクション
- 新しく試したいプラクティス

### Step 5: アクションアイテム策定
- KPT の Try から具体的なアクションアイテムを策定する
- 各アクションアイテムに担当者を設定する
- 必要に応じて `task_create` でバックログにアクションアイテムを追加する
  - priority: 改善の緊急度に応じて設定
  - description にレトロの背景を記載する

### Step 6: WIP 制限見直し
- 現在の WIP 制限が適切か議論する:
  - IN_PROGRESS: 現在 {wipLimits.inProgress}
  - IN_REVIEW: 現在 {wipLimits.inReview}
- 変更が必要な場合はユーザーに提案する

### Step 7: 終了
- KPT のサマリーとアクションアイテムを表示する
- `ceremony_end` type: "retro" でセレモニーを終了する（IDLE に戻る）
- 「次のスプリントサイクルを開始するには /refinement を実行してください」と案内する

## 成功条件
- KPT が実施されていること
- 最低1つのアクションアイテムが策定されていること
- ceremonyState が IDLE に戻っていること

## 参加エージェント
- **Scrum Master**: セレモニー進行、メトリクス分析、KPT ファシリテート
- **全エージェント**: KPT への参加、改善提案
