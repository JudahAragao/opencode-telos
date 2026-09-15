/**
 * Router Module — Barrel export.
 *
 * Exporta todas as funções públicas do módulo router.
 * Consumido por: hooks.ts
 */

// State Gate
export {
  getRecommendedTools,
  getVisibleTools,
  formatVisibleTools,
  ESCAPE_HATCH_INSTRUCTION,
  ENFORCEMENT_ORDER_INSTRUCTION,
} from "./state-gate.js"

// Graph State Snapshot
export { getGraphSnapshot, invalidateSnapshotCache, formatGraphState } from "./graph-state-snapshot.js"
export type { GraphSnapshot, GraphState } from "./graph-state-snapshot.js"

// Intent Classifier
export { classifyIntent, getToolsForIntent } from "./intent-classifier.js"
export type { IntentResult } from "./intent-classifier.js"

// Tool Registry
export { getToolsForSession, getToolDescription, listAllTools, ALL_TOOL_NAMES } from "./tool-registry.js"
export type { ToolRegistryResult } from "./tool-registry.js"

// Relevância lexical (BM25)
export { rankSimilarity } from "./embeddings.js"

// Categories
export {
  getToolCategories,
  hasToolCategory,
  getToolsByCategory,
  getCategoriesInToolSet,
  CATEGORY_KEYWORDS,
  STANDALONE_CATEGORIES,
  COMPOSITE_CATEGORIES,
} from "./categories.js"
export type { IntentCategory } from "./categories.js"

// Tool Taxonomy
export {
  TOOL_TAXONOMY,
  STANDALONE_TOOLS,
  DEPRECATED_TOOLS,
  TOOL_TO_COMPOSITE,
  isDeprecatedTool,
  getCompositeForTool,
  countActiveTools,
} from "./tool-taxonomy.js"
export type { CompositeTool, SubAction, ToolCategory } from "./tool-taxonomy.js"
