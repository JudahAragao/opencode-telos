/**
 * Tool Registry — Registry central de tools SDD.
 *
 * Mantém a lista completa de tools, filtra por estado (state gate)
 * e intenção (intent classifier), e fornece o conjunto final para o LLM.
 *
 * Consumido por: hooks.ts (experimental.chat.system.transform)
 * Dependências: state-gate.ts, intent-classifier.ts, tool-taxonomy.ts
 */

import { getVisibleTools, ESCAPE_HATCH_INSTRUCTION } from "./state-gate.js"
import { classifyIntent, getToolsForIntent, type IntentResult } from "./intent-classifier.js"
import { TOOL_TAXONOMY, STANDALONE_TOOLS, type CompositeTool } from "./tool-taxonomy.js"

export interface ToolRegistryResult {
  /** Tools finais selecionadas para o LLM */
  tools: string[]
  /** Resultado da classificação de intenção */
  intent: IntentResult
  /** Se null, todas as tools estão disponíveis (fallback) */
  stateTools: Set<string> | null
  /** Mensagem formatada para injeção no system prompt */
  formattedMessage: string
}

/**
 * Obtém o conjunto final de tools para o LLM.
 *
 * Combina state gate (tools visíveis pelo estado do grafo)
 * com intent classifier (tools relevantes para a intenção).
 *
 * @param directory - Diretório do projeto
 * @param userInput - Texto do input do usuário
 * @returns ToolRegistryResult com tools selecionadas e mensagem formatada
 */
export function getToolsForSession(directory: string, userInput: string): ToolRegistryResult {
  // 1. State gate: quais tools são visíveis pelo estado do grafo?
  const stateTools = getVisibleTools(directory)

  // 2. Intent classifier: qual a intenção do usuário?
  const intent = classifyIntent(userInput)

  // 3. Interseção: tools da intenção ∩ tools visíveis
  const tools = getToolsForIntent(intent, stateTools)

  // 4. Se resultado muito pequeno, usar fallback (todas as tools do estado)
  const finalTools = tools.length >= 3 ? tools : (stateTools ? [...stateTools] : [...STANDALONE_TOOLS, ...TOOL_TAXONOMY.map(t => t.name)])

  // 5. Formatar mensagem para o system prompt
  const formattedMessage = formatToolRegistryMessage(finalTools, intent)

  return {
    tools: finalTools,
    intent,
    stateTools,
    formattedMessage,
  }
}

/**
 * Formata a mensagem do tool registry para o system prompt.
 */
function formatToolRegistryMessage(
  tools: string[],
  intent: IntentResult,
): string {
  const lines: string[] = []

  // Header com intenção detectada
  const confidencePct = Math.round(intent.confidence * 100)
  lines.push(`## Intent Detectado: ${intent.category} (${confidencePct}% confiança)`)
  if (intent.topCategories.length > 1) {
    const alternatives = intent.topCategories.slice(1).map(c => `${c.category} (${Math.round(c.score * 100)}%)`).join(", ")
    lines.push(`Alternativas: ${alternatives}`)
  }
  lines.push("")

  // Tools selecionadas
  const standalone = tools.filter(t => STANDALONE_TOOLS.includes(t))
  const composite = tools.filter(t => TOOL_TAXONOMY.find(tc => tc.name === t))

  if (standalone.length > 0) {
    lines.push("### Tools Individuais")
    for (const t of standalone.sort()) {
      lines.push(`- \`${t}\``)
    }
  }

  if (composite.length > 0) {
    lines.push("\n### Tools Compositas (use action= para sub-comando)")
    for (const t of composite.sort()) {
      const tool = TOOL_TAXONOMY.find(tc => tc.name === t)
      if (tool) {
        const actions = tool.actions.map(a => a.name).join(", ")
        lines.push(`- \`${t}\` → [${actions}]`)
      }
    }
  }

  // Escape hatch
  lines.push("")
  lines.push(ESCAPE_HATCH_INSTRUCTION)

  return lines.join("\n")
}

/**
 * Obtém descrição de uma tool (standalone ou composite).
 */
export function getToolDescription(toolName: string): string {
  // Tentar standalone primeiro
  if (STANDALONE_TOOLS.includes(toolName)) {
    return `SDD tool: ${toolName}`
  }

  // Tentar composite
  const composite = TOOL_TAXONOMY.find(t => t.name === toolName)
  if (composite) {
    return composite.description
  }

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
