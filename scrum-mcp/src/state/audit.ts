import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface AuditEntry {
  ts: string;
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  error?: string;
  persona?: string;
}

export class AuditLog {
  private filePath: string;

  constructor(stateFile: string) {
    const baseDir = dirname(stateFile);
    this.filePath = join(baseDir, "audit.jsonl");
  }

  async log(entry: AuditEntry): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      const line = JSON.stringify(entry) + "\n";
      await appendFile(this.filePath, line, "utf-8");
    } catch {
      // audit logging should never break the main flow
    }
  }

  getFilePath(): string {
    return this.filePath;
  }
}
