import type { KnowledgeGraph, ChangeNode, DecisionNode, AnyNode, SpecPromise } from "../domain/types.js";
export interface SessionHandoff {
    project_id: string;
    last_session: string;
    active_changes: ChangeNode[];
    pending_promises: SpecPromise[];
    quality_score: number;
    recent_decisions: DecisionNode[];
    blocked_items: AnyNode[];
    summary: string;
}
export interface HandoffOptions {
    /** Skip quality score calculation (faster handoff). */
    skipQualityCheck?: boolean;
    /** Cached quality score to reuse. */
    qualityCache?: {
        score: number;
        timestamp: number;
    };
    /** Max age in ms for quality cache (default: 60000). */
    qualityCacheMaxAge?: number;
    /** Skip cycle detection in graph health (DFS O(V+E)). */
    skipCycleDetection?: boolean;
    /** Only analyze these node types in health check. */
    focusNodeTypes?: string[];
}
export declare function generateHandoff(graph: KnowledgeGraph, projectDir: string, options?: HandoffOptions): SessionHandoff;
/**
 * Compute graph health indicators for proactive monitoring.
 */
export interface GraphHealth {
    staleChanges: number;
    staleChangeIds: string[];
    cyclesDetected: number;
    godNodes: Array<{
        id: string;
        name: string;
        relCount: number;
    }>;
    orphanChanges: number;
    draftEndpoints: number;
}
export interface GraphHealthOptions {
    /** Skip cycle detection (DFS O(V+E)). */
    skipCycleDetection?: boolean;
    /** Only check these node types for god nodes and orphans. */
    focusNodeTypes?: string[];
}
export declare function computeGraphHealth(graph: KnowledgeGraph, options?: GraphHealthOptions): GraphHealth;
export declare function formatHandoffPack(handoff: SessionHandoff): string;
export declare function saveSessionLog(projectDir: string, action: string): void;
