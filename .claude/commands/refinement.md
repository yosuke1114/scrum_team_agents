# リファインメント

バックログリファインメントセレモニーを実施します。

## 手順

1. `ceremony_start` type: "refinement" でセレモニーを開始
2. BACKLOG 状態のタスク一覧を表示
3. Product Owner がタスクを追加（`task_create`）し、受入条件を明確化
4. `github_sync` で GitHub Issue を作成
5. READY 判定を行い、準備完了タスクを `task_update` で READY に遷移
6. `ceremony_end` type: "refinement" でセレモニーを終了

## 注意事項

- 各タスクには必ず受入条件（acceptanceCriteria）を設定すること
- READY に遷移するのは十分に定義されたタスクのみ
