/**
 * Tool Registry — Registry central de tools SDD.
 *
 * Anuncia o CATÁLOGO COMPLETO de tools registradas ao agente e destaca as mais
 * relevant to the current graph state and to the detected intent.
 *
 * History: this module used to hide tools by category/state and shrink the
 * announcement to ~3 names, which meant essential entry points (sdd.enforce,
 * sdd.discover, sdd.start_dashboard) never reached the model. No tool is
 * omitted now — the enforcement policy decides what can be called, not the
 * announcement.
 *
 * Consumido por: hooks.ts (experimental.chat.system.transform)
 * Dependencies: state-gate.ts, intent-classifier.ts, categories.ts, tool-taxonomy.ts
 */

import {
  getRecommendedTools,
  ESCAPE_HATCH_INSTRUCTION,
  ENFORCEMENT_ORDER_INSTRUCTION,
} from "./state-gate.js"
import { classifyIntent, type IntentResult } from "./intent-classifier.js"
import { TOOL_TAXONOMY, STANDALONE_TOOLS, type CompositeTool } from "./tool-taxonomy.js"
import { getToolCategories } from "./categories.js"

export interface ToolRegistryResult {
  /** Full catalog, ordered by relevance */
  tools: string[]
  /** Intent classification result (zeroed when there is no input) */
  intent: IntentResult
  /** Tools recommended for the current graph state (highlight, never a filter) */
  recommended: Set<string>
  /** Formatted message for system prompt injection */
  formattedMessage: string
}

/**
 * Full catalog of registered tools: the standalone ones (whose name comes from
 * STANDALONE_CATEGORIES) plus the composites from the taxonomy.
 *
 * tests/tool-catalog.test.ts guarantees this list matches the keys of
 * createSddTools(), so a new tool can no longer stay invisible.
 */
export const ALL_TOOL_NAMES: readonly string[] = [
  ...STANDALONE_TOOLS,
  ...TOOL_TAXONOMY.map((t) => t.name),
]

const COMPOSITE_NAMES = new Set(TOOL_TAXONOMY.map((t) => t.name))

/** Nomes de tools por linha na listagem compacta do prompt. */
const NAMES_PER_LINE = 5

/** Display priority: intent (0) → recommended (1) → rest (2). */
function relevanceRank(
  name: string,
  intent: IntentResult | null,
  recommended: Set<string>,
): number {
  if (intent && getToolCategories(name).includes(intent.category)) return 0
  if (recommended.has(name)) return 1
  return 2
}

/**
 * Gets the final set of tools for the LLM.
 *
 * @param directory - Project directory
 * @param userInput - The user's input text. When absent/empty (e.g. the
 *   system prompt injection does not carry the user's message), no intent is
 *   inferred and the state-recommended tools lead the ordering.
 * @returns ToolRegistryResult with the full catalog and the formatted message
 */
export function getToolsForSession(directory: string, userInput?: string): ToolRegistryResult {
  // 1. State gate: quais tools merecem destaque neste estado do grafo?
  const recommended = getRecommendedTools(directory)

  // 2. Intent classifier: what is the user's intent? (only with real input —
  // inferir de string vazia devolvia sempre a primeira categoria, "mutation")
  const input = userInput?.trim() ?? ""
  const intent = input.length > 0 ? classifyIntent(input) : null

  // 3. Sort by relevance while keeping the ENTIRE catalog (nothing omitted)
  const tools = [...ALL_TOOL_NAMES].sort((a, b) => {
    const diff = relevanceRank(a, intent, recommended) - relevanceRank(b, intent, recommended)
    return diff !== 0 ? diff : a.localeCompare(b)
  })

  return {
    tools,
    intent: intent ?? { category: "info", confidence: 0, topCategories: [] },
    recommended,
    formattedMessage: formatToolRegistryMessage(tools, intent, recommended),
  }
}

/**
 * Compact list of names, grouped in lines, highlighting the recommended ones.
 */
function formatNameList(names: readonly string[], recommended: Set<string>): string {
  const sorted = [...names].sort()
  const lines: string[] = []
  for (let i = 0; i < sorted.length; i += NAMES_PER_LINE) {
    const chunk = sorted
      .slice(i, i + NAMES_PER_LINE)
      .map((name) => `${recommended.has(name) ? "▸" : " "} \`${name}\``)
    lines.push(`- ${chunk.join("")}`)
  }
  return lines.join("\n")
}

/**
 * Formata a mensagem do tool registry para o system prompt.
 *
 * @param intent - null when there was no input to classify.
 */
function formatToolRegistryMessage(
  tools: readonly string[],
  intent: IntentResult | null,
  recommended: Set<string>,
): string {
  const lines: string[] = []

  if (intent) {
    const confidencePct = Math.round(intent.confidence * 100)
    lines.push(`## Detected Intent: ${intent.category} (${confidencePct}% confidence)`)
    if (intent.topCategories.length > 1) {
      const alternatives = intent.topCategories
        .slice(1)
        .map((c) => `${c.category} (${Math.round(c.score * 100)}%)`)
        .join(", ")
      lines.push(`Alternativas: ${alternatives}`)
    }
    lines.push("")
  }

  lines.push(`### SDD Tools — full catalog (${tools.length})`)
  lines.push(
    "All are available. `▸` marks the ones recommended for the current graph state.",
  )
  lines.push("")

  const composites = tools.filter((name) => COMPOSITE_NAMES.has(name)).sort()
  const standalone = tools.filter((name) => !COMPOSITE_NAMES.has(name))

  if (composites.length > 0) {
    lines.push("#### Composites (use `action=` for the sub-command)")
    for (const name of composites) {
      const tool: CompositeTool | undefined = TOOL_TAXONOMY.find((tc) => tc.name === name)
      if (!tool) continue
      const actions = tool.actions.map((a) => a.name).join(", ")
      lines.push(`- ${recommended.has(name) ? "▸" : " "} \`${name}\` → [${actions}]`)
    }
    lines.push("")
  }

  lines.push(`#### Standalone (${standalone.length})`)
  lines.push(formatNameList(standalone, recommended))
  lines.push("")

  // Enforcement contract (keeps the prompt coherent with checkToolAccess)
  lines.push(ENFORCEMENT_ORDER_INSTRUCTION)
  lines.push("")
  lines.push(ESCAPE_HATCH_INSTRUCTION)

  return lines.join("\n")
}

/**
 * Gets the description of a tool (standalone or composite).
 */
export function getToolDescription(toolName: string): string {
  const composite = TOOL_TAXONOMY.find((t) => t.name === toolName)
  if (composite) return composite.description

  if (STANDALONE_TOOLS.includes(toolName)) return `SDD tool: ${toolName}`

  return `Unknown tool: ${toolName}`
}

/**
 * Lista todas as tools ativas (composits + standalone) com contagem.
 */
export function listAllTools(): { standalone: string[]; composite: CompositeTool[]; total: number } {
  return {
    standalone: STANDALONE_TOOLS,
    composite: TOOL_TAXONOMY,
    total: STANDALONE_TOOLS.length + TOOL_TAXONOMY.length,
  }
}
