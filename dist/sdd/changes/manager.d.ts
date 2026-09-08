import type { KnowledgeGraph, ChangeNode, ApprovalLevel, AnyNode, SpecPromise } from "../domain/types.js";
export interface ChangeProposal {
    title: string;
    reason: string;
    affected_node_ids: string[];
    new_nodes: Partial<AnyNode>[];
    modified_nodes: Array<{
        id: string;
        updates: Partial<AnyNode>;
    }>;
    removed_node_ids: string[];
    affected_files: string[];
    affected_tests: string[];
    implementation_tasks: string[];
}
export declare function classifyApprovalLevel(proposal: ChangeProposal, graph: KnowledgeGraph): ApprovalLevel;
export interface ChangeCreationOptions {
    /** Skip impact analysis entirely (faster for simple changes). */
    skipImpactAnalysis?: boolean;
    /** Cache for impact results (nodeId → impacted nodes). Reused across calls. */
    impactCache?: Map<string, AnyNode[]>;
    /** Max depth for impact traversal (default: 3). */
    maxImpactDepth?: number;
    /** Only compute impact for these node IDs (ignore others). */
    focusAffectedNodes?: string[];
    /** Cache for promise extraction results. */
    promiseCache?: Map<string, SpecPromise[]>;
}
export declare function createChange(graph: KnowledgeGraph, proposal: ChangeProposal, options?: ChangeCreationOptions): ChangeNode;
export declare function approveChange(graph: KnowledgeGraph, changeId: string): void;
export interface CompletionCheckResult {
    allowed: boolean;
    reason: string;
    pending_promises: Array<{
        id: string;
        description: string;
        source_node_id: string;
    }>;
}
/**
 * Check if a change can be completed. Blocks if there are pending promises
 * on nodes affected by the change that haven't been verified.
 */
export declare function checkChangeCompletion(graph: KnowledgeGraph, changeId: string, options?: Pick<ChangeCreationOptions, 'promiseCache' | 'focusAffectedNodes'>): CompletionCheckResult;
export declare function completeChange(graph: KnowledgeGraph, changeId: string): void;
/**
 * Complete a change with promise validation. Returns a result indicating
 * whether the completion was allowed or blocked by pending promises.
 */
export declare function completeChangeWithPromiseCheck(graph: KnowledgeGraph, changeId: string, force?: boolean): {
    completed: boolean;
    result: CompletionCheckResult;
};
export declare function failChange(graph: KnowledgeGraph, changeId: string, reason: string): void;
export declare function getPendingChanges(graph: KnowledgeGraph): ChangeNode[];
export declare function getChangeHistory(graph: KnowledgeGraph): ChangeNode[];
export declare function formatImpactReport(graph: KnowledgeGraph, changeId: string): string;
