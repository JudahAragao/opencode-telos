/**
 * State Gate — Prioriza as tools mais relevantes para cada estado do grafo.
 *
 * NOTE: this module does NOT hide tools. The full catalog is always
 * announced to the agent by tool-registry.ts; here we only compute the subset
 * that deserves a highlight for the current state. The final decision of what
 * can be called belongs to the enforcement policy (checkToolAccess).
 *
 * Esconder tools por categoria foi a causa de entry points essenciais
 * (sdd.start_dashboard, sdd.enforce, ...) nunca chegarem ao prompt.
 *
 * Consumido por: tool-registry.ts
 * Dependencies: graph-state-snapshot.ts, tool-taxonomy.ts
 */

import { getGraphSnapshot, type GraphState } from "./graph-state-snapshot.js"
import { TOOL_TAXONOMY, type ToolCategory } from "./tool-taxonomy.js"

/** Tools that are always visible (essential) */
const ALWAYS_VISIBLE = new Set([
  "sdd.inspect",
  "sdd.query_graph",
  "sdd.validate",
  "sdd.detect_drift",
  "sdd.get_context",
  // Workflow entry points: exempt from the enforcement policy and required to
  // start a Change in ANY graph state, so they must never be hidden.
  "sdd.enforce",
  "sdd.renew_workflow",
  "sdd.update_from_answers",
])

/** Composite tools that are always visible */
const ALWAYS_VISIBLE_COMPOSITES = new Set([
  "sdd.graph_query",
  "sdd.graph_mutation",
  "sdd.traverse",
])

/**
 * Mapping of state → visible composite tools.
 * Keys are subsets of GraphState.
 */
const STATE_TOOLS: Record<GraphState, { composite: string[]; standalone: string[] }> = {
  error: {
    composite: [],
    standalone: ["sdd.inspect", "sdd.validate", "sdd.initialize"],
  },
  uninitialized: {
    composite: [],
    standalone: ["sdd.initialize", "sdd.build_graph", "sdd.discover"],
  },
  empty: {
    composite: ["sdd.graph_mutation"],
    standalone: ["sdd.build_graph", "sdd.discover", "sdd.inspect", "sdd.reverse_engineer"],
  },
  partial: {
    composite: ["sdd.graph_mutation", "sdd.graph_query"],
    standalone: [
      "sdd.discover", "sdd.update_from_answers", "sdd.inspect",
      "sdd.build_graph", "sdd.enforce",
    ],
  },
  ready: {
    composite: [
      "sdd.graph_mutation", "sdd.graph_query", "sdd.traverse",
      "sdd.code_quality", "sdd.graph_admin",
    ],
    standalone: [
      "sdd.enforce", "sdd.build_graph", "sdd.discover",
      "sdd.pending_changes", "sdd.change_history",
      // Traceability and releases: maintaining an already-built graph.
      "sdd.infer_relationships", "sdd.milestone", "sdd.integrate_tasks",
    ],
  },
  has_change: {
    composite: [
      "sdd.graph_mutation", "sdd.graph_query", "sdd.traverse",
      "sdd.code_quality", "sdd.graph_admin", "sdd.permissions",
    ],
    standalone: [
      "sdd.enforce", "sdd.approve_change", "sdd.update_from_answers",
      "sdd.pending_changes", "sdd.change_history", "sdd.impact_report",
      // O Change atualiza a rastreabilidade e entra num release.
      "sdd.infer_relationships", "sdd.milestone", "sdd.integrate_tasks",
    ],
  },
  has_approved_change: {
    composite: [
      "sdd.graph_mutation", "sdd.graph_query", "sdd.traverse",
      "sdd.code_quality", "sdd.graph_admin", "sdd.permissions",
      "sdd.snapshot", "sdd.sync",
    ],
    standalone: [
      "sdd.generate_code", "sdd.complete_change", "sdd.fail_change",
      "sdd.validate", "sdd.detect_drift",
      // Release closure after completing the Change.
      "sdd.milestone", "sdd.integrate_tasks",
    ],
  },
  emergency: {
    composite: [
      "sdd.graph_mutation", "sdd.graph_query", "sdd.traverse",
      "sdd.snapshot",
    ],
    standalone: [
      "sdd.hotfix", "sdd.validate", "sdd.complete_change",
    ],
  },
}

/**
 * Categorias de tools que ficam ocultas em certos estados.
 */
const CATEGORY_HIDDEN: Record<GraphState, ToolCategory[]> = {
  error: ["quality", "sync", "enterprise", "admin"],
  uninitialized: ["quality", "sync", "enterprise", "admin"],
  empty: ["quality", "sync", "enterprise"],
  partial: ["sync", "enterprise"],
  ready: ["sync"],
  has_change: [],
  has_approved_change: [],
  emergency: ["quality", "sync", "enterprise"],
}

/**
 * Gets the recommended (highlighted) tools for the current graph state.
 *
 * @param directory - Project directory
 * @returns Set of recommended tool names. Never means "hide".
 */
export function getRecommendedTools(directory: string): Set<string> {
  const snapshot = getGraphSnapshot(directory)
  const stateConfig = STATE_TOOLS[snapshot.state]
  const hiddenCategories = CATEGORY_HIDDEN[snapshot.state] || []

  const recommended = new Set<string>()

  // Add always-visible ones
  for (const t of ALWAYS_VISIBLE) recommended.add(t)
  for (const t of ALWAYS_VISIBLE_COMPOSITES) recommended.add(t)

  // Adicionar tools do estado
  for (const t of stateConfig.standalone) recommended.add(t)
  for (const t of stateConfig.composite) recommended.add(t)

  // Add composites from non-hidden categories
  for (const tool of TOOL_TAXONOMY) {
    if (!hiddenCategories.includes(tool.category)) {
      recommended.add(tool.name)
    }
  }

  return recommended
}

/** @deprecated Use getRecommendedTools — no tool is hidden from the agent. */
export const getVisibleTools = getRecommendedTools

/**
 * Formats the visible tool list for system prompt injection.
 */
export function formatVisibleTools(visibleTools: Set<string> | null): string {
  if (!visibleTools) {
    return "[All SDD tools available]"
  }

  const lines = ["## SDD Tools Available for This State\n"]

  // Agrupar por tipo
  const standalone: string[] = []
  const composite: string[] = []

  for (const name of visibleTools) {
    if (TOOL_TAXONOMY.find(t => t.name === name)) {
      composite.push(name)
    } else {
      standalone.push(name)
    }
  }

  if (standalone.length > 0) {
    lines.push("### Standalone tools")
    for (const t of standalone.sort()) {
      lines.push(`- \`${t}\``)
    }
  }

  if (composite.length > 0) {
    lines.push("\n### Composite tools (use action= for the sub-command)")
    for (const t of composite.sort()) {
      const tool = TOOL_TAXONOMY.find(tc => tc.name === t)
      if (tool) {
        const actions = tool.actions.map(a => a.name).join(", ")
        lines.push(`- \`${t}\` → [${actions}]`)
      }
    }
  }

  return lines.join("\n")
}

/**
 * Contract of the enforcement announced together with the tool list.
 *
 * Keeps the prompt coherent with the policy applied by checkToolAccess: mutation
 * tools are refused while there is no active Change, so the bootstrap order must
 * be explicit for the agent.
 */
export const ENFORCEMENT_ORDER_INSTRUCTION = `
### Mandatory order (enforcement active)
Without an active Change, graph mutation tools are refused by the hook. Sequence:
1. \`sdd.enforce\` — classifies the request and creates the Change
2. update the spec (\`sdd.build_graph\`, \`sdd.graph_mutation\`, \`sdd.update_from_answers\`)
3. \`sdd.approve_change\` — approves the Change
4. write code (\`sdd.generate_code\` or Write/Edit)
5. \`sdd.verify_implementation\` → \`sdd.complete_change\`

If the window expires mid-task, use \`sdd.renew_workflow\` (or \`/sdd renew\`) to extend the SAME Change and keep the report — \`sdd.enforce\` would create a new Change. Approving a Change without \`affected_files\` is refused because no Write/Edit would be released.
`.trim()

/**
 * How to pick a tool: the announced list is the full catalog, so the
 * instruction becomes about prioritization, not discovery.
 */
export const ESCAPE_HATCH_INSTRUCTION = `
### How to pick a tool
The list above is the COMPLETE catalog — there is no SDD tool outside it.
Start with the recommended ones (▸) and, before mutating the graph, confirm the
state with \`sdd.inspect\` or \`sdd.query_graph\`.
`.trim()
