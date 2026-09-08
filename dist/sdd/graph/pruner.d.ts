import type { KnowledgeGraph } from "../domain/types.js";
export interface PruneReport {
    removed_nodes: Array<{
        id: string;
        type: string;
        name: string;
        reason: string;
    }>;
    deprecated_changes: string[];
    total_removed: number;
    total_deprecated: number;
    space_freed_estimate: string;
}
/**
 * Prune obsolete nodes from the graph:
 * - FileNodes pointing to deleted files
 * - SymbolNodes pointing to non-existent symbols
 * - TestNodes for deleted test files
 * - Old completed ChangeNodes (>30 days)
 * - Duplicate relationships
 */
export declare function pruneGraph(graph: KnowledgeGraph, projectDir: string): PruneReport;
/**
 * Format prune report as readable markdown.
 */
export declare function formatPruneReport(report: PruneReport): string;
