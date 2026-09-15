/**
 * Semantic Nudge — Sugestões locais por relevância lexical determinística.
 *
 * Calcula relevância BM25 entre o input do usuário e as tool descriptions.
 * Injeta hints no input do LLM com as tools mais relevantes.
 *
 * Consumido por: hooks.ts (chat.message hook)
 * Dependências: embeddings.ts, tool-embeddings.ts, categories.ts
 */

import { rankSimilarity } from "./embeddings.js"
import { getCachedToolEmbeddings } from "./tool-embeddings.js"

export interface NudgeResult {
  /** Hints formatados para injetar no input */
  hints: string[]
  /** Tools sugeridas com confidence */
  suggestions: Array<{ tool: string; confidence: number }>
}

/**
 * Relevância relativa mínima para sugerir uma tool, medida contra o melhor
 * match da consulta (0..1). O score bruto do BM25 é ilimitado, então comparar
 * contra um limiar absoluto não tinha significado.
 */
const MIN_RELATIVE_RELEVANCE = 0.5

/** Máximo de sugestões */
const MAX_SUGGESTIONS = 3

/**
 * Calcula nudges semânticos para o input do usuário.
 *
 * @param userInput - Texto do input do usuário
 * @returns NudgeResult com hints e sugestões
 */
export function calculateSemanticNudge(userInput: string): NudgeResult {
  const query = userInput.trim()
  if (query.length === 0) return { hints: [], suggestions: [] }

  const toolEmbeddings = getCachedToolEmbeddings()
  const topLevelTools = toolEmbeddings.filter((tool) => !tool.name.includes(":"))
  const ranked = rankSimilarity(query, topLevelTools.map((tool) => ({
    label: tool.name,
    text: `${tool.name} ${tool.description}`,
  })))
  if (ranked.length === 0) return { hints: [], suggestions: [] }

  // Normaliza o BM25 contra o melhor match para obter uma confiança 0..1
  // comparável entre consultas (antes era reportado como "350% de confiança").
  const bestScore = ranked.reduce((max, item) => (item.score > max ? item.score : max), 0)
  if (bestScore <= 0) return { hints: [], suggestions: [] }

  const byName = new Map(topLevelTools.map((tool) => [tool.name, tool]))
  const topScores = ranked
    .filter((item) => item.score > 0)
    .map((item) => ({ tool: byName.get(item.label), confidence: item.score / bestScore }))
    .filter((item): item is { tool: NonNullable<typeof item.tool>; confidence: number } =>
      item.tool !== undefined && item.confidence >= MIN_RELATIVE_RELEVANCE,
    )
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_SUGGESTIONS)

  // Gerar hints
  const hints: string[] = []
  const suggestions: Array<{ tool: string; confidence: number }> = []

  if (topScores.length > 0) {
    hints.push("[SDD Tools Sugeridas]")
    for (const { tool, confidence } of topScores) {
      const confidencePct = Math.round(confidence * 100)
      hints.push(`- ${tool.name} (${confidencePct}%): ${tool.description}`)
      suggestions.push({ tool: tool.name, confidence })
    }
  }

  return { hints, suggestions }
}

/**
 * Gera a string de nudge para injetar no input do LLM.
 * Retorna string vazia se não houver nudges relevantes.
 */
export function formatNudgeInput(userInput: string): string {
  const result = calculateSemanticNudge(userInput)
  if (result.hints.length === 0) return ""
  return result.hints.join("\n")
}

/**
 * Verifica se uma tool específica é sugerida pelo nudge.
 */
export function isToolSuggested(userInput: string, toolName: string): boolean {
  const result = calculateSemanticNudge(userInput)
  return result.suggestions.some(s => s.tool === toolName)
}

/**
 * Obtém a tool mais sugerida para o input.
 */
export function getTopSuggestion(userInput: string): { tool: string; confidence: number } | null {
  const result = calculateSemanticNudge(userInput)
  return result.suggestions[0] || null
}
