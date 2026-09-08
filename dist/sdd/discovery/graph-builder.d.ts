import type { KnowledgeGraph } from "../domain/types.js";
import type { BriefingDeepAnalysis } from "./briefing-analyzer.js";
export interface GraphBuildResult {
    nodesCreated: number;
    relationshipsCreated: number;
    byType: Record<string, number>;
    summary: string;
}
export declare function buildGraphFromAnalysis(graph: KnowledgeGraph, analysis: BriefingDeepAnalysis): GraphBuildResult;
