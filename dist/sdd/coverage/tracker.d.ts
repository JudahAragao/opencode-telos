import type { KnowledgeGraph } from "../domain/types.js";
export interface CoverageItem {
    requirement_id: string;
    requirement_name: string;
    test_id?: string;
    test_name?: string;
    coverage_type: "full" | "partial" | "none";
    covered_aspects: string[];
    missing_aspects: string[];
    evidence: "explicit_relationship" | "ast_inference" | "structural_inference" | "heuristic" | "none";
}
export interface OrphanTest {
    test_id: string;
    test_name: string;
    test_path?: string;
    inferred_requirement_id?: string;
    inferred_by?: string;
}
export interface CoverageReport {
    items: CoverageItem[];
    orphan_tests: OrphanTest[];
    total_requirements: number;
    covered_count: number;
    partial_count: number;
    uncovered_count: number;
    coverage_rate: number;
    gaps: string[];
}
/**
 * Options for controlling coverage analysis scope.
 */
export interface CoverageAnalysisOptions {
    /** Only check these specific requirement IDs. */
    focusRequirements?: string[];
    /** Only check these aspects (e.g., ["security", "performance"]). */
    focusAspects?: string[];
    /** Skip these test IDs. */
    excludeTests?: string[];
    /** Skip these requirement IDs. */
    excludeRequirements?: string[];
    /** Only check requirements whose name/description contains these keywords. */
    focusKeywords?: string[];
    /** Maximum items to report. */
    maxResults?: number;
}
export declare function calculateCoverage(graph: KnowledgeGraph, options?: CoverageAnalysisOptions): CoverageReport;
export declare function formatCoverageReport(report: CoverageReport): string;
