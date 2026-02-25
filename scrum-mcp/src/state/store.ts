import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ScrumState } from "../types.js";
import { DEFAULT_STATE, ceremonyStateToPhase } from "../types.js";

export class StateStore {
  private state: ScrumState;
  private filePath: string;
  private dirty: boolean = false;

  private constructor(filePath: string, state: ScrumState) {
    this.filePath = filePath;
    this.state = state;
  }

  static async init(filePath: string): Promise<StateStore> {
    let state: ScrumState;
    try {
      const data = await readFile(filePath, "utf-8");
      state = JSON.parse(data) as ScrumState;
      // Migration: 新フィールドのデフォルト値
      if (!state.archivedTasks) state.archivedTasks = {};
      // Migration: Phase system (v0.4)
      if (!state.phase) {
        state.phase = ceremonyStateToPhase(state.ceremonyState);
        state.phaseEnteredAt = new Date().toISOString();
      }
      if (!state.oodaCycles) state.oodaCycles = [];
      if (!state.reflections) state.reflections = [];
      if (!state.knowledge) state.knowledge = [];
    } catch (err) {
      // ファイルが存在するが読み込めない場合（破損）→ バックアップ作成
      if (err instanceof SyntaxError) {
        const backupPath = `${filePath}.corrupt.${Date.now()}`;
        try {
          const raw = await readFile(filePath, "utf-8");
          await writeFile(backupPath, raw, "utf-8");
          console.error(`[scrum-mcp] 状態ファイル破損を検出。バックアップ: ${backupPath}`);
        } catch {
          // バックアップ自体が失敗しても初期化は続行
        }
      }
      state = structuredClone(DEFAULT_STATE);
    }
    return new StateStore(filePath, state);
  }

  getState(): Readonly<ScrumState> {
    return JSON.parse(JSON.stringify(this.state)) as ScrumState;
  }

  peek(): Readonly<ScrumState> {
    return this.state;
  }

  async update(updater: (state: ScrumState) => ScrumState | void): Promise<ScrumState> {
    const result = updater(this.state);
    if (result !== undefined) {
      this.state = result;
    }
    this.dirty = true;
    await this.save();
    return this.getState();
  }

  async reset(): Promise<void> {
    this.state = structuredClone(DEFAULT_STATE);
    this.dirty = true;
    await this.save();
  }

  private async save(): Promise<void> {
    if (!this.dirty) return;

    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });

    const tmpPath = `${this.filePath}.tmp.${process.pid}`;
    const data = JSON.stringify(this.state, null, 2);

    await writeFile(tmpPath, data, "utf-8");
    await rename(tmpPath, this.filePath);
    this.dirty = false;
  }
}
