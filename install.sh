#!/usr/bin/env bash
set -euo pipefail

# ============================================================
#  Scrum Team Agents - インストール / アップデートスクリプト
# ============================================================
#
#  使い方:
#    ./install.sh /path/to/target-project          # インストール
#    ./install.sh /path/to/target-project --build   # ビルド+テスト後にインストール
#    ./install.sh --build-only                      # ビルド+テストのみ（コピーしない）
#
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRUM_MCP_DIR="$SCRIPT_DIR/scrum-mcp"
VERSION=$(node -e "console.log(require('$SCRUM_MCP_DIR/package.json').version)" 2>/dev/null || echo "unknown")

# --- 色定義 ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $*"; exit 1; }

# --- 引数パース ---
TARGET=""
DO_BUILD=false
BUILD_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --build)      DO_BUILD=true ;;
    --build-only) BUILD_ONLY=true; DO_BUILD=true ;;
    --help|-h)
      echo "Usage: $0 [TARGET_DIR] [--build] [--build-only]"
      echo ""
      echo "Options:"
      echo "  TARGET_DIR   インストール先のプロジェクトディレクトリ"
      echo "  --build      インストール前にビルド+テストを実行"
      echo "  --build-only ビルド+テストのみ実行（コピーしない）"
      echo "  --help       このヘルプを表示"
      exit 0
      ;;
    -*)
      error "不明なオプション: $arg (--help でヘルプを表示)"
      ;;
    *)
      if [ -z "$TARGET" ]; then
        TARGET="$arg"
      else
        error "ターゲットディレクトリは1つだけ指定してください"
      fi
      ;;
  esac
done

if [ "$BUILD_ONLY" = false ] && [ -z "$TARGET" ]; then
  error "ターゲットディレクトリを指定してください\n  使い方: $0 /path/to/target-project [--build]"
fi

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  Scrum Team Agents v${VERSION}${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ============================================================
#  Step 1: ビルド + テスト（--build / --build-only 時のみ）
# ============================================================

if [ "$DO_BUILD" = true ]; then
  info "ビルド+テスト実行中..."

  # npm install
  if [ ! -d "$SCRUM_MCP_DIR/node_modules" ]; then
    info "依存関係をインストール中..."
    (cd "$SCRUM_MCP_DIR" && npm install --silent)
    success "npm install 完了"
  fi

  # build
  info "TypeScript ビルド中..."
  (cd "$SCRUM_MCP_DIR" && npm run build --silent)
  success "ビルド完了"

  # test
  info "テスト実行中..."
  TEST_OUTPUT=$(cd "$SCRUM_MCP_DIR" && npm test 2>&1) || {
    echo "$TEST_OUTPUT"
    error "テスト失敗。修正後に再実行してください"
  }

  # テスト結果からサマリーを抽出
  TEST_SUMMARY=$(echo "$TEST_OUTPUT" | grep -E "Tests|Test Files" | tail -2)
  success "テスト完了"
  echo "       $TEST_SUMMARY"
  echo ""

  if [ "$BUILD_ONLY" = true ]; then
    success "ビルド+テスト完了（--build-only モード）"
    exit 0
  fi
fi

# ============================================================
#  Step 2: ターゲットディレクトリの検証
# ============================================================

TARGET=$(cd "$TARGET" 2>/dev/null && pwd) || error "ディレクトリが存在しません: $TARGET"

if [ "$TARGET" = "$SCRIPT_DIR" ]; then
  error "ソースディレクトリと同じディレクトリにはインストールできません"
fi

info "インストール先: $TARGET"

# dist/ の存在チェック
if [ ! -d "$SCRUM_MCP_DIR/dist" ]; then
  error "dist/ が見つかりません。--build オプションを付けるか、先に npm run build を実行してください"
fi

# ============================================================
#  Step 3: ファイルコピー
# ============================================================

info "ファイルをコピー中..."

# --- scrum-mcp/ (サーバー本体) ---
mkdir -p "$TARGET/scrum-mcp"
# dist/ (ビルド済み)
cp -r "$SCRUM_MCP_DIR/dist/" "$TARGET/scrum-mcp/dist/"
# src/ (ソース参照用)
cp -r "$SCRUM_MCP_DIR/src/" "$TARGET/scrum-mcp/src/"
# 設定ファイル
cp "$SCRUM_MCP_DIR/package.json" "$TARGET/scrum-mcp/"
cp "$SCRUM_MCP_DIR/package-lock.json" "$TARGET/scrum-mcp/" 2>/dev/null || true
cp "$SCRUM_MCP_DIR/tsconfig.json" "$TARGET/scrum-mcp/"
cp "$SCRUM_MCP_DIR/vitest.config.ts" "$TARGET/scrum-mcp/" 2>/dev/null || true
success "scrum-mcp/ コピー完了"

# --- .claude/agents/ ---
mkdir -p "$TARGET/.claude/agents"
cp "$SCRIPT_DIR/.claude/agents/"*.md "$TARGET/.claude/agents/"
success ".claude/agents/ コピー完了 ($(ls "$SCRIPT_DIR/.claude/agents/"*.md | wc -l) files)"

# --- .claude/commands/ ---
mkdir -p "$TARGET/.claude/commands"
cp "$SCRIPT_DIR/.claude/commands/"*.md "$TARGET/.claude/commands/"
success ".claude/commands/ コピー完了 ($(ls "$SCRIPT_DIR/.claude/commands/"*.md | wc -l) files)"

# --- pieces/ ---
mkdir -p "$TARGET/pieces"
cp "$SCRIPT_DIR/pieces/"*.yaml "$TARGET/pieces/"
success "pieces/ コピー完了 ($(ls "$SCRIPT_DIR/pieces/"*.yaml | wc -l) files)"

# --- .scrum/ ディレクトリ初期化 ---
mkdir -p "$TARGET/.scrum"
success ".scrum/ ディレクトリ確認"

# ============================================================
#  Step 4: .claude/settings.json のマージ
# ============================================================

SETTINGS_FILE="$TARGET/.claude/settings.json"
SCRUM_MCP_CONFIG='{
  "command": "node",
  "args": ["scrum-mcp/dist/index.js"],
  "env": {
    "SCRUM_STATE_FILE": ".scrum/state.json"
  }
}'

if [ -f "$SETTINGS_FILE" ]; then
  # 既存 settings.json がある場合 → マージ

  # scrum-mcp が既に設定済みかチェック
  if grep -q '"scrum-mcp"' "$SETTINGS_FILE" 2>/dev/null; then
    success "settings.json: scrum-mcp 設定は既に存在（スキップ）"
  else
    # node で JSON マージ（jq がない環境でも動作）
    node -e "
      const fs = require('fs');
      const settings = JSON.parse(fs.readFileSync('$SETTINGS_FILE', 'utf8'));
      settings.env = settings.env || {};
      settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';
      settings.mcpServers = settings.mcpServers || {};
      settings.mcpServers['scrum-mcp'] = $SCRUM_MCP_CONFIG;
      fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(settings, null, 2) + '\n');
    " || error "settings.json のマージに失敗しました"
    success "settings.json: scrum-mcp 設定を追加"
  fi

  # AGENT_TEAMS env が設定済みかチェック
  if ! grep -q 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS' "$SETTINGS_FILE" 2>/dev/null; then
    node -e "
      const fs = require('fs');
      const settings = JSON.parse(fs.readFileSync('$SETTINGS_FILE', 'utf8'));
      settings.env = settings.env || {};
      settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';
      fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(settings, null, 2) + '\n');
    "
    success "settings.json: AGENT_TEAMS 環境変数を追加"
  fi
else
  # 新規作成
  mkdir -p "$TARGET/.claude"
  cp "$SCRIPT_DIR/.claude/settings.json" "$SETTINGS_FILE"
  success "settings.json: 新規作成"
fi

# ============================================================
#  Step 5: .gitignore 追記
# ============================================================

GITIGNORE="$TARGET/.gitignore"
SCRUM_IGNORES=(
  ".scrum/state.json"
  ".scrum/reports/"
  ".scrum/audit.jsonl"
  ".scrum/dashboard.md"
)

if [ -f "$GITIGNORE" ]; then
  ADDED=0
  for pattern in "${SCRUM_IGNORES[@]}"; do
    if ! grep -qF "$pattern" "$GITIGNORE" 2>/dev/null; then
      echo "$pattern" >> "$GITIGNORE"
      ADDED=$((ADDED + 1))
    fi
  done
  if [ "$ADDED" -gt 0 ]; then
    success ".gitignore: ${ADDED} パターン追加"
  else
    success ".gitignore: 既に設定済み（スキップ）"
  fi
else
  warn ".gitignore が見つかりません（手動で .scrum/ 関連を追加してください）"
fi

# ============================================================
#  Step 6: node_modules インストール（ターゲット側）
# ============================================================

if [ ! -d "$TARGET/scrum-mcp/node_modules" ]; then
  info "ターゲットの依存関係をインストール中..."
  (cd "$TARGET/scrum-mcp" && npm install --production --silent 2>/dev/null) || {
    warn "npm install に失敗しました。手動で実行してください: cd $TARGET/scrum-mcp && npm install"
  }
  success "依存関係インストール完了"
else
  success "node_modules/ 既に存在（スキップ）"
fi

# ============================================================
#  完了サマリー
# ============================================================

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  インストール完了${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  インストール先: $TARGET"
echo "  バージョン:     v${VERSION}"
echo ""
echo "  使い方:"
echo "    cd $TARGET"
echo "    claude                    # Claude Code を起動"
echo "    /status                   # 状態確認"
echo "    /scrum                    # インタラクティブモード"
echo "    /pipeline 3               # 3スプリント連続実行"
echo ""
