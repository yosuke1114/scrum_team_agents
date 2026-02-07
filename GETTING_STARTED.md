# Getting Started

## 前提条件

- Node.js 20+
- Claude Code CLI
- GitHub CLI (`gh`) - GitHub 連携を使用する場合

## インストール

```bash
# 依存関係のインストール
cd scrum-mcp
npm install

# ビルド
npm run build
```

## 動作確認

```bash
# テスト実行
cd scrum-mcp
npm test
```

## 使い方

### 1. Claude Code でプロジェクトを開く

```bash
claude
```

MCP サーバーが自動的に起動します（`.claude/settings.json` で設定済み）。

### 2. スプリントサイクルを実行

以下のスラッシュコマンドでセレモニーを進行します:

```
/refinement    # バックログリファインメント
/planning      # スプリントプランニング
/sprint-start  # スプリント開始
/sprint-review # スプリントレビュー
/retro         # レトロスペクティブ
```

### 3. エージェントチーム

Agent Teams 機能により、4つのエージェントが自動的に協調動作します:

- **Scrum Master**: セレモニーの進行を管理
- **Product Owner**: タスクの作成と優先度管理
- **Developer**: タスクの実装
- **Reviewer**: コードレビュー

## 設定

### GitHub リポジトリの設定

GitHub 連携を使用する場合は、状態ファイル（`.scrum/state.json`）の
`config.githubRepo` に `"owner/repo"` 形式でリポジトリを設定してください。

### WIP 制限の調整

デフォルトの WIP 制限:
- IN_PROGRESS: 2
- IN_REVIEW: 1

状態ファイルの `wipLimits` で調整できます。
