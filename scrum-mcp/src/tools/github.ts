import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { StateStore } from "../state/store.js";
import type { GithubSyncInput, ToolResult, TaskState } from "../types.js";
import { GITHUB_LABELS } from "../types.js";

const execFileAsync = promisify(execFile);

const labelCache = new Set<string>();

function extractIssueNumber(output: string): number | null {
  const match = output.match(/\/issues\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

async function ensureLabels(repo: string): Promise<void> {
  if (labelCache.has(repo)) return;

  for (const [, label] of Object.entries(GITHUB_LABELS)) {
    try {
      await execFileAsync("gh", [
        "label",
        "create",
        label.name,
        "--color",
        label.color,
        "--repo",
        repo,
        "--force",
      ]);
    } catch {
      // label may already exist
    }
  }

  labelCache.add(repo);
}

export async function githubSync(
  store: StateStore,
  input: GithubSyncInput
): Promise<ToolResult> {
  const s = store.peek();

  if (!s.config.githubRepo) {
    return {
      ok: false,
      error: "GitHub リポジトリが設定されていません。config.githubRepo を設定してください。",
    };
  }

  const task = s.tasks[input.taskId];
  if (!task) {
    return {
      ok: false,
      error: `タスク「${input.taskId}」が見つかりません。`,
    };
  }

  const repo = s.config.githubRepo;

  try {
    switch (input.action) {
      case "create": {
        await ensureLabels(repo);

        const label = GITHUB_LABELS[task.state];
        const body = [
          task.description,
          "",
          "## 受入条件",
          ...task.acceptanceCriteria.map((c) => `- [ ] ${c}`),
        ].join("\n");

        const { stdout } = await execFileAsync("gh", [
          "issue",
          "create",
          "--title",
          task.title,
          "--body",
          body,
          "--label",
          label.name,
          "--repo",
          repo,
        ]);

        const issueNumber = extractIssueNumber(stdout);
        if (issueNumber === null) {
          return {
            ok: false,
            error: "Issue 番号の抽出に失敗しました。",
          };
        }

        await store.update((s) => {
          s.tasks[input.taskId].githubIssueNumber = issueNumber;
          s.tasks[input.taskId].updatedAt = new Date().toISOString();
        });

        return {
          ok: true,
          message: `Issue #${issueNumber} を作成しました。`,
          data: { issueNumber },
        };
      }

      case "update": {
        if (!task.githubIssueNumber) {
          return {
            ok: false,
            error: "GitHub Issue が紐づいていません。先に create してください。",
          };
        }

        // 他の状態ラベルを一括除去
        const otherLabels = (Object.keys(GITHUB_LABELS) as TaskState[])
          .filter((state) => state !== task.state)
          .map((state) => GITHUB_LABELS[state].name)
          .join(",");

        if (otherLabels) {
          try {
            await execFileAsync("gh", [
              "issue",
              "edit",
              String(task.githubIssueNumber),
              "--remove-label",
              otherLabels,
              "--repo",
              repo,
            ]);
          } catch {
            // labels may not be on the issue
          }
        }

        // 現在のラベルを付与
        const currentLabel = GITHUB_LABELS[task.state];
        await execFileAsync("gh", [
          "issue",
          "edit",
          String(task.githubIssueNumber),
          "--add-label",
          currentLabel.name,
          "--repo",
          repo,
        ]);

        return {
          ok: true,
          message: `Issue #${task.githubIssueNumber} のラベルを「${currentLabel.name}」に更新しました。`,
        };
      }

      case "close": {
        if (!task.githubIssueNumber) {
          return {
            ok: false,
            error: "GitHub Issue が紐づいていません。",
          };
        }

        await execFileAsync("gh", [
          "issue",
          "close",
          String(task.githubIssueNumber),
          "--repo",
          repo,
        ]);

        return {
          ok: true,
          message: `Issue #${task.githubIssueNumber} をクローズしました。`,
        };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `GitHub 操作に失敗しました: ${message}`,
    };
  }
}
