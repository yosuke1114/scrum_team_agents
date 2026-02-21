# Scrum インタラクティブモード

スプリントサイクルの対話的なナビゲーターです。
現在の状態に応じて利用可能なアクションを表示し、選択に基づいてセレモニーを実行します。

## 実行フロー

### Step 1: 現在の状態を取得

`project_status` を実行し、以下を表示する:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Scrum Team - インタラクティブモード
━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 現在の状態: {ceremonyState}
🏃 スプリント: {sprint情報 or "なし"}
📦 バックログ: BACKLOG {n} 件 / READY {n} 件
⚡ WIP: IN_PROGRESS {n}/{limit} | IN_REVIEW {n}/{limit}
```

### Step 2: 利用可能なアクションを提示

ceremonyState に基づいて、次に実行可能なアクションを表示する:

**IDLE（初期状態）**
```
利用可能なアクション:
  [1] 🔍 Refinement  - バックログの整理と READY 判定
  [2] 📋 Planning    - スプリント計画の策定（READY タスクがある場合）
  [3] 🔄 Pipeline    - 全セレモニーを一気通貫で実行
```

**PLANNING（プランニング完了後）**
```
利用可能なアクション:
  [1] 🚀 Sprint Start - スプリントを開始
```

**SPRINT_ACTIVE（スプリント実行中）**
```
利用可能なアクション:
  [1] 📝 タスクの実装を続ける
  [2] 📊 Sprint Review - スプリントレビューを実施
  [3] ⚡ WIP 状態を確認
  [4] 🚫 ブロッカーを確認
```

**SPRINT_REVIEW（レビュー完了後）**
```
利用可能なアクション:
  [1] 🔄 Retro - レトロスペクティブを実施
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
