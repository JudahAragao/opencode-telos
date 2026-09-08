import type { KnowledgeGraph } from "../domain/types.js";
export interface QualityFactor {
    name: string;
    score: number;
    weight: number;
    details: string;
}
export interface QualityReport {
    score: number;
    trend: "improving" | "stable" | "declining";
    factors: QualityFactor[];
    history: Array<{
        timestamp: string;
        score: number;
    }>;
}
/**
 * Options for controlling quality scoring scope.
 */
export interface QualityScoringOptions {
    /** Only calculate these specific factors. */
    focusFactors?: string[];
    /** Skip these factors (use cached results instead). */
    skipFactors?: string[];
    /** Skip drift detection (uses cached result). */
    skipDrift?: boolean;
    /** Skip promise calculation (uses cached result). */
    skipPromises?: boolean;
    /** Skip constitution check (uses cached result). */
    skipConstitution?: boolean;
    /** Skip validation (uses cached result). */
    skipValidation?: boolean;
    /** Cache for individual factor scores (factor_name → score). Reuse if provided. */
    factorCache?: Map<string, {
        score: number;
        details: string;
        timestamp: number;
    }>;
    /** Maximum age in ms for cached factors to be considered fresh (default: 60000 = 1 min). */
    cacheMaxAge?: number;
}
export declare function calculateQualityScore(graph: KnowledgeGraph, projectDir: string, options?: QualityScoringOptions): QualityReport;
export declare function formatQualityReport(report: QualityReport): string;
