/**
 * Intent Classifier — Classifies the user's intent from the input.
 *
 * Combines BM25 lexical relevance with keywords to classify
 * the intent into one of the categories: mutation, query, workflow, analysis, etc.
 *
 * Consumido por: hooks.ts (experimental.chat.system.transform)
 * Dependencies: embeddings.ts, categories.ts
 */

import { rankSimilarity } from "./embeddings.js"
import {
  CATEGORY_KEYWORDS,
  getToolsByCategory,
  type IntentCategory,
} from "./categories.js"

export interface IntentResult {
  category: IntentCategory
  confidence: number
  /** Top-3 categorias com scores */
  topCategories: Array<{ category: IntentCategory; score: number }>
}

/**
 * Pre-computed embeddings for category descriptions.
 * Each category has a representative description.
 */
const CATEGORY_DESCRIPTIONS: Record<IntentCategory, string> = {
  mutation: "Create, add, update, or remove nodes and relationships in the knowledge graph",
  query: "Search, query, list, inspect, or retrieve information from the knowledge graph",
  workflow: "Manage changes, approvals, enforcement, lifecycle of specifications",
  analysis: "Analyze impact, validate, detect drift, check integrity of the specification",
  quality: "Code quality metrics, complexity, smells, dependencies, dead code detection",
  enterprise: "Enterprise workflows: migrations, experiments, feature flags, security, compliance",
  admin: "Administration: permissions, roles, sync, snapshots, cache, configuration",
  discovery: "Discover requirements, analyze briefings, ask questions, elicit specifications",
  implementation: "Generate code, plan implementation, create files from specification",
  info: "Get status, history, help, general information about the project",
}

/**
 * Calcula score de keywords para cada categoria.
 */
function keywordScore(text: string): Record<IntentCategory, number> {
  const normalized = text.toLowerCase()
  const scores: Record<IntentCategory, number> = {} as any

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [IntentCategory, string[]][]) {
    let score = 0
    for (const keyword of keywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        score += 1
      }
    }
    scores[category] = score
  }

  return scores
}

/**
 * Calcula score lexical para cada categoria.
 */
function lexicalScore(text: string): Record<IntentCategory, number> {
  const options = Object.entries(CATEGORY_DESCRIPTIONS).map(([category, description]) => ({
    label: category,
    text: description,
  }))

  const ranked = rankSimilarity(text, options)

  const scores: Record<IntentCategory, number> = {} as any
  for (const r of ranked) {
    scores[r.label as IntentCategory] = r.score
  }

  return scores
}

/**
 * Combines keyword score and lexical relevance with weights.
 * Keywords: 0.4, lexical relevance: 0.6
 */
function combinedScore(text: string): Record<IntentCategory, number> {
  const kw = keywordScore(text)
  const lexical = lexicalScore(text)

  const combined: Record<IntentCategory, number> = {} as any
  for (const category of Object.keys(kw) as IntentCategory[]) {
    combined[category] = (kw[category] * 0.4) + ((lexical[category] || 0) * 0.6)
  }

  return combined
}

/**
 * Classifies the user's intent.
 *
 * @param text - User input
 * @returns IntentResult com categoria, confidence e top-3
 */
export function classifyIntent(text: string): IntentResult {
  const scores = combinedScore(text)

  // Ordenar por score decrescente
  const sorted = Object.entries(scores)
    .map(([category, score]) => ({ category: category as IntentCategory, score }))
    .sort((a, b) => b.score - a.score)

  const top = sorted[0]
  const totalScore = sorted.reduce((sum, s) => sum + Math.max(0, s.score), 0)
  const confidence = totalScore > 0 ? top.score / totalScore : 0

  return {
    category: top.category,
    confidence: Math.min(1, Math.max(0, confidence)),
    topCategories: sorted.slice(0, 3),
  }
}

/**
 * Gets the tools relevant to an intent, combined with the state gate.
 *
 * @param intent - Classification result
 * @param stateTools - Tools visible to the state gate (null = all)
 * @returns Lista de tools relevantes
 */
export function getToolsForIntent(
  intent: IntentResult,
  stateTools: Set<string> | null,
): string[] {
  const categoryTools = getToolsByCategory(intent.category)

  if (!stateTools) return categoryTools

  // Intersection: category tools ∩ state-visible tools
  return categoryTools.filter(t => stateTools.has(t))
}
