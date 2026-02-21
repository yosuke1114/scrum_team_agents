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

### Step 4: 知識ベース参照
- `knowledge_query` で過去の知識を参照する
- 繰り返しパターンや前スプリントの学びを確認する

### Step 5: KPT 実施
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

### Step 6: 構造化振り返り（EVALUATE → LEARN）
- `reflect` で構造化振り返りを記録する:
  - trigger: "phase_end" or "low_completion" or "blocker"
  - what: 何が起きたか
  - why: なぜ起きたか
  - action: 次に何をするか
- 前スプリントの振り返りがあれば `reflect_evaluate` で有効性を評価する

### Step 7: 知識蓄積（LEARN → PLAN）
- `knowledge_update` で学びを知識ベースに記録する:
  - category: "pattern" / "antipattern" / "technique" / "constraint"
  - insight: 具体的な知見
- 自動的に LEARN → PLAN にフェーズ遷移する

### Step 8: アクションアイテム策定
- KPT の Try から具体的なアクションアイテムを策定する
- 各アクションアイテムに担当者を設定する
- 必要に応じて `task_create` でバックログにアクションアイテムを追加する

### Step 9: WIP 制限見直し
- 現在の WIP 制限が適切か議論する

### Step 10: 終了
- KPT のサマリーとアクションアイテムを表示する
- `ceremony_end` type: "retro" でセレモニーを終了する（IDLE に戻る）
- 「次のスプリントサイクルを開始するには /refinement を実行してください」と案内する

## 成功条件
- KPT が実施されていること
- 最低1つの `reflect` が記録されていること
- 最低1つの `knowledge_update` が記録されていること
- ceremonyState が IDLE に戻っていること
- phase が PLAN に戻っていること

## 参加エージェント
- **Scrum Master**: セレモニー進行、メトリクス分析、KPT ファシリテート
- **全エージェント**: KPT への参加、改善提案
