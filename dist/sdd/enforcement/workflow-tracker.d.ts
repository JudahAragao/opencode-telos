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
    enforced: boolean;
    /** Change node ID created by sdd.enforce */
    changeId: string | null;
    /** Whether the current change has been approved */
    approved: boolean;
    /** Whether sdd.validate has passed since last enforce */
    validated: boolean;
    /** Timestamp of last enforce call */
    enforcedAt: number;
    /** Whether discovery is in progress (sdd.discover was called) */
    discovering: boolean;
    /** Whether the SDD spec has been updated since last enforce (add_node, update_node, update_from_answers) */
    specUpdated: boolean;
}
/** Isolate concurrent OpenCode sessions while retaining directory-only API compatibility. */
export declare function workflowScope(projectDir: string, sessionId?: string): string;
/** Reset workflow state (called on session start or /sdd off) */
export declare function resetWorkflowState(scope?: string): void;
/** Mark that sdd.enforce was called */
export declare function markEnforced(changeId: string, scope?: string): void;
/** Mark that the change was approved */
export declare function markApproved(scope?: string): void;
/** Mark that sdd.validate passed */
export declare function markValidated(scope?: string): void;
/** Mark that discovery is in progress */
export declare function markDiscovering(discovering: boolean, scope?: string): void;
/** Mark that the SDD spec has been updated (add_node, update_node, update_from_answers) */
export declare function markSpecUpdated(scope?: string): void;
/** Mark that the change was completed (resets state) */
export declare function markCompleted(scope?: string): void;
/**
 * Janela de validade de um workflow ativo.
 *
 * Uma tarefa longa (refactor amplo, migração) estourava o prazo de 30 min no
 * meio da implementação e invalidava o laudo de verificação já gravado; a única
 * saída era repetir `sdd.enforce`, que cria um Change NOVO e deixa o anterior
 * órfão. `sdd.renew_workflow` / `/sdd renew` renova a janela do MESMO Change,
 * preservando o laudo. Override: `SDD_WORKFLOW_TTL_MS`.
 */
export declare function workflowTtlMs(): number;
/** Check if workflow is in a valid state for graph mutations */
export declare function isWorkflowValid(scope?: string): {
    valid: boolean;
    reason?: string;
};
/** Tempo restante da janela do workflow, em ms (0 quando não há workflow ativo). */
export declare function workflowRemainingMs(scope?: string): number;
export interface WorkflowRenewResult {
    renewed: boolean;
    changeId: string | null;
    /** Epoch ms em que a janela (possivelmente renovada) expira; null sem workflow ativo. */
    expiresAt: number | null;
    reason?: string;
}
/**
 * Renova a janela do workflow ativo preservando o MESMO Change — e portanto o
 * laudo de verificação em `.sdd/verification/<changeId>.json`, que continuaria
 * válido porque nada do código mudou. Sem workflow ativo, ou com um changeId
 * diferente do ativo, recusa em vez de criar silenciosamente outro workflow.
 */
export declare function renewWorkflow(changeId?: string, scope?: string): WorkflowRenewResult;
/** Get current workflow state (read-only) */
export declare function getWorkflowState(scope?: string): Readonly<WorkflowState>;
/**
 * Tools that are ALLOWED without workflow context.
 * These are read-only or workflow-entry tools.
 */
export declare const WORKFLOW_EXEMPT_TOOLS: Set<string>;
/**
 * Tools that REQUIRE workflow context (graph mutations).
 * These modify the SDD graph and must go through the workflow.
 */
export declare const WORKFLOW_REQUIRED_TOOLS: Set<string>;
/**
 * Check if a tool requires workflow context.
 * Returns null if the tool is allowed, or an error message if blocked.
 */
export declare function checkToolAccess(toolName: string, scope?: string, action?: unknown): {
    allowed: boolean;
    reason?: string;
};
