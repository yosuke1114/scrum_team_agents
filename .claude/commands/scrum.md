# Scrum インタラクティブモード

スプリントサイクルの対話的なナビゲーターです。
現在の状態に応じて利用可能なアクションを表示し、選択に基づいてセレモニーを実行します。

## 実行フロー

### Step 1: 現在の状態を取得

`project_status` + `phase_status` を実行し、以下を表示する:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Scrum Team - インタラクティブモード
━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔄 フェーズ: {phase} (PLAN/EXECUTE/EVALUATE/LEARN)
📊 セレモニー: {ceremonyState}
🏃 スプリント: {sprint情報 or "なし"}
📦 バックログ: BACKLOG {n} 件 / READY {n} 件
⚡ WIP: IN_PROGRESS {n}/{limit} | IN_REVIEW {n}/{limit}
📊 OODA: {n}回 | 振返り: {n}件 | 知識: {n}件
```

### Step 2: 利用可能なアクションを提示

フェーズ（phase）に基づいて、次に実行可能なアクションを表示する:

**PLAN フェーズ（バックログ整理・計画）**
```
利用可能なアクション:
  [1] 🔍 Refinement    - バックログの整理と READY 判定
  [2] 📋 Planning      - スプリント計画の策定（READY タスクがある場合）
  [3] 🔄 Pipeline      - 全フェーズを一気通貫で実行
  [4] 📚 Knowledge     - 知識ベースを確認
```

**EXECUTE フェーズ（スプリント実行中）**
```
利用可能なアクション:
  [1] 📝 タスクの実装を続ける
  [2] 👁 OODA Observe  - 状況スナップショット
  [3] 🧭 OODA Orient   - シグナル検出
  [4] 🎯 OODA Decide   - 推奨アクション
  [5] 📊 Sprint Review - スプリントレビューを実施
  [6] ⚡ WIP 状態を確認
```

**EVALUATE フェーズ（振り返り）**
```
利用可能なアクション:
  [1] 🔄 Retro         - レトロスペクティブを実施（reflect + KPT）
  [2] 🪞 Reflect       - 構造化振り返りを記録
```

**LEARN フェーズ（知識蓄積）**
```
利用可能なアクション:
  [1] 📚 Knowledge Update - 知識ベースに学びを記録
  [2] 📊 Knowledge Query  - 知識ベースを検索
```

### Step 3: ユーザーの選択を待つ

ユーザーに番号またはアクション名で選択を促す。

### Step 4: 選択されたアクションを実行

選択に応じて、対応する Piece（`pieces/*.yaml`）の Movement を順に実行する。

各 Movement の実行ルール:
1. **persona** で指定されたエージェントの役割で行動する
2. **allowed_tools** に含まれるツールのみ使用する
3. **instructions** に従ってステップを実行する
4. **on_failure: halt** の場合、失敗時はパイプラインを停止する
5. **aggregate.parallel_with** がある場合、並列実行して結果を集約する
6. **aggregate.loop_until** がある場合、条件を満たすまで繰り返す

### Step 5: 完了後の遷移

セレモニー完了後、再び Step 1 に戻り、次のアクションを提示する。
ユーザーが終了を選ぶまで対話を続ける。

## Piece 定義ファイル

セレモニーの構造は `pieces/` ディレクトリの YAML ファイルで定義されている:

| ファイル | セレモニー | Movement 数 |
|---------|-----------|:-----------:|
| `pieces/refinement.yaml` | Refinement | 5 |
| `pieces/planning.yaml` | Planning | 5 |
| `pieces/sprint.yaml` | Sprint | 4 |
| `pieces/review.yaml` | Review | 5 |
| `pieces/retro.yaml` | Retro | 5 |
| `pieces/pipeline.yaml` | Pipeline (合成) | 全セレモニー |

### Movement の読み方

```yaml
- name: movement-name        # ステップ名
  persona: agent-role         # 実行するエージェントの役割
  edit: true/false            # ファイル編集の許可
  allowed_tools: [...]        # このステップで使用可能なツール
  instructions: |             # 実行手順
    ...
  on_failure: halt            # 失敗時の挙動
  success_criteria:           # 成功条件
    - ...
  aggregate:                  # 集約ルール（並列レビュー等）
    parallel_with: other-movement
    condition: all("approved")
```

## 参加エージェント
- **全エージェント**: Piece 定義の persona に従う
