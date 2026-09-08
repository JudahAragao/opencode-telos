export interface CodeSmell {
    type: string;
    name: string;
    severity: 'info' | 'warning' | 'error';
    location: string;
    description: string;
    recommendation: string;
}
export interface CodeSmellReport {
    smells: CodeSmell[];
    summary: {
        total_smells: number;
        by_type: Record<string, number>;
        by_severity: Record<string, number>;
    };
}
/**
 * Options for controlling code smell detection scope.
 */
export interface CodeSmellDetectionOptions {
    /** Only detect these smell types (e.g., ["god_class", "long_method"]). */
    focusSmells?: string[];
    /** Skip these smell types. */
    excludeSmells?: string[];
    /** Only analyze files matching these name patterns (supports * wildcard). */
    focusFiles?: string[];
    /** Minimum severity to report ("info" | "warning" | "error"). */
    minSeverity?: "info" | "warning" | "error";
    /** Maximum smells to report. */
    maxResults?: number;
    /** Cache for file analysis results (file_name → smells). Reuse if file unchanged. */
    fileCache?: Map<string, CodeSmellReport>;
    /** Hash of file content to check cache validity. */
    contentHash?: string;
}
export declare function detectCodeSmells(code: string, fileName: string, options?: CodeSmellDetectionOptions): CodeSmellReport;
export declare function formatCodeSmellReport(report: CodeSmellReport): string;
