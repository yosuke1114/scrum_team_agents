# スプリント開始

スプリントを開始し、チームの作業を開始します。

## 手順

1. `ceremony_start` type: "sprint" でスプリントを開始（ACTIVE に遷移）
2. 必要に応じてタスク状態を TODO に初期化
3. `github_sync` で GitHub Issue のラベルを同期
4. `wip_status` で WIP 状態を確認
5. 開始サマリーを表示（ゴール、タスク一覧、WIP 状態）

## 注意事項

- sprint_create が事前に完了していること
- スプリント開始後は sprint→review の暗黙遷移が可能
