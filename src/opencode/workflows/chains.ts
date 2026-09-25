/**
 * Workflow Chains — Definitions of multi-step workflows.
 *
 * Each chain is an ordered list of steps.
 * O executor (executor.ts) executa cada step sequencialmente.
 *
 * Consumido por: executor.ts, tools-workflow.ts
 * Dependencies: none (pure definitions module)
 */

export interface WorkflowStep {
  /** Nome da tool SDD a chamar */
  tool: string
  /** Static args or a function that builds args from the previous result */
  args: Record<string, unknown> | ((prevResult: string, initialParams: Record<string, unknown>, previousSteps: WorkflowStepResult[]) => Record<string, unknown>)
  /** Se true, falha neste step para a chain inteira */
  required: boolean
  /** Step description for logging */
  description: string
}

export interface WorkflowStepResult {
  tool: string
  result: string
  stepId?: string
  status?: string
  data?: Record<string, unknown>
}

function changeIdFrom(steps: WorkflowStepResult[], previous: string): string {
  for (const step of [...steps].reverse()) {
    const structured = step.data?.changeId
    if (typeof structured === "string" && structured.length > 0) return structured
  }
  const text = [...steps.map((step) => step.result), previous].join("\n")
  return text.match(/\b(?:CHG|CHANGE)-[A-Za-z0-9_-]+\b/i)?.[0] || ""
}

export interface WorkflowChain {
  /** Nome da chain (usado como tool name) */
  name: string
  /** Description for the LLM */
  description: string
  /** Parameters accepted by the chain */
  params: Array<{ name: string; type: string; description: string; required: boolean }>
  /** Lista de steps */
  steps: WorkflowStep[]
}

// ── Chain: New Feature ────────────────────────────────────────────

export const NEW_FEATURE_CHAIN: WorkflowChain = {
  name: "sdd.workflow_new_feature",
  description: "Workflow completo para criar uma nova feature: enforce → build graph → validate → approve → generate code.",
  params: [
    { name: "briefing", type: "string", description: "Feature description or project briefing", required: true },
  ],
  steps: [
    {
      tool: "sdd.enforce",
      args: (_prev, initial) => ({ request_description: String(initial.briefing || "") }),
      required: true,
      description: "Classify the request and create the Change node",
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
      description: "Generate the approved implementation",
    },
    {
      tool: "sdd.verify_implementation",
      args: (prev, _initial, steps) => ({ change_id: changeIdFrom(steps, prev) }),
      required: true,
      description: "Verify the feature implementation",
    },
    {
      tool: "sdd.complete_change",
      args: (prev, _initial, steps) => ({ change_id: changeIdFrom(steps, prev) }),
      required: true,
      description: "Complete the Change after verification",
    },
  ],
}

// ── Chain: Bug Fix ────────────────────────────────────────────────

export const BUG_FIX_CHAIN: WorkflowChain = {
  name: "sdd.workflow_bug_fix",
  description: "Bug fix workflow: enforce → validate → approve → complete.",
  params: [
    { name: "bug_description", type: "string", description: "Bug description", required: true },
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
      description: "Approve the fix",
    },
    {
      tool: "sdd.generate_code",
      args: {},
      required: true,
      description: "Generate the approved fix",
    },
    {
      tool: "sdd.verify_implementation",
      args: (prev, _initial, steps) => ({ change_id: changeIdFrom(steps, prev) }),
      required: true,
      description: "Verify the bug fix implementation",
    },
    {
      tool: "sdd.complete_change",
      args: (prev, _initial, steps) => ({ change_id: changeIdFrom(steps, prev) }),
      required: true,
      description: "Complete the Change after verification",
    },
  ],
}

// ── Chain: Hotfix ─────────────────────────────────────────────────

export const HOTFIX_CHAIN: WorkflowChain = {
  name: "sdd.workflow_hotfix",
  description: "Emergency workflow: hotfix without enforcement → document retroactively.",
  params: [
    { name: "emergency_description", type: "string", description: "Emergency description", required: true },
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
      description: "Validate the graph after the hotfix",
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
      description: "Generate the refactoring implementation",
    },
    {
      tool: "sdd.verify_implementation",
      args: (prev, _initial, steps) => ({ change_id: changeIdFrom(steps, prev) }),
      required: true,
      description: "Verify the refactoring implementation",
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
  description: "Full SDD cycle with generation, verification, drift and completion.",
  params: [
    { name: "change_request", type: "string", description: "Change description", required: true },
  ],
  steps: [{
    tool: "sdd.full_cycle",
    args: (_prev, initial) => ({ request: String(initial.change_request || "") }),
    required: true,
    description: "Run the full cycle with all validations",
  }],
}

// ── Chain: Reverse Engineering ──────────────────────────────────

export const REVERSE_ENGINEERING_CHAIN: WorkflowChain = {
  name: "sdd.workflow_reverse_engineer",
  description: "Workflow de engenharia reversa: scan do codebase → gerar SDD → validar.",
  params: [
    { name: "purpose", type: "string", description: "documentation ou reverse_engineering", required: true },
    { name: "focus_dirs", type: "string", description: "Directories to focus on (optional, comma-separated)", required: false },
  ],
  steps: [
    {
      tool: "sdd.reverse_engineer",
      args: (_prev, initial) => ({
        purpose: String(initial.purpose || "reverse_engineering"),
        focus_dirs: initial.focus_dirs ? String(initial.focus_dirs) : undefined,
      }),
      required: true,
      description: "Analisar codebase e gerar SDD",
    },
    {
      tool: "sdd.validate",
      args: {},
      required: true,
      description: "Validar integridade do grafo gerado",
    },
    {
      tool: "sdd.inspect",
      args: {},
      required: false,
      description: "Revisar o que foi criado",
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
  REVERSE_ENGINEERING_CHAIN,
]

/**
 * Gets a chain by name.
 */
export function getChainByName(name: string): WorkflowChain | undefined {
  return ALL_CHAINS.find(c => c.name === name)
}

/**
 * Lists all available chains (names + descriptions).
 */
export function listChainNames(): Array<{ name: string; description: string }> {
  return ALL_CHAINS.map(c => ({ name: c.name, description: c.description }))
}
