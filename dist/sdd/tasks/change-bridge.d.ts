/**
 * Task → Change bridge.
 *
 * A Kanban task is only a work item: it declares intent, not the authorization
 * to touch code. In this plugin the write hook only accepts Write/Edit on files
 * covered by an APPROVED `change` node, so an integrated task still has no way
 * to produce code.
 *
 * This module closes that gap deterministically, reusing the existing pieces:
 *   - `createChange` (src/sdd/changes/manager.ts) builds the ChangeNode with
 *     impact analysis, approval level and the `affected_files` scope;
 *   - `preflightChangeScope` tells whether the scope is complete enough for the
 *     write hook (no `affected_files` ⇒ every Write/Edit is refused);
 *   - `approveChange` opens the gate for AUTO-level changes.
 *
 * Nothing here generates code. It opens the Change and hands the agent a prompt
 * that says exactly which files are covered — the implementation itself stays in
 * the normal SDD loop (enforce → write → test → complete_change).
 */
import type { ApprovalLevel, ChangeNode, KnowledgeGraph, TaskNode } from "../domain/types.js";
export interface OpenChangeInput {
    /** Overrides the file scope; defaults to `task.metadata.files`. */
    files?: string[];
    /**
     * Approve AUTO-level changes automatically (default: true). REVIEW/APPROVAL
     * changes are never approved unless `approve` is explicitly set.
     */
    autoApprove?: boolean;
    /** Explicit human approval — required for REVIEW/APPROVAL level changes. */
    approve?: boolean;
    /** Declare that no specified behaviour changes (skips requirement evidence). */
    noRequirementImpact?: boolean;
}
export interface OpenChangeResult {
    change: ChangeNode;
    /** false when the task already had a Change (idempotent re-run). */
    created: boolean;
    /** true when the Change is APPROVED and the write hook accepts its files. */
    approved: boolean;
    approval_level: ApprovalLevel;
    affected_files: string[];
    affected_nodes: string[];
    /** Reasons the Change cannot be used yet (approval or incomplete scope). */
    blockers: string[];
    warnings: string[];
}
/** The Change already attached to a task, if any. */
export declare function findTaskChange(graph: KnowledgeGraph, taskId: string): ChangeNode | undefined;
/**
 * Open (or return) the SDD Change for a task.
 *
 * Idempotent: calling it twice returns the same Change instead of stacking
 * duplicates. With `approve` (or an AUTO-level change) the Change becomes
 * APPROVED, which is what the write hook requires, and the task moves to
 * `in_progress` because the work has effectively started.
 */
export declare function openChangeForTask(graph: KnowledgeGraph, taskId: string, input?: OpenChangeInput): OpenChangeResult;
/**
 * Prompt that asks the agent to implement the approved Change (i.e. to actually
 * write the code the task described). Deterministic text, no LLM call here.
 */
export declare function buildChangeImplementationPrompt(change: ChangeNode, task: TaskNode): string;
/** Human-readable summary used by the tools and the `/sdd tasks change` command. */
export declare function formatOpenChangeResult(result: OpenChangeResult): string;
/** Tasks that already produced a Change but still need approval to unfold. */
export declare function getTasksAwaitingChangeApproval(graph: KnowledgeGraph): Array<{
    task: TaskNode;
    change: ChangeNode;
}>;
