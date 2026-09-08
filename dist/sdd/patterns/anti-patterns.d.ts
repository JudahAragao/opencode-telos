import type { KnowledgeGraph } from "../domain/types.js";
export interface AntiPattern {
    type: string;
    description: string;
    node_id?: string;
    file?: string;
    severity: "error" | "warning" | "info";
    suggestion: string;
}
export interface AntiPatternResult {
    patterns: AntiPattern[];
    total: number;
    by_severity: {
        error: number;
        warning: number;
        info: number;
    };
}
export declare function detectAntiPatterns(graph: KnowledgeGraph): AntiPatternResult;
export declare function formatAntiPatterns(result: AntiPatternResult): string;
