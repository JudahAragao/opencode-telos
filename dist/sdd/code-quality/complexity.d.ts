export interface FunctionComplexity {
    name: string;
    file: string;
    line_start: number;
    line_end: number;
    cyclomatic: number;
    cognitive: number;
    lines: number;
    risk: 'low' | 'medium' | 'high' | 'very_high';
}
export interface ComplexityReport {
    functions: FunctionComplexity[];
    summary: {
        total_functions: number;
        average_cyclomatic: number;
        average_cognitive: number;
        high_risk_count: number;
        very_high_risk_count: number;
    };
}
/**
 * Options for controlling complexity analysis scope.
 */
export interface ComplexityAnalysisOptions {
    /** Only analyze functions whose name matches these patterns. */
    focusFunctions?: string[];
    /** Skip functions whose name matches these patterns. */
    excludeFunctions?: string[];
    /** Minimum risk level to include in results. */
    minRisk?: "low" | "medium" | "high" | "very_high";
    /** Only analyze files matching these name patterns (supports * wildcard). */
    focusFiles?: string[];
    /** Maximum functions to report. */
    maxResults?: number;
}
export declare function analyzeComplexity(code: string, fileName: string, options?: ComplexityAnalysisOptions): ComplexityReport;
export declare function formatComplexityReport(report: ComplexityReport): string;
