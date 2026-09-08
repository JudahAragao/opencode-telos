import type { KnowledgeGraph, RelationshipType } from "../domain/types.js";
export interface IntegrityReport {
    orphan_nodes: OrphanInfo[];
    disconnected_groups: DisconnectedGroup[];
    redundant_relationships: RedundantRelationship[];
    fixes_applied: IntegrityFix[];
    summary: IntegritySummary;
}
/**
 * Options for controlling graph integrity check scope.
 */
export interface IntegrityCheckOptions {
    /** Auto-fix detected issues. */
    auto_fix?: boolean;
    /** Only check these specific node IDs and their neighbors. */
    focusNodeIds?: string[];
    /** Skip these check types. */
    skipChecks?: Array<"orphans" | "disconnected" | "redundant">;
    /** Only check nodes that changed since a specific timestamp. */
    changedSince?: string;
    /** Maximum disconnected groups to report. */
    maxGroups?: number;
    /** Maximum orphans to report. */
    maxOrphans?: number;
    /** Cache for disconnected group detection (graph_hash → result). */
    connectivityCache?: Map<string, {
        connected: boolean;
        groups: DisconnectedGroup[];
        timestamp: number;
    }>;
}
export interface OrphanInfo {
    node_id: string;
    node_name: string;
    node_type: string;
}
export interface DisconnectedGroup {
    group_id: number;
    node_ids: string[];
    node_names: string[];
    size: number;
    suggested_connection: {
        target_id: string;
        target_name: string;
        relationship_type: RelationshipType;
    } | null;
}
export interface RedundantRelationship {
    relationship_id: string;
    from: string;
    to: string;
    type: string;
    reason: "duplicate" | "self_loop" | "reversed_exists";
}
export interface IntegrityFix {
    action: "connected_orphan" | "merged_group" | "removed_duplicate" | "removed_self_loop" | "removed_reversed";
    details: string;
    relationship?: {
        from: string;
        to: string;
        type: string;
    };
}
export interface IntegritySummary {
    total_nodes: number;
    total_relationships: number;
    orphans_found: number;
    disconnected_groups_found: number;
    redundant_relationships_found: number;
    fixes_applied: number;
    graph_connected: boolean;
}
/**
 * Runs a full integrity check on the graph and optionally fixes issues.
 * This should be called after any graph mutation (add/remove node or relationship).
 */
export declare function ensureGraphIntegrity(graph: KnowledgeGraph, options?: IntegrityCheckOptions): IntegrityReport;
export declare function formatIntegrityReport(report: IntegrityReport): string;
