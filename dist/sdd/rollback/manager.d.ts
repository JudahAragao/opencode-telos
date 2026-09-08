import type { KnowledgeGraph } from "../domain/types.js";
export interface RollbackResult {
    success: boolean;
    method: "git" | "snapshot" | "backup" | "failed";
    details: string;
    restored_files?: string[];
}
export interface RollbackSnapshot {
    id: string;
    change_id: string;
    timestamp: string;
    graph_state: KnowledgeGraph;
    backed_up_files: Array<{
        path: string;
        backup_path: string;
    }>;
}
export interface RollbackHistory {
    rollbacks: Array<{
        id: string;
        change_id: string;
        timestamp: string;
        method: string;
        success: boolean;
    }>;
}
export declare function createSnapshot(graph: KnowledgeGraph, changeId: string, projectDir: string): RollbackSnapshot;
export declare function rollbackByGit(projectDir: string, changeId: string, options?: Pick<RollbackOptions, 'commitCache'>): RollbackResult;
export declare function rollbackBySnapshot(graph: KnowledgeGraph, changeId: string, projectDir: string, options?: Pick<RollbackOptions, 'snapshotIndex'>): RollbackResult;
export declare function rollbackByBackup(_graph: KnowledgeGraph, changeId: string, projectDir: string, options?: Pick<RollbackOptions, 'snapshotIndex'>): RollbackResult;
export declare function executeRollback(graph: KnowledgeGraph, changeId: string, projectDir: string, options?: RollbackOptions): RollbackResult;
export interface RollbackOptions {
    /** Index for O(1) snapshot lookup (changeId → snapshotId). */
    snapshotIndex?: Map<string, string>;
    /** Only look for these specific change IDs. */
    focusChangeId?: string[];
    /** Cache for git commit lookups (changeId → commitHash). */
    commitCache?: Map<string, string | null>;
    /** Only look for commits matching these change IDs. */
    focusChangeIds?: string[];
}
export declare function loadRollbackHistory(projectDir: string): RollbackHistory;
export declare function formatRollbackResult(result: RollbackResult): string;
export declare function formatRollbackHistory(history: RollbackHistory): string;
