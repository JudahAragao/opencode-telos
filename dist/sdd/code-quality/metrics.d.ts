export interface FunctionMetrics {
    name: string;
    file: string;
    line_start: number;
    line_end: number;
    lines_of_code: number;
    nesting_depth: number;
    parameter_count: number;
    LOC: number;
    LLOC: number;
    SLOC: number;
    comments: number;
    blank_lines: number;
}
export interface CodeMetricsReport {
    functions: FunctionMetrics[];
    file_summary: {
        total_lines: number;
        total_code_lines: number;
        total_comment_lines: number;
        total_blank_lines: number;
        average_function_length: number;
        longest_function: string;
        shortest_function: string;
    };
    issues: Array<{
        type: string;
        function: string;
        severity: 'warning' | 'error';
        message: string;
    }>;
}
export declare function analyzeMetrics(code: string, fileName: string): CodeMetricsReport;
export declare function formatMetricsReport(report: CodeMetricsReport): string;
