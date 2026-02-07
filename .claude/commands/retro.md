# レトロスペクティブ

スプリントの振り返りを実施します。

## 手順

1. `ceremony_start` type: "retro" でレトロスペクティブを開始
2. `metrics_report` でスプリントメトリクスを振り返り
3. KPT（Keep / Problem / Try）を実施
   - **Keep**: 継続すべき良かったこと
   - **Problem**: 改善すべき問題点
   - **Try**: 次スプリントで試すこと
4. アクションアイテムを策定
5. WIP 制限の見直しを検討
6. `ceremony_end` type: "retro" でセレモニーを終了（IDLE に戻る）

## 注意事項

- retro 終了で ceremonyState が IDLE に戻り、次のスプリントサイクルが開始可能になる
- アクションアイテムは具体的で担当者を明確にすること
