import type { KnowledgeGraph } from "../sdd/domain/types.js";
export interface CodebaseAnalysisResult {
    files_analyzed: number;
    symbols_found: number;
    test_requirement_links: number;
    orphan_tests: string[];
}
export declare function analyzeCodebase(graph: KnowledgeGraph, projectDir: string): CodebaseAnalysisResult;
