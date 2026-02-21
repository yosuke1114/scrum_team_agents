import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StateStore } from "../state/store.js";
import type { ToolResult, CeremonyType } from "../types.js";

export type ReportType = CeremonyType | "pipeline";

export interface CeremonyReportInput {
  type: ReportType;
  content: string;
}

export async function ceremonyReport(
  store: StateStore,
  input: CeremonyReportInput
): Promise<ToolResult> {
  const s = store.peek();

  const sprintId = s.currentSprint?.id ?? "pre-sprint";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `${sprintId}-${input.type}-${timestamp}.md`;

  const stateFile = process.env.SCRUM_STATE_FILE ?? ".scrum/state.json";
  const baseDir = dirname(stateFile);
  const reportDir = join(baseDir, "reports");

  await mkdir(reportDir, { recursive: true });

  const header = [
    `# ${input.type.charAt(0).toUpperCase() + input.type.slice(1)} Report`,
    "",
    `- **Sprint**: ${sprintId}`,
    `- **Date**: ${new Date().toISOString()}`,
    `- **Ceremony State**: ${s.ceremonyState}`,
    "",
    "---",
    "",
  ].join("\n");

  const fullContent = header + input.content;
  const filePath = join(reportDir, fileName);

  await writeFile(filePath, fullContent, "utf-8");

  return {
    ok: true,
    message: `レポートを保存しました: ${filePath}`,
    data: { filePath, fileName },
  };
}
