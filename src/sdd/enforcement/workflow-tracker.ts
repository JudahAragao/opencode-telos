/**
 * SDD Workflow State Tracker (FEAT-087/FEAT-100)
 *
 * Tracks whether the current agent session is inside a valid SDD workflow.
 * Graph mutation tools (add_node, update_node, etc.) are blocked unless
 * the session has passed through sdd.enforce or an approved Change exists.
 *
 * Uses module-level state (not AsyncLocalStorage) because OpenCode tools
 * execute synchronously within a single tool-call boundary.
 */

import { getCompositeForTool } from "../../opencode/router/tool-taxonomy.js"

export interface WorkflowState {
  /** Whether sdd.enforce has been called in this session */
  enforced: boolean
  /** Change node ID created by sdd.enforce */
  changeId: string | null
  /** Whether the current change has been approved */
  approved: boolean
  /** Whether sdd.validate has passed since last enforce */
  validated: boolean
  /** Timestamp of last enforce call */
  enforcedAt: number
  /** Whether discovery is in progress (sdd.discover was called) */
  discovering: boolean
  /** Whether the SDD spec has been updated since last enforce (add_node, update_node, update_from_answers) */
  specUpdated: boolean
}

const DEFAULT_SCOPE = "__default__"
const states = new Map<string, WorkflowState>()

/** Isolate concurrent OpenCode sessions while retaining directory-only API compatibility. */
export function workflowScope(projectDir: string, sessionId?: string): string {
  return sessionId ? `${projectDir}::session:${sessionId}` : projectDir
}

function freshState(): WorkflowState {
  return {
    enforced: false,
    changeId: null,
    approved: false,
    validated: false,
    enforcedAt: 0,
    discovering: false,
    specUpdated: false,
  }
}

function getMutableState(scope = DEFAULT_SCOPE): WorkflowState {
  let state = states.get(scope)
  if (!state) {
    state = freshState()
    states.set(scope, state)
  }
  return state
}

/** Reset workflow state (called on session start or /sdd off) */
export function resetWorkflowState(scope = DEFAULT_SCOPE): void {
  const state = getMutableState(scope)
  state.enforced = false
  state.changeId = null
  state.approved = false
  state.validated = false
  state.enforcedAt = 0
  state.discovering = false
  state.specUpdated = false
}

/** Mark that sdd.enforce was called */
export function markEnforced(changeId: string, scope = DEFAULT_SCOPE): void {
  const state = getMutableState(scope)
  state.enforced = true
  state.changeId = changeId
  state.approved = false
  state.validated = false
  state.enforcedAt = Date.now()
  state.specUpdated = false
}

/** Mark that the change was approved */
export function markApproved(scope = DEFAULT_SCOPE): void {
  const state = getMutableState(scope)
  state.approved = true
}

/** Mark that sdd.validate passed */
export function markValidated(scope = DEFAULT_SCOPE): void {
  const state = getMutableState(scope)
  state.validated = true
}

/** Mark that discovery is in progress */
export function markDiscovering(discovering: boolean, scope = DEFAULT_SCOPE): void {
  const state = getMutableState(scope)
  state.discovering = discovering
}

/** Mark that the SDD spec has been updated (add_node, update_node, update_from_answers) */
export function markSpecUpdated(scope = DEFAULT_SCOPE): void {
  const state = getMutableState(scope)
  state.specUpdated = true
}

/** Mark that the change was completed (resets state) */
export function markCompleted(scope = DEFAULT_SCOPE): void {
  const state = getMutableState(scope)
  state.enforced = false
  state.changeId = null
  state.approved = false
  state.validated = false
  state.enforcedAt = 0
  state.specUpdated = false
}

const DEFAULT_WORKFLOW_TTL_MS = 30 * 60 * 1000

/**
 * Janela de validade de um workflow ativo.
 *
 * Uma tarefa longa (refactor amplo, migração) estourava o prazo de 30 min no
 * meio da implementação e invalidava o laudo de verificação já gravado; a única
 * saída era repetir `sdd.enforce`, que cria um Change NOVO e deixa o anterior
 * órfão. `sdd.renew_workflow` / `/sdd renew` renova a janela do MESMO Change,
 * preservando o laudo. Override: `SDD_WORKFLOW_TTL_MS`.
 */
export function workflowTtlMs(): number {
  const fromEnv = Number(process.env.SDD_WORKFLOW_TTL_MS)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv
  return DEFAULT_WORKFLOW_TTL_MS
}

/** Check if workflow is in a valid state for graph mutations */
export function isWorkflowValid(scope = DEFAULT_SCOPE): { valid: boolean; reason?: string } {
  const state = getMutableState(scope)
  if (!state.enforced) {
    return {
      valid: false,
      reason: "No SDD workflow active. Call sdd.enforce first to classify the change and create a Change node.",
    }
  }

  const ttl = workflowTtlMs()
  if (Date.now() - state.enforcedAt > ttl) {
    return {
      valid: false,
      reason:
        `SDD workflow expired after ${Math.round(ttl / 60000)} min. ` +
        `Renew the SAME change with \`sdd.renew_workflow\` (change_id: ${state.changeId ?? "n/a"}) to keep its verification report, ` +
        "or call `sdd.enforce` to start a new Change.",
    }
  }

  return { valid: true }
}

/** Tempo restante da janela do workflow, em ms (0 quando não há workflow ativo). */
export function workflowRemainingMs(scope = DEFAULT_SCOPE): number {
  const state = getMutableState(scope)
  if (!state.enforced) return 0
  return Math.max(0, state.enforcedAt + workflowTtlMs() - Date.now())
}

export interface WorkflowRenewResult {
  renewed: boolean
  changeId: string | null
  /** Epoch ms em que a janela (possivelmente renovada) expira; null sem workflow ativo. */
  expiresAt: number | null
  reason?: string
}

/**
 * Renova a janela do workflow ativo preservando o MESMO Change — e portanto o
 * laudo de verificação em `.sdd/verification/<changeId>.json`, que continuaria
 * válido porque nada do código mudou. Sem workflow ativo, ou com um changeId
 * diferente do ativo, recusa em vez de criar silenciosamente outro workflow.
 */
export function renewWorkflow(changeId?: string, scope = DEFAULT_SCOPE): WorkflowRenewResult {
  const state = getMutableState(scope)
  if (!state.enforced || !state.changeId) {
    return { renewed: false, changeId: null, expiresAt: null, reason: "No SDD workflow is active. Call sdd.enforce first to create a Change." }
  }
  if (changeId && changeId !== state.changeId) {
    return {
      renewed: false,
      changeId: state.changeId,
      expiresAt: state.enforcedAt + workflowTtlMs(),
      reason: `The active workflow belongs to ${state.changeId}, not ${changeId}. Renewing a different Change would not carry its verification report; call sdd.enforce to start a new one.`,
    }
  }
  state.enforcedAt = Date.now()
  return { renewed: true, changeId: state.changeId, expiresAt: state.enforcedAt + workflowTtlMs() }
}

/** Get current workflow state (read-only) */
export function getWorkflowState(scope = DEFAULT_SCOPE): Readonly<WorkflowState> {
  const exact = states.get(scope)
  if (exact) return { ...exact }
  if (scope !== DEFAULT_SCOPE) {
    const sessionState = [...states.entries()].find(([key, value]) =>
      key.startsWith(`${scope}::session:`) && value.enforced,
    )?.[1]
    if (sessionState) return { ...sessionState }
  }
  return { ...freshState() }
}

/**
 * Tools that are ALLOWED without workflow context.
 * These are read-only or workflow-entry tools.
 */
export const WORKFLOW_EXEMPT_TOOLS = new Set([
  "sdd.initialize",
  "sdd.inspect",
  "sdd.query_graph",
  "sdd.get_context",
  "sdd.analyze_impact",
  "sdd.validate",
  "sdd.detect_drift",
  "sdd.quality",
  "sdd.contradictions",
  "sdd.anti_patterns",
  "sdd.clone_detection",
  "sdd.promises",
  "sdd.coverage",
  "sdd.pending_changes",
  "sdd.remote_status",
  "sdd.mcp_server_info",
  "sdd.handle_mcp_tool",
  // Workflow entry points (start the workflow)
  "sdd.enforce",
  "sdd.enforce_rules",
  "sdd.discover",
  "sdd.update_from_answers",
  // Engenharia reversa: faz bootstrap do grafo a partir do código existente.
  // É ponto de entrada (como sdd.build_graph) e não pode exigir Change ativo.
  "sdd.reverse_engineer",
  "sdd.workflow_reverse_engineer",
  "sdd.create_change",
  "sdd.approve_change",
  "sdd.complete_change",
  "sdd.verify_implementation",
  // Toggle and config. `sdd.toggle` flips enforcement itself; requiring an
  // active workflow would make it impossible to enable SDD through the tool.
  "sdd.toggle",
  "sdd.toggle_status",
  // Renovação da janela: preserva o Change ativo em vez de criar um novo.
  "sdd.renew_workflow",
  "sdd.constitution",
  // Session
  "sdd.session_handoff",
  "sdd.detect_remote",
  // Infrastructure
  "sdd.brownfield_scan",
  "sdd.start_dashboard",
  // Graph build
  "sdd.build_graph",
  // Operational and composite tools. Composite tools enforce their own
  // action-level rules; the hook must not reject the composite container
  // before its dispatcher can inspect the requested action.
  "sdd.check_migrations",
  "sdd.run_migrations",
  // Milestones e Kanban: o container é isento para que ações de leitura
  // (list/report) sempre passem; as mutações são gated logo abaixo em
  // COMPOSITE_MUTATING_ACTIONS.
  "sdd.milestone",
  "sdd.integrate_tasks",
  "sdd.record_feedback",
  "sdd.telemetry",
  "sdd.change_history",
  "sdd.impact_report",
  "sdd.full_cycle",
  "sdd.drift_signals",
  "sdd.graph_query",
  "sdd.traverse",
  "sdd.permissions",
  "sdd.snapshot",
  "sdd.sync",
  "sdd.code_quality",
  "sdd.enterprise",
  // Composite containers stay exempt so their dispatcher can inspect the
  // requested action and allow read-only ones; mutating actions are still
  // gated by COMPOSITE_MUTATING_ACTIONS below.
  "sdd.graph_mutation",
  "sdd.graph_admin",
  "sdd.drift_whitelist",
  "sdd.workflow_new_feature",
  "sdd.workflow_bug_fix",
  "sdd.workflow_hotfix",
  "sdd.workflow_refactor",
  "sdd.workflow_full_cycle",
])

/**
 * Tools that REQUIRE workflow context (graph mutations).
 * These modify the SDD graph and must go through the workflow.
 */
export const WORKFLOW_REQUIRED_TOOLS = new Set([
  "sdd.generate_code",
  "sdd.fail_change",
  "sdd.migrate_storage",
  "sdd.auto_link_tests",
  "sdd.infer_relationships",
  "sdd.install_hooks",
  "sdd.generate_cicd",
  "sdd.bug_fix",
  "sdd.hotfix",
  "sdd.refactoring",
  "sdd.deprecate",
])

/**
 * União de todas as tools com política explícita de acesso (isenta ou
 * obrigatória). É a fonte única da cobertura de classificação: uma tool nova
 * só deixa de ser bloqueada por `checkToolAccess` se estiver aqui (ou tiver
 * entradas em COMPOSITE_MUTATING_ACTIONS). O teste-guarda do catálogo exige
 * que toda tool registrada esteja coberta.
 */
export const CLASSIFIED_TOOLS: ReadonlySet<string> = new Set([
  ...WORKFLOW_EXEMPT_TOOLS,
  ...WORKFLOW_REQUIRED_TOOLS,
])

/**
 * Uma tool está classificada quando tem política de acesso direta ou é um
 * container com ações mutantes declaradas.
 */
export function isToolClassified(toolName: string): boolean {
  return (
    CLASSIFIED_TOOLS.has(toolName) ||
    Object.prototype.hasOwnProperty.call(COMPOSITE_MUTATING_ACTIONS, toolName)
  )
}

/** Actions inside composite tools that change project state. */
const COMPOSITE_MUTATING_ACTIONS: Record<string, ReadonlySet<string>> = {
  "sdd.graph_mutation": new Set(["add_node", "update_node", "remove_node", "add_relationship", "remove_relationship"]),
  "sdd.graph_admin": new Set(["prune", "learn:learn"]),
  "sdd.permissions": new Set(["set_role", "save_config"]),
  "sdd.snapshot": new Set(["create", "rollback"]),
  "sdd.sync": new Set(["pull", "push", "merge"]),
  "sdd.drift_whitelist": new Set(["add", "remove"]),
  "sdd.code_quality": new Set(["plan_implementation", "remove_dead_code", "analyze_codebase"]),
  "sdd.enterprise": new Set(["migration", "experiment", "flag", "tenant", "monitoring", "dashboard", "incident", "sla", "docs", "onboarding", "knowledge_transfer", "disaster_recovery"]),
  // Standalone tools with a mixed read/write action set (isenta o container,
  // mas exige workflow ativo para as ações mutantes).
  "sdd.milestone": new Set(["create", "add", "remove", "assign", "close"]),
  "sdd.integrate_tasks": new Set(["create", "update", "remove", "mark_integrated", "open_change", "approve_change"]),
}

/**
 * Check if a tool requires workflow context.
 * Returns null if the tool is allowed, or an error message if blocked.
 */
export function checkToolAccess(
  toolName: string,
  scope = DEFAULT_SCOPE,
  action?: unknown,
): { allowed: boolean; reason?: string } {
  // SDD tools only
  if (!toolName.startsWith("sdd.")) {
    return { allowed: true }
  }

  const mutatingActions = COMPOSITE_MUTATING_ACTIONS[toolName]
  if (mutatingActions && typeof action === "string" && mutatingActions.has(action)) {
    const workflow = isWorkflowValid(scope)
    if (!workflow.valid) {
      return {
        allowed: false,
        reason: `[SDD BLOCKED] Action "${toolName}:${action}" requires an active SDD workflow.\n\n${workflow.reason}`,
      }
    }
    return { allowed: true }
  }

  // Exempt tools are always allowed when they are read-only or workflow entry points.
  if (WORKFLOW_EXEMPT_TOOLS.has(toolName)) {
    return { allowed: true }
  }

  // Required tools need workflow context
  if (WORKFLOW_REQUIRED_TOOLS.has(toolName)) {
    const workflow = isWorkflowValid(scope)
    if (!workflow.valid) {
      return {
        allowed: false,
        reason: `[SDD BLOCKED] Tool "${toolName}" requires an active SDD workflow.\n\n${workflow.reason}\n\nWorkflow: sdd.enforce → sdd.update_from_answers → sdd.approve_change → THEN use ${toolName}`,
      }
    }
    return { allowed: true }
  }

  // Tools removidas: em vez do genérico "não classificada", redireciona para o
  // composite canônico. É o "alias de erro": o nome antigo não é anunciado nem
  // registrado, mas uma chamada residual recebe o caminho correto.
  const replacement = getCompositeForTool(toolName)
  if (replacement) {
    return {
      allowed: false,
      reason:
        `[SDD] Tool "${toolName}" foi removida — a capacidade agora é ` +
        `\`${replacement.composite}(action="${replacement.action}")\`. ` +
        `Use o caminho canônico.`,
    }
  }

  // Fail closed. New SDD tools must be explicitly classified before they can
  // mutate a project.
  return {
    allowed: false,
    reason: `[SDD BLOCKED] Tool "${toolName}" is not classified by the workflow policy.`,
  }
}
