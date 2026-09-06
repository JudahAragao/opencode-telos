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

const state: WorkflowState = {
  enforced: false,
  changeId: null,
  approved: false,
  validated: false,
  enforcedAt: 0,
  discovering: false,
  specUpdated: false,
}

/** Reset workflow state (called on session start or /sdd off) */
export function resetWorkflowState(): void {
  state.enforced = false
  state.changeId = null
  state.approved = false
  state.validated = false
  state.enforcedAt = 0
  state.discovering = false
  state.specUpdated = false
}

/** Mark that sdd.enforce was called */
export function markEnforced(changeId: string): void {
  state.enforced = true
  state.changeId = changeId
  state.approved = false
  state.validated = false
  state.enforcedAt = Date.now()
  state.specUpdated = false
}

/** Mark that the change was approved */
export function markApproved(): void {
  state.approved = true
}

/** Mark that sdd.validate passed */
export function markValidated(): void {
  state.validated = true
}

/** Mark that discovery is in progress */
export function markDiscovering(discovering: boolean): void {
  state.discovering = discovering
}

/** Mark that the SDD spec has been updated (add_node, update_node, update_from_answers) */
export function markSpecUpdated(): void {
  state.specUpdated = true
}

/** Mark that the change was completed (resets state) */
export function markCompleted(): void {
  state.enforced = false
  state.changeId = null
  state.approved = false
  state.validated = false
  state.enforcedAt = 0
  state.specUpdated = false
}

/** Check if workflow is in a valid state for graph mutations */
export function isWorkflowValid(): { valid: boolean; reason?: string } {
  if (!state.enforced) {
    return {
      valid: false,
      reason: "No SDD workflow active. Call sdd.enforce first to classify the change and create a Change node.",
    }
  }

  // Allow a 30-minute window for workflow completion
  const maxAge = 30 * 60 * 1000
  if (Date.now() - state.enforcedAt > maxAge) {
    return {
      valid: false,
      reason: "SDD workflow expired (>30 min). Call sdd.enforce again.",
    }
  }

  return { valid: true }
}

/** Get current workflow state (read-only) */
export function getWorkflowState(): Readonly<WorkflowState> {
  return { ...state }
}

/**
 * Tools that are ALLOWED without workflow context.
 * These are read-only or workflow-entry tools.
 */
export const WORKFLOW_EXEMPT_TOOLS = new Set([
  "sdd.initialize",
  "sdd.inspect",
  "sdd.query_graph",
  "sdd.list_nodes",
  "sdd.count_nodes",
  "sdd.get_nodes_by_status",
  "sdd.get_context",
  "sdd.find_path",
  "sdd.analyze_impact",
  "sdd.validate",
  "sdd.detect_drift",
  "sdd.config_drift",
  "sdd.detect_sync_conflicts",
  "sdd.quality",
  "sdd.contradictions",
  "sdd.verify_usage",
  "sdd.find_dead_code",
  "sdd.parse_symbols",
  "sdd.analyze_complexity",
  "sdd.code_metrics",
  "sdd.detect_smells",
  "sdd.analyze_dependencies",
  "sdd.anti_patterns",
  "sdd.clone_detection",
  "sdd.promises",
  "sdd.coverage",
  "sdd.check_compliance",
  "sdd.security_audit",
  "sdd.analyze_scalability",
  "sdd.traverse_outgoing",
  "sdd.traverse_incoming",
  "sdd.traverse_both",
  "sdd.get_subgraph",
  "sdd.pending_changes",
  "sdd.list_snapshots",
  "sdd.sync_status",
  "sdd.remote_status",
  "sdd.mcp_server_info",
  "sdd.handle_mcp_tool",
  // Workflow entry points (start the workflow)
  "sdd.enforce",
  "sdd.enforce_rules",
  "sdd.discover",
  "sdd.update_from_answers",
  "sdd.create_change",
  "sdd.approve_change",
  "sdd.complete_change",
  "sdd.verify_implementation",
  // Enterprise workflows (they manage their own enforcement)
  "sdd.bug_fix",
  "sdd.hotfix",
  "sdd.refactoring",
  "sdd.deprecate",
  "sdd.create_migration",
  "sdd.create_experiment",
  "sdd.create_flag",
  "sdd.create_tenant",
  "sdd.onboard_developer",
  "sdd.report_incident",
  "sdd.create_sla",
  "sdd.estimate_cost",
  "sdd.generate_docs",
  "sdd.knowledge_transfer",
  "sdd.disaster_recovery_plan",
  "sdd.setup_monitoring",
  "sdd.generate_dashboard",
  // Toggle and config
  "sdd.toggle",
  "sdd.toggle_status",
  "sdd.constitution",
  // Session and export
  "sdd.session_handoff",
  "sdd.workflow_export",
  // Permissions
  "sdd.load_permissions_config",
  "sdd.save_permissions_config",
  "sdd.check_permission",
  "sdd.check_change_approval",
  "sdd.set_role",
  "sdd.get_user_role",
  "sdd.audit_log",
  "sdd.detect_remote",
  // Infrastructure
  "sdd.install_hooks",
  "sdd.brownfield_scan",
  "sdd.start_dashboard",
  "sdd.generate_cicd",
  // Sync
  "sdd.sync_pull",
  "sdd.sync_push",
  "sdd.merge_graphs",
  // Rollback
  "sdd.rollback",
  "sdd.rollback_history",
  "sdd.create_snapshot",
  // Graph build
  "sdd.build_graph",
])

/**
 * Tools that REQUIRE workflow context (graph mutations).
 * These modify the SDD graph and must go through the workflow.
 */
export const WORKFLOW_REQUIRED_TOOLS = new Set([
  "sdd.add_node",
  "sdd.update_node",
  "sdd.remove_node",
  "sdd.add_relationship",
  "sdd.remove_relationship",
  "sdd.generate_code",
  "sdd.remove_dead_code",
])

/**
 * Check if a tool requires workflow context.
 * Returns null if the tool is allowed, or an error message if blocked.
 */
export function checkToolAccess(toolName: string): { allowed: boolean; reason?: string } {
  // SDD tools only
  if (!toolName.startsWith("sdd.")) {
    return { allowed: true }
  }

  // Exempt tools are always allowed
  if (WORKFLOW_EXEMPT_TOOLS.has(toolName)) {
    return { allowed: true }
  }

  // Required tools need workflow context
  if (WORKFLOW_REQUIRED_TOOLS.has(toolName)) {
    const workflow = isWorkflowValid()
    if (!workflow.valid) {
      return {
        allowed: false,
        reason: `[SDD BLOCKED] Tool "${toolName}" requires an active SDD workflow.\n\n${workflow.reason}\n\nWorkflow: sdd.enforce → sdd.update_from_answers → sdd.approve_change → THEN use ${toolName}`,
      }
    }
    return { allowed: true }
  }

  // Unknown SDD tools are allowed (future tools)
  return { allowed: true }
}
