import type { KnowledgeGraph } from "../domain/types.js";
export interface Contradiction {
    node_a: string;
    node_b: string;
    type: "requirement_conflict" | "rule_conflict" | "cross_type_conflict";
    description: string;
    severity: "error" | "warning";
}
export interface ContradictionReport {
    contradictions: Contradiction[];
    total: number;
    by_type: Record<string, number>;
}
/**
 * Options for controlling contradiction detection scope.
 */
export interface ContradictionDetectionOptions {
    /** Only check these node types (e.g., ["requirement", "business_rule"]). */
    focusNodeTypes?: string[];
    /** Only check nodes whose name/description contains these keywords. */
    focusKeywords?: string[];
    /** Only check nodes in these domains (matched against node name/description). */
    focusDomains?: string[];
    /** Skip these specific node IDs. */
    excludeNodeIds?: string[];
    /** Skip these contradiction types. */
    excludeTypes?: Array<"requirement_conflict" | "rule_conflict" | "cross_type_conflict">;
    /** Already verified node pairs — skip these. */
    alreadyVerified?: Array<{
        node_a: string;
        node_b: string;
    }>;
    /** Maximum number of contradictions to report. */
    maxResults?: number;
}
export declare function detectContradictions(graph: KnowledgeGraph, options?: ContradictionDetectionOptions): ContradictionReport;
export declare function formatContradictionReport(report: ContradictionReport): string;
