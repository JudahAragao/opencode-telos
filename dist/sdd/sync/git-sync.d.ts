import type { KnowledgeGraph } from "../domain/types.js";
export interface SyncResult {
    success: boolean;
    action: string;
    details: string;
    conflicts?: ConflictItem[];
}
export interface ConflictItem {
    node_id: string;
    field: string;
    local_value: unknown;
    remote_value: unknown;
    resolution?: "local" | "remote" | "manual";
}
export interface SyncStatus {
    has_remote: boolean;
    branch: string;
    ahead: number;
    behind: number;
    dirty: boolean;
    last_sync?: string;
}
export interface MergeStrategy {
    auto_resolve: boolean;
    field_priorities: Record<string, "local" | "remote">;
}
export interface SyncStatusOptions {
    /** Cache for sync status results. Reused if TTL not expired. */
    statusCache?: {
        status: SyncStatus;
        timestamp: number;
    };
    /** Max age in ms for cached status (default: 10000 = 10s). */
    cacheTTL?: number;
    /** Skip ahead/behind computation (faster, fewer git commands). */
    skipAheadBehind?: boolean;
}
export declare function getSyncStatus(projectDir: string, options?: SyncStatusOptions): SyncStatus;
export declare function acquireLock(projectDir: string, owner: string): boolean;
export declare function releaseLock(projectDir: string): void;
export declare function pullLatest(projectDir: string): SyncResult;
export declare function pushChanges(projectDir: string, message: string): SyncResult;
export interface ConflictDetectionOptions {
    /** Only compare these specific node IDs (skip others). */
    focusChangedNodes?: string[];
    /** Skip these node types entirely. */
    excludeNodeTypes?: string[];
    /** Max number of conflicts to report. */
    maxConflicts?: number;
    /** Cache for conflict detection results. */
    conflictCache?: {
        conflicts: ConflictItem[];
        timestamp: number;
        graphHash: string;
    };
}
export declare function detectConflicts(localGraph: KnowledgeGraph, remoteGraphPath: string, options?: ConflictDetectionOptions): ConflictItem[];
export declare function resolveConflict(conflict: ConflictItem, resolution: "local" | "remote"): ConflictItem;
export declare function mergeGraphs(local: KnowledgeGraph, remote: KnowledgeGraph, strategy: MergeStrategy): KnowledgeGraph;
export declare function formatSyncStatus(status: SyncStatus): string;
