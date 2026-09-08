import type { KnowledgeGraph } from "../domain/types.js";
export interface EnforcementResult {
    allowed: boolean;
    reason: string;
    change_id?: string;
    validation_passed: boolean;
    sdd_updated: boolean;
    impact_summary?: string;
    blocking_reasons?: string[];
}
/**
 * Options for controlling enforcement behavior.
 */
export interface EnforcementOptions {
    /** Project directory used for persisted graph integrity checks. */
    projectDir?: string;
    /** Skip impact analysis (faster for simple changes). */
    skipImpactAnalysis?: boolean;
    /** Skip validation (if already validated recently). */
    skipValidation?: boolean;
    /** Force a specific approval level. */
    forceApprovalLevel?: "AUTO" | "REVIEW" | "APPROVAL";
    /** Maximum depth for impact analysis traversal. */
    maxImpactDepth?: number;
    /** Cache for validation results (graph_version → result). */
    validationCache?: Map<string, {
        valid: boolean;
        errors: any[];
        timestamp: number;
    }>;
}
export interface ChangeRequest {
    type: "add_functionality" | "modify_functionality" | "delete_functionality" | "bug_fix" | "refactor" | "architecture_change";
    description: string;
    affected_files?: string[];
    affected_entities?: string[];
}
export declare function classifyChangeRequest(description: string): ChangeRequest;
export declare function enforceSddFirst(graph: KnowledgeGraph, request: ChangeRequest, options?: EnforcementOptions): EnforcementResult;
export declare function buildEnforcementPrompt(request: ChangeRequest, result: EnforcementResult): string;
/**
 * Smart batch enforcement: for AUTO-level changes, execute the full cycle
 * (create change → validate → approve) in one call without user interaction.
 */
export declare function enforceSmartBatch(graph: KnowledgeGraph, request: ChangeRequest, affectedEntities?: string[], affectedFiles?: string[], options?: EnforcementOptions): EnforcementResult & {
    auto_completed: boolean;
};
export declare function getSddEnforcementRules(): string;
