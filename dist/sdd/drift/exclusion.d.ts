import type { KnowledgeGraph } from "../domain/types.js";
/**
 * Collects all node IDs that were removed by completed or approved changes.
 * Nodes removed via ChangeNode should not be flagged as drift or cause
 * false positives in validation, coverage, contradictions, etc.
 */
export declare function getRemovedNodeIds(graph: KnowledgeGraph): Set<string>;
/**
 * Collects all node IDs that were deprecated via DeprecationNode relationships.
 */
export declare function getDeprecatedNodeIds(graph: KnowledgeGraph): Set<string>;
/**
 * Checks if a node should be excluded, also considering DEPRECATED status.
 */
export declare function isNodeExcludedOrDeprecated(nodeId: string, status: string, removedIds: Set<string>, deprecatedIds: Set<string>): boolean;
/**
 * Convenience: pre-compute both sets at once.
 */
export declare function getExclusionSets(graph: KnowledgeGraph): {
    removed: Set<string>;
    deprecated: Set<string>;
};
export interface DriftWhitelistEntry {
    file_path: string;
    reason: string;
    added_at: string;
    added_by?: string;
}
export interface DriftWhitelist {
    version: number;
    entries: DriftWhitelistEntry[];
}
/**
 * Load the drift whitelist from disk.
 */
export declare function loadDriftWhitelist(projectDir: string): DriftWhitelist;
/**
 * Save the drift whitelist to disk.
 */
export declare function saveDriftWhitelist(projectDir: string, whitelist: DriftWhitelist): void;
/**
 * Add a file to the drift whitelist.
 */
export declare function addToDriftWhitelist(projectDir: string, filePath: string, reason: string, addedBy?: string): DriftWhitelist;
/**
 * Remove a file from the drift whitelist.
 */
export declare function removeFromDriftWhitelist(projectDir: string, filePath: string): DriftWhitelist;
/**
 * Check if a file path matches any whitelist pattern (supports wildcards).
 * E.g., "src/validators/*" matches all files in src/validators/
 */
export declare function isFileWhitelistedPattern(projectDir: string, filePath: string): boolean;
