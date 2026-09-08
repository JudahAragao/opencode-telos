import type { KnowledgeGraph, NodeType } from "../domain/types.js";
export interface LearnedPatterns {
    metadata: {
        last_updated: string;
        sample_size: number;
    };
    node_defaults: Record<string, Record<string, unknown>>;
    relationship_patterns: Array<{
        from_type: NodeType;
        to_type: NodeType;
        relationship_type: string;
        frequency: number;
    }>;
    approval_history: Record<string, number>;
    naming_conventions: Record<string, string>;
}
/**
 * Analyze the graph to learn project patterns.
 * These patterns are used for smarter defaults in new nodes.
 */
export declare function learnPatterns(graph: KnowledgeGraph): LearnedPatterns;
/**
 * Get suggested defaults for a new node based on learned patterns.
 */
export declare function getSuggestedDefaults(patterns: LearnedPatterns, nodeType: NodeType): Record<string, unknown>;
/**
 * Get suggested relationships for a new node based on learned patterns.
 */
export declare function getSuggestedRelationships(patterns: LearnedPatterns, nodeType: NodeType): Array<{
    to_type: NodeType;
    relationship_type: string;
}>;
/**
 * Get suggested naming convention for a node type.
 */
export declare function getSuggestedNaming(patterns: LearnedPatterns, nodeType: NodeType): string | undefined;
/**
 * Load learned patterns from disk.
 */
export declare function loadPatterns(projectDir: string): LearnedPatterns | null;
/**
 * Save learned patterns to disk.
 */
export declare function savePatterns(projectDir: string, patterns: LearnedPatterns): void;
/**
 * Format learned patterns as readable report.
 */
export declare function formatPatterns(patterns: LearnedPatterns): string;
