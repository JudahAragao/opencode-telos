/**
 * Workflow Chains — Definições de workflows de múltiplos steps.
 *
 * Cada chain é uma lista ordenada de steps.
 * O executor (executor.ts) executa cada step sequencialmente.
 *
 * Consumido por: executor.ts, tools-workflow.ts
 * Dependências: nenhuma (módulo puro de definições)
 */

export interface WorkflowStep {
  /** Nome da tool SDD a chamar */
  tool: string
  /** Args estáticos ou função que gera args do resultado anterior */
  args: Record<string, unknown> | ((prevResult: string) => Record<string, unknown>)
  /** Se true, falha neste step para a chain inteira */
  required: boolean
  /** Descrição do step para logging */
  description: string
}

export interface WorkflowChain {
  /** Nome da chain (usado como tool name) */
  name: string
  /** Descrição para o LLM */
  description: string
  /** Parâmetros aceitos pela chain */
  params: Array<{ name: string; type: string; description: string; required: boolean }>
  /** Lista de steps */
  steps: WorkflowStep[]
}

// ── Chain: New Feature ────────────────────────────────────────────

export const NEW_FEATURE_CHAIN: WorkflowChain = {
  name: "sdd.workflow_new_feature",
  description: "Workflow completo para criar uma nova feature: enforce → build graph → validate → approve → generate code.",
  params: [
    { name: "briefing", type: "string", description: "Descrição da feature ou briefing do projeto", required: true },
  ],
  steps: [
    {
      tool: "sdd.enforce",
      args: (prev) => ({ change_request: prev }),
      required: true,
      description: "Classificar a requisição e criar Change node",
    },
    {
      tool: "sdd.build_graph",
      args: (prev) => ({ briefing: prev }),
      required: true,
      description: "Construir o Knowledge Graph a partir do briefing",
    },
    {
      tool: "sdd.validate",
      args: {},
      required: true,
      description: "Validar integridade do grafo",
    },
    {
      tool: "sdd.inspect",
      args: {},
      required: false,
      description: "Revisar o que foi criado",
    },
  ],
}

// ── Chain: Bug Fix ────────────────────────────────────────────────

export const BUG_FIX_CHAIN: WorkflowChain = {
  name: "sdd.workflow_bug_fix",
  description: "Workflow para correção de bug: enforce → validate → approve → complete.",
  params: [
    { name: "bug_description", type: "string", description: "Descrição do bug", required: true },
  ],
  steps: [
    {
      tool: "sdd.enforce",
      args: (prev) => ({ change_request: `Bug fix: ${prev}` }),
      required: true,
      description: "Criar Change node para o bug fix",
    },
    {
      tool: "sdd.validate",
      args: {},
      required: true,
      description: "Validar estado atual do grafo",
    },
  ],
}

// ── Chain: Hotfix ─────────────────────────────────────────────────

export const HOTFIX_CHAIN: WorkflowChain = {
  name: "sdd.workflow_hotfix",
  description: "Workflow de emergência: hotfix sem enforcement → documentar retroativamente.",
  params: [
    { name: "emergency_description", type: "string", description: "Descrição da emergência", required: true },
  ],
  steps: [
    {
      tool: "sdd.hotfix",
      args: (prev) => ({ description: prev }),
      required: true,
      description: "Aplicar hotfix e documentar retroativamente",
    },
    {
      tool: "sdd.validate",
      args: {},
      required: false,
      description: "Validar grafo após hotfix",
    },
  ],
}

// ── Chain: Refactoring ────────────────────────────────────────────

export const REFACTORING_CHAIN: WorkflowChain = {
  name: "sdd.workflow_refactor",
  description: "Workflow de refactoring: enforce → validate → analyze impact → complete.",
  params: [
    { name: "refactoring_scope", type: "string", description: "Escopo do refactoring", required: true },
  ],
  steps: [
    {
      tool: "sdd.enforce",
      args: (prev) => ({ change_request: `Refactoring: ${prev}` }),
      required: true,
      description: "Classificar refactoring e criar Change node",
    },
    {
      tool: "sdd.validate",
      args: {},
      required: true,
      description: "Validar grafo antes do refactoring",
    },
    {
      tool: "sdd.inspect",
      args: {},
      required: false,
      description: "Revisar estado atual",
    },
  ],
}

// ── Chain: Full Cycle ─────────────────────────────────────────────

export const FULL_CYCLE_CHAIN: WorkflowChain = {
  name: "sdd.workflow_full_cycle",
  description: "Ciclo SDD completo: enforce → validate → generate code → detect drift → complete.",
  params: [
    { name: "change_request", type: "string", description: "Descrição da mudança", required: true },
  ],
  steps: [
    {
      tool: "sdd.enforce",
      args: (prev) => ({ change_request: prev }),
      required: true,
      description: "Classificar e criar Change node",
    },
    {
      tool: "sdd.validate",
      args: {},
      required: true,
      description: "Validar grafo",
    },
    {
      tool: "sdd.generate_code",
      args: {},
      required: true,
      description: "Gerar código a partir da spec",
    },
    {
      tool: "sdd.detect_drift",
      args: {},
      required: false,
      description: "Verificar drift specification vs code",
    },
  ],
}

// ── Todas as chains ───────────────────────────────────────────────

export const ALL_CHAINS: WorkflowChain[] = [
  NEW_FEATURE_CHAIN,
  BUG_FIX_CHAIN,
  HOTFIX_CHAIN,
  REFACTORING_CHAIN,
  FULL_CYCLE_CHAIN,
]

/**
 * Obtém uma chain pelo nome.
 */
export function getChainByName(name: string): WorkflowChain | undefined {
  return ALL_CHAINS.find(c => c.name === name)
}

/**
 * Lista todas as chains disponíveis (nomes + descriptions).
 */
export function listChainNames(): Array<{ name: string; description: string }> {
  return ALL_CHAINS.map(c => ({ name: c.name, description: c.description }))
}
