/**
 * Router Module — Barrel export.
 *
 * Exporta todas as funções públicas do módulo router.
 * Consumido por: hooks.ts
 */
// State Gate
export { getVisibleTools, formatVisibleTools, ESCAPE_HATCH_INSTRUCTION } from "./state-gate.js";
// Graph State Snapshot
export { getGraphSnapshot, invalidateSnapshotCache, formatGraphState } from "./graph-state-snapshot.js";
// Intent Classifier
export { classifyIntent, getToolsForIntent } from "./intent-classifier.js";
// Tool Registry
export { getToolsForSession, getToolDescription, listAllTools } from "./tool-registry.js";
// Semantic Nudge
export { calculateSemanticNudge, formatNudgeInput, isToolSuggested, getTopSuggestion } from "./semantic-nudge.js";
// Embeddings
export { cosineSimilarity, getEmbedding, getLexicalVector, rankSimilarity } from "./embeddings.js";
// Categories
export { getToolCategories, getToolsByCategory, getCategoriesInToolSet, CATEGORY_KEYWORDS } from "./categories.js";
// Tool Taxonomy
export { TOOL_TAXONOMY, STANDALONE_TOOLS, DEPRECATED_TOOLS, TOOL_TO_COMPOSITE, isDeprecatedTool, getCompositeForTool, countActiveTools, } from "./tool-taxonomy.js";
