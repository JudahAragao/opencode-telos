import type { KnowledgeGraph } from '../domain/types.js';
export interface ScalabilityAnalysisResult {
    bottlenecks: Array<{
        type: string;
        location: string;
        impact: 'high' | 'medium' | 'low';
        description: string;
        recommendation: string;
    }>;
    score: number;
    recommendations: string[];
}
export declare function analyzeScalability(graph: KnowledgeGraph): ScalabilityAnalysisResult;
export declare function formatScalabilityAnalysis(result: ScalabilityAnalysisResult): string;
