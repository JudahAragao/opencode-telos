import type { KnowledgeGraph } from "../domain/types.js";
import { GraphIndices } from "../graph/index.js";
/**
 * A dependency rule maps a keyword pattern to the graph infrastructure
 * required to verify a promise. If the infrastructure doesn't exist
 * in the graph, the promise is marked as "unverifiable".
 *
 * The AI can configure these rules to adapt to different project types.
 */
export interface DependencyRule {
    /** Keywords that trigger this rule (any match activates it) */
    keywords: string[];
    /** Description of what this rule checks */
    description: string;
    /**
     * Function that checks if the required infrastructure exists in the graph.
     * Returns true if the promise CAN be verified (infrastructure exists).
     */
    checkExists: (graph: KnowledgeGraph, indices: GraphIndices) => boolean;
}
/**
 * Default dependency rules for infrastructure detection.
 * The AI can extend or override these per-project.
 */
export declare const DEFAULT_DEPENDENCY_RULES: DependencyRule[];
/**
 * Classify whether a promise is verifiable based on its description
 * and the current graph state.
 *
 * The AI can pass custom rules to override or extend the defaults.
 */
export declare function classifyPromiseVerifiability(description: string, graph: KnowledgeGraph, customRules?: DependencyRule[]): {
    verifiable: boolean;
    reason?: string;
};
/**
 * Batch classify a list of promises, returning those that are unverifiable.
 */
export declare function findUnverifiablePromises(promises: Array<{
    id: string;
    description: string;
    status: string;
}>, graph: KnowledgeGraph, customRules?: DependencyRule[]): Array<{
    id: string;
    description: string;
    reason: string;
}>;
