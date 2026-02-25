import { randomUUID } from "node:crypto";
import type { StateStore } from "../state/store.js";
import type {
  ToolResult,
  Reflection,
  ReflectionTrigger,
  KnowledgeEntry,
  KnowledgeCategory,
} from "../types.js";
import { setPhase } from "./phase.js";

// --- reflect ---

export interface ReflectInput {
  trigger: ReflectionTrigger;
  what: string;
  why: string;
  action: string;
}

export async function reflect(
  store: StateStore,
  input: ReflectInput
): Promise<ToolResult<Reflection>> {
  const s = store.peek();
  const sprintId = s.currentSprint?.id ?? s.sprints[s.sprints.length - 1]?.id ?? "none";

  const reflection: Reflection = {
    id: `ref-${randomUUID().slice(0, 8)}`,
    sprintId,
    trigger: input.trigger,
    what: input.what,
    why: input.why,
    action: input.action,
    effectiveness: null,
    createdAt: new Date().toISOString(),
  };

  await store.update((s) => {
    s.reflections.push(reflection);
    // Keep max 50 reflections
    if (s.reflections.length > 50) {
      s.reflections = s.reflections.slice(-50);
    }
    // Auto-transition: EVALUATE→LEARN or LEARN→PLAN
    if (s.phase === "EVALUATE") {
      setPhase(s, "LEARN");
    } else if (s.phase === "LEARN") {
      setPhase(s, "PLAN");
    }
  });

  // Check for similar past reflections (pattern detection)
  const similar = s.reflections.filter(
    (r) => r.trigger === input.trigger && r.id !== reflection.id
  );

  const lines = [
    `🪞 振り返り記録: ${reflection.id}`,
    `  トリガー: ${input.trigger}`,
    `  何が: ${input.what}`,
    `  なぜ: ${input.why}`,
    `  次に: ${input.action}`,
    similar.length > 0 ? `  ⚠️ 同種の振り返りが過去 ${similar.length} 件あります` : "",
  ].filter(Boolean);

  return { ok: true, message: lines.join("\n"), data: reflection };
}

// --- reflect_evaluate ---

export interface ReflectEvaluateInput {
  reflectionId: string;
  effectiveness: "effective" | "ineffective";
}

export async function reflectEvaluate(
  store: StateStore,
  input: ReflectEvaluateInput
): Promise<ToolResult> {
  const s = store.peek();
  const ref = s.reflections.find((r) => r.id === input.reflectionId);
  if (!ref) {
    return { ok: false, error: `振り返り「${input.reflectionId}」が見つかりません。` };
  }

  await store.update((s) => {
    const r = s.reflections.find((r) => r.id === input.reflectionId);
    if (r) r.effectiveness = input.effectiveness;
  });

  return {
    ok: true,
    message: `振り返り「${input.reflectionId}」を ${input.effectiveness} と評価しました。`,
  };
}

// --- knowledge_update ---

export interface KnowledgeUpdateInput {
  category: KnowledgeCategory;
  insight: string;
}

export async function knowledgeUpdate(
  store: StateStore,
  input: KnowledgeUpdateInput
): Promise<ToolResult<KnowledgeEntry>> {
  const s = store.peek();
  const sprintId = s.currentSprint?.id ?? s.sprints[s.sprints.length - 1]?.id ?? "none";

  // Check for existing similar entry (simple keyword match)
  const existing = s.knowledge.find(
    (k) => k.category === input.category && k.insight === input.insight
  );

  if (existing) {
    const newConfidence = Math.min(1, existing.confidence + 0.1);
    await store.update((s) => {
      const k = s.knowledge.find((k) => k.id === existing.id);
      if (k) {
        k.confidence = newConfidence;
        if (!k.sourceSprintIds.includes(sprintId)) {
          k.sourceSprintIds.push(sprintId);
        }
        k.updatedAt = new Date().toISOString();
      }
    });
    return {
      ok: true,
      message: `知識を強化: ${existing.id} (信頼度: ${newConfidence.toFixed(1)})`,
      data: { ...existing },
    };
  }

  const entry: KnowledgeEntry = {
    id: `know-${randomUUID().slice(0, 8)}`,
    category: input.category,
    insight: input.insight,
    sourceSprintIds: [sprintId],
    confidence: 0.5,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await store.update((s) => {
    s.knowledge.push(entry);
    // Keep max 100 entries
    if (s.knowledge.length > 100) {
      // Remove lowest confidence first
      s.knowledge.sort((a, b) => b.confidence - a.confidence);
      s.knowledge = s.knowledge.slice(0, 100);
    }
    // Auto-transition: LEARN→PLAN
    if (s.phase === "LEARN") {
      setPhase(s, "PLAN");
    }
  });

  return {
    ok: true,
    message: `知識を記録: ${entry.id} [${input.category}] ${input.insight}`,
    data: entry,
  };
}

// --- knowledge_query ---

export interface KnowledgeQueryInput {
  query?: string;
  category?: KnowledgeCategory;
}

export async function knowledgeQuery(
  store: StateStore,
  input: KnowledgeQueryInput
): Promise<ToolResult<KnowledgeEntry[]>> {
  const s = store.peek();
  let results = [...s.knowledge];

  if (input.category) {
    results = results.filter((k) => k.category === input.category);
  }
  if (input.query) {
    const q = input.query.toLowerCase();
    results = results.filter((k) => k.insight.toLowerCase().includes(q));
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence);

  const lines = results.length > 0
    ? [
        `📚 知識ベース: ${results.length} 件`,
        ...results.map((k) =>
          `  [${k.category}] (信頼度:${k.confidence.toFixed(1)}) ${k.insight}`
        ),
      ]
    : ["📚 該当する知識はありません。"];

  return { ok: true, message: lines.join("\n"), data: results };
}
