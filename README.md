# Scrum Team Agents

Claude Code Agent Teams + MCP Server によるスクラムセレモニー自動化システム。

4つの AI エージェント（Scrum Master, Product Owner, Developer, Reviewer）が
tmux ペイン上で協調し、スプリントサイクルを自動実行します。

## アーキテクチャ

- **MCP Server** (`scrum-mcp/`): スクラム状態管理とツール提供
- **エージェント** (`.claude/agents/`): 4つの役割別 AI エージェント
- **コマンド** (`.claude/commands/`): 5つのスクラムセレモニーコマンド

## セットアップ

```bash
cd scrum-mcp
npm install
npm run build
```

## テスト

```bash
cd scrum-mcp
npm test
```

## MCP ツール

| ツール | 説明 |
|--------|------|
| ceremony_start | セレモニーを開始 |
| ceremony_end | セレモニーを終了 |
| sprint_create | スプリントとタスクを作成 |
| sprint_complete | スプリントを完了 |
| task_create | バックログにタスクを作成 |
| task_update | タスク状態を更新 |
| github_sync | GitHub Issue と同期 |
| metrics_report | スプリントメトリクスを取得 |
| wip_status | WIP 状態を確認 |

## スプリントサイクル

1. `/refinement` - バックログリファインメント
2. `/planning` - スプリントプランニング
3. `/sprint-start` - スプリント開始
4. `/sprint-review` - スプリントレビュー
5. `/retro` - レトロスペクティブ

## エージェント

- **Scrum Master**: セレモニー進行、ブロッカー検知、WIP 監視
- **Product Owner**: バックログ管理、優先度設定、受入判定
- **Developer**: タスク実装、テスト作成、状態更新
- **Reviewer**: コードレビュー、品質保証
