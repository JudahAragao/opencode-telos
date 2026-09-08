import type { KnowledgeGraph } from "../domain/types.js";
export interface MutantDuplicate {
    file_a: string;
    file_b: string;
    similarity: number;
}
/**
 * Options for controlling duplicate detection scope.
 * The AI can use these to focus or exclude specific areas.
 */
export interface DuplicateDetectionOptions {
    /** Only scan these paths (relative to projectDir). If empty, scan all. */
    focusPaths?: string[];
    /** Exclude paths matching these patterns (supports glob-like wildcards). */
    excludePatterns?: string[];
    /** Exclude these specific file paths (exact match). */
    excludeFiles?: string[];
    /** Already verified file pairs — skip these to avoid re-checking. */
    alreadyVerified?: Array<{
        file_a: string;
        file_b: string;
    }>;
    /** Minimum similarity threshold (default 0.85). */
    similarityThreshold?: number;
}
export interface ArchitectureViolation {
    file: string;
    import_path: string;
    from_layer: string;
    to_layer: string;
}
export interface PatternFragmentation {
    entity: string;
    similar_functions: string[];
    pattern: string;
}
export interface TemporalVolatility {
    file_a: string;
    file_b: string;
    co_occurrence_count: number;
    change_ids: string[];
}
export interface DriftSignals {
    mutant_duplicates: MutantDuplicate[];
    architecture_violations: ArchitectureViolation[];
    pattern_fragmentation: PatternFragmentation[];
    temporal_volatility: TemporalVolatility[];
    total_signals: number;
}
export declare function detectAllSignals(graph: KnowledgeGraph, projectDir: string, options?: DuplicateDetectionOptions): DriftSignals;
export declare function formatDriftSignals(signals: DriftSignals): string;
