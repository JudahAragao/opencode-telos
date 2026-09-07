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
  args: Record<string, unknown> | ((prevResult: string, initialParams: Record<string, unknown>, previousSteps: WorkflowStepResult[]) => Record<string, unknown>)
  /** Se true, falha neste step para a chain inteira */
  required: boolean
  /** Descrição do step para logging */
  description: string
}

export interface WorkflowStepResult {
  tool: string
  result: string
}

function changeIdFrom(steps: WorkflowStepResult[], previous: string): string {
  const text = [...steps.map((step) => step.result), previous].join("\n")
  return text.match(/\b(?:CHG|CHANGE)-[A-Za-z0-9_-]+\b/i)?.[0] || ""
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
      args: (_prev, initial) => ({ request_description: String(initial.briefing || "") }),
      required: true,
      description: "Classificar a requisição e criar Change node",
    },
    {
      tool: "sdd.build_graph",
      args: (_prev, initial) => ({ briefing: String(initial.briefing || "") }),
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
    {
      tool: "sdd.approve_change",
      args: (_prev, _initial, steps) => ({ change_id: changeIdFrom(steps, _prev) }),
      required: true,
      description: "Aprovar a Change criada",
    },
    {
      tool: "sdd.generate_code",
      args: {},
      required: true,
      description: "Gerar a implementação aprovada",
    },
    {
      tool: "sdd.verify_implementation",
      args: (prev, _initial, steps) => ({ change_id: changeIdFrom(steps, prev) }),
      required: true,
      description: "Verificar a implementação da feature",
    },
    {
      tool: "sdd.complete_change",
      args: (prev, _initial, steps) => ({ change_id: changeIdFrom(steps, prev) }),
      required: true,
      description: "Completar a Change após verificação",
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
      args: (_prev, initial) => ({ request_description: `Bug fix: ${String(initial.bug_description || "")}` }),
      required: true,
      description: "Criar Change node para o bug fix",
    },
    {
      tool: "sdd.validate",
      args: {},
      required: true,
      description: "Validar estado atual do grafo",
    },
    {
      tool: "sdd.approve_change",
      args: (prev, _initial, steps) => ({ change_id: changeIdFrom(steps, prev) }),
      required: true,
      description: "Aprovar a correção",
    },
    {
      tool: "sdd.generate_code",
      args: {},
      required: true,
      description: "Gerar a correção aprovada",
    },
    {
      tool: "sdd.verify_implementation",
      args: (prev, _initial, steps) => ({ change_id: changeIdFrom(steps, prev) }),
      required: true,
      description: "Verificar a implementação do bug fix",
    },
    {
      tool: "sdd.complete_change",
      args: (prev, _initial, steps) => ({ change_id: changeIdFrom(steps, prev) }),
      required: true,
      description: "Completar a Change após verificação",
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
      args: (_prev, initial) => ({ description: String(initial.emergency_description || "") }),
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
      args: (_prev, initial) => ({ request_description: `Refactoring: ${String(initial.refactoring_scope || "")}` }),
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
    {
      tool: "sdd.approve_change",
      args: (prev, _initial, steps) => ({ change_id: changeIdFrom(steps, prev) }),
      required: true,
      description: "Aprovar o refactoring",
    },
    {
      tool: "sdd.generate_code",
      args: {},
      required: true,
      description: "Gerar a implementação do refactoring",
    },
    {
      tool: "sdd.verify_implementation",
      args: (prev, _initial, steps) => ({ change_id: changeIdFrom(steps, prev) }),
      required: true,
      description: "Verificar a implementação do refactoring",
    },
    {
      tool: "sdd.complete_change",
      args: (prev, _initial, steps) => ({ change_id: changeIdFrom(steps, prev) }),
      required: true,
      description: "Completar o refactoring",
    },
  ],
}

// ── Chain: Full Cycle ─────────────────────────────────────────────

export const FULL_CYCLE_CHAIN: WorkflowChain = {
  name: "sdd.workflow_full_cycle",
  description: "Ciclo SDD completo com geração, verificação, drift e conclusão.",
  params: [
    { name: "change_request", type: "string", description: "Descrição da mudança", required: true },
  ],
  steps: [{
    tool: "sdd.full_cycle",
    args: (_prev, initial) => ({ request: String(initial.change_request || "") }),
    required: true,
    description: "Executar o ciclo completo com todas as validações",
  }],
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
