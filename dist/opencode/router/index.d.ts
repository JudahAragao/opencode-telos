/**
 * Router Module — Barrel export.
 *
 * Exporta todas as funções públicas do módulo router.
 * Consumido por: hooks.ts
 */
export { getVisibleTools, formatVisibleTools, ESCAPE_HATCH_INSTRUCTION, ENFORCEMENT_ORDER_INSTRUCTION, } from "./state-gate.js";
export { getGraphSnapshot, invalidateSnapshotCache, formatGraphState } from "./graph-state-snapshot.js";
export type { GraphSnapshot, GraphState } from "./graph-state-snapshot.js";
export { classifyIntent, getToolsForIntent } from "./intent-classifier.js";
export type { IntentResult } from "./intent-classifier.js";
export { getToolsForSession, getToolDescription, listAllTools } from "./tool-registry.js";
export type { ToolRegistryResult } from "./tool-registry.js";
export { rankSimilarity } from "./embeddings.js";
export { getToolCategories, getToolsByCategory, getCategoriesInToolSet, CATEGORY_KEYWORDS } from "./categories.js";
export type { IntentCategory } from "./categories.js";
export { TOOL_TAXONOMY, STANDALONE_TOOLS, DEPRECATED_TOOLS, TOOL_TO_COMPOSITE, isDeprecatedTool, getCompositeForTool, countActiveTools, } from "./tool-taxonomy.js";
export type { CompositeTool, SubAction, ToolCategory } from "./tool-taxonomy.js";
