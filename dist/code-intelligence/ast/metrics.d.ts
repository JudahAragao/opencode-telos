import type { ParsedFile } from "./ir.js";
export interface AstExpectation {
    symbols?: string[];
    imports?: string[];
    exports?: string[];
}
export interface AstMetric {
    precision: number;
    recall: number;
    true_positive: number;
    false_positive: number;
    false_negative: number;
}
export interface AstQualityReport {
    file: string;
    parser: string;
    source: "ast" | "fallback";
    symbols: AstMetric;
    imports: AstMetric;
    exports: AstMetric;
    diagnostics: number;
}
export declare function evaluateParsedFile(parsed: ParsedFile, expected: AstExpectation): AstQualityReport;
export declare function averageAstMetric(reports: AstQualityReport[], key: "symbols" | "imports" | "exports"): AstMetric;
