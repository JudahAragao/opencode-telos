import type { AnyNode, NodeType, Relationship } from "../domain/types.js";
import type { KnowledgeGraph } from "../domain/types.js";
interface ToolCacheEntry {
    response: string;
    timestamp: number;
    lastAccess: number;
    toolName: string;
    argsHash: string;
    graphFingerprint: string;
    configFingerprint: string;
    sourceFingerprint?: string;
}
interface AnalysisCacheEntry {
    result: unknown;
    timestamp: number;
    lastAccess: number;
    graphFingerprint: string;
    configFingerprint: string;
    sourceFingerprint?: string;
    type: string;
}
interface PersistentCacheData {
    version: number;
    toolResponses: Record<string, ToolCacheEntry>;
    analysisResults: Record<string, AnalysisCacheEntry>;
    graphSnapshot?: {
        nodeCount: number;
        relationshipCount: number;
        version: string;
        lastModified: number;
    } | null;
    graphHash?: string;
    configFingerprint?: string;
}
export declare class CacheManager {
    private projectDir;
    private toolResponses;
    private analysisResults;
    private invalidation;
    private invalidationVersionOnWrite;
    private graphCache;
    private sourceFingerprintCache;
    private invalidationJournalOffset;
    private invalidationEventCounter;
    private stats;
    constructor(projectDir: string);
    /**
     * Get cached tool response if valid.
     * Checks: TTL (using lastAccess for freshness), graph version, invalidation status.
     * F: Uses lazy revalidation — checks version before clearing.
     */
    getToolResponse(toolName: string, args: Record<string, unknown>, currentGraphFingerprint: string): string | null;
    /**
     * Cache a tool response.
     */
    setToolResponse(toolName: string, args: Record<string, unknown>, response: string, currentGraphFingerprint: string): void;
    /**
     * Get cached analysis result (validate, drift, quality, etc.).
     * Revalidates based on graph state.
     * F: Uses lazy revalidation.
     */
    getAnalysisResult(type: string, currentGraphFingerprint: string): unknown | null;
    /**
     * Cache an analysis result.
     */
    setAnalysisResult(type: string, result: unknown, currentGraphFingerprint: string): void;
    /**
     * Mark specific node IDs as dirty.
     */
    invalidateNodeIds(ids: string[]): void;
    /**
     * Mark specific relationship types as dirty.
     */
    invalidateRelTypes(types: string[]): void;
    /**
     * Full invalidation: clear everything.
     * Now reserved only for explicit reset (H) or major structural changes.
     */
    invalidateAll(): void;
    /**
     * Partial invalidation: clear only affected caches.
     * A: Much faster than full invalidation for targeted changes.
     * Called by repositories after saveGraph() with the dirty types.
     */
    invalidatePartial(changedNodeTypes: string[], changedRelTypes?: string[]): void;
    /**
     * Invalidate specific node IDs (e.g., when a node is updated).
     */
    invalidateNodeId(nodeId: string, nodeType: string): void;
    /**
     * Load persistent cache from disk.
     */
    loadPersistentCache(): PersistentCacheData | null;
    /**
     * Save persistent cache to disk.
     */
    savePersistentCache(data: PersistentCacheData): void;
    /**
     * Restore tool responses from persistent cache.
     * B: Uses lastAccess for TTL check so recently-accessed entries survive restore.
     */
    restoreFromPersistentCache(): number;
    /**
     * Persist current cache to disk.
     */
    persistToDisk(): void;
    /**
     * Save graph snapshot to disk (G).
     * Called after graph mutations and on dispose.
     */
    saveGraphSnapshot(graph: KnowledgeGraph, sourceSignature?: string): void;
    /**
     * Load graph snapshot from disk (G).
     * Returns null if no valid snapshot exists.
     */
    loadGraphSnapshot(): {
        graph: KnowledgeGraph;
        graphHash: string;
        sourceSignature: string;
    } | null;
    /**
     * Invalidate graph snapshot on disk.
     */
    invalidateGraphSnapshot(): void;
    /**
     * D: Check if another process has modified the graph since our last read.
     * Uses file-based locking + PID liveness check for robust cross-process coordination.
     */
    checkCrossProcessInvalidation(_graphPath: string): boolean;
    /**
     * Acquire cross-process lock before writing.
     */
    acquireWriteLock(): boolean;
    /**
     * Release cross-process lock.
     */
    releaseWriteLock(): void;
    /**
     * H: Full cache reset — clears everything in memory and on disk.
     * Used by /sdd cache reset command.
     */
    fullReset(): {
        cleared: {
            memory: boolean;
            disk: boolean;
            snapshot: boolean;
            lock: boolean;
        };
    };
    /**
     * Get current invalidation version (for external checks).
     */
    getInvalidationVersion(): number;
    /**
     * Sync invalidation version after external write.
     */
    syncInvalidationVersion(): void;
    /** Refresh cache state from durable invalidation events written by another process. */
    refreshExternalInvalidation(): boolean;
    /**
     * Get cached nodes for a specific type.
     * Only returns if the cache version matches.
     */
    getCachedNodesByType(type: NodeType, graphFingerprint: string): AnyNode[] | null;
    /**
     * Cache nodes for a specific type.
     */
    setCachedNodesByType(type: NodeType, nodes: AnyNode[], graphFingerprint: string): void;
    /**
     * Invalidate cache for a specific node type only.
     * Other types remain cached.
     */
    invalidateNodeType(type: NodeType): void;
    /**
     * Invalidate cache for multiple node types.
     */
    invalidateNodeTypes(types: string[]): void;
    /**
     * Get cached relationships.
     */
    getCachedRelationships(graphFingerprint: string): Relationship[] | null;
    /**
     * Cache relationships.
     */
    setCachedRelationships(rels: Relationship[], graphFingerprint: string): void;
    getStats(): {
        toolCacheSize: number;
        analysisCacheSize: number;
        invalidationVersion: number;
        hitRate: string;
        analysisHitRate: string;
        toolHits: number;
        toolMisses: number;
        analysisHits: number;
        analysisMisses: number;
        invalidations: number;
    };
    private toolCacheKey;
    private isToolAffectedByInvalidation;
    private isAnalysisAffectedByInvalidation;
    /**
     * Clear dirty types that are relevant to a specific analysis type.
     * Called after the analysis cache entry has been invalidated due to dirty types.
     * This allows the cache to work again after the analysis is recomputed.
     */
    private clearDirtyTypesForAnalysis;
    /**
     * Clear dirty types that are relevant to a specific tool.
     */
    private clearDirtyTypesForTool;
    private getToolDependentTypes;
    private getAnalysisDependentTypes;
    private getAnalysisTypesForNodeType;
    private doesToolDependOnTypes;
    private doesAnalysisDependOnTypes;
    private evictOldestToolEntries;
    private loadInvalidationTracker;
    private saveInvalidationTracker;
    private appendInvalidationEvent;
    private toolNeedsSource;
    private analysisNeedsSource;
    private getSourceFingerprint;
}
export declare function getCacheManager(projectDir: string): CacheManager;
export {};
