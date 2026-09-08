import type { KnowledgeGraph } from "../domain/types.js";
export interface ConstitutionViolation {
    principle_id: string;
    node_id: string;
    description: string;
    severity: "must" | "should" | "may";
}
export interface ConstitutionResult {
    violations: ConstitutionViolation[];
    score: number;
    total_principles: number;
    checked_nodes: number;
}
/**
 * Options for controlling constitution validation scope.
 */
export interface ConstitutionValidationOptions {
    /** Only validate these node types (e.g., ["entity", "endpoint"]). */
    focusNodeTypes?: string[];
    /** Only validate against these principle IDs. */
    focusPrincipleIds?: string[];
    /** Skip these principle IDs. */
    excludePrincipleIds?: string[];
    /** Skip these specific node IDs. */
    excludeNodeIds?: string[];
    /** Only validate nodes whose name/description contains these keywords. */
    focusKeywords?: string[];
    /** Skip scope regex pre-filtering (check all nodes against all principles). */
    skipScopeFilter?: boolean;
    /** Maximum violations to report. */
    maxResults?: number;
    /** Cache for previous check results (node_id+principle_id → violation or null). */
    cache?: Map<string, ConstitutionViolation | null>;
}
export declare function validateAgainstConstitution(graph: KnowledgeGraph, options?: ConstitutionValidationOptions): ConstitutionResult;
export declare function formatConstitutionResult(result: ConstitutionResult): string;
