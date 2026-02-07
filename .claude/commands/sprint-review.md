# スプリントレビュー

スプリントレビューセレモニーを実施し、スプリントを完了します。

## 手順

1. `ceremony_start` type: "review" でレビューを開始
2. `metrics_report` でスプリントメトリクスを確認
3. DONE 状態のタスクについて Product Owner が受入判定を実施
4. 未完了タスクの状況を確認
5. `github_sync` で完了した Issue をクローズ
6. `sprint_complete` でスプリントを完了
7. `ceremony_end` type: "review" でセレモニーを終了

## 注意事項

- sprint 実行中に review を開始すると sprint が暗黙終了する
- sprint_complete はスプリントが ACTIVE 状態でないと実行できない
