/**
 * Graph Integrity Guard (Anti-Bypass Layer)
 *
 * Tracks a checksum of the graph state after every legitimate save.
 * On load, validates that the graph hasn't been modified outside the
 * SDD workflow tools (e.g., via Python scripts, direct YAML/DB edits).
 *
 * This prevents agents from bypassing enforcement by:
 * 1. Editing graph.yaml directly with Python
 * 2. Manipulating graph.db with raw SQL
 * 3. Editing graph files with shell commands
 */
export interface IntegrityState {
    /** Last known checksum of the graph when saved through SDD tools */
    last合法Checksum: string;
    /** Timestamp of last legitimate save */
    last合法Save: number;
    /** Number of consecutive tamper detections */
    tamperCount: number;
    /** Checksum history for rollback detection */
    checksumHistory: Array<{
        checksum: string;
        timestamp: number;
        nodeCount: number;
        relCount: number;
        changeId?: string;
    }>;
    /** Whether the graph is currently flagged as tampered */
    tampered: boolean;
    /** List of detected tamper events */
    tamperLog: Array<{
        timestamp: number;
        detected_checksum: string;
        expected_checksum: string;
        node_count_diff: number;
        rel_count_diff: number;
    }>;
}
/**
 * Compute a deterministic checksum of a KnowledgeGraph.
 * Includes nodes, relationships, and metadata for full integrity.
 */
export declare function computeGraphChecksum(graph: {
    nodes: unknown[];
    relationships: unknown[];
    metadata: unknown;
    project_id?: unknown;
    version?: unknown;
}): string;
/**
 * Record a legitimate save (called after every SDD tool mutation).
 * Updates the checksum to the current graph state.
 */
export declare function recordLegitimateSave(projectDir: string, graph: {
    nodes: unknown[];
    relationships: unknown[];
    metadata: unknown;
    project_id?: unknown;
    version?: unknown;
}, changeId?: string): string;
/**
 * Validate the current graph against the last known legitimate state.
 * Returns tamper detection result.
 */
export declare function validateGraphIntegrity(projectDir: string, graph: {
    nodes: unknown[];
    relationships: unknown[];
    metadata: unknown;
    project_id?: unknown;
    version?: unknown;
}): {
    valid: boolean;
    tampered: boolean;
    reason?: string;
    currentChecksum: string;
    expectedChecksum: string;
    nodeCountDiff: number;
    relCountDiff: number;
};
/**
 * Get the tamper log for auditing.
 */
export declare function getTamperLog(projectDir: string): IntegrityState["tamperLog"];
/**
 * Check if the graph is currently flagged as tampered.
 */
export declare function isGraphTampered(projectDir: string): boolean;
/**
 * Clear the tamper flag (only after legitimate workflow completion).
 */
export declare function clearTamperFlag(projectDir: string): void;
/**
 * Format tamper detection result for display.
 */
export declare function formatTamperReport(result: ReturnType<typeof validateGraphIntegrity>): string;
