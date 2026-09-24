import type { AnyNode, GuidanceNode, KnowledgeGraph } from "../domain/types.js";
import { type NodeImpactResult } from "../impact/service.js";
export interface GuidanceInput {
    instruction: string;
    requested_by: string;
    priority?: GuidanceNode["metadata"]["priority"];
    scope?: string;
}
export declare function createGuidance(graph: KnowledgeGraph, targetNodeId: string, input: GuidanceInput): GuidanceNode;
export declare function analyzeGuidance(graph: KnowledgeGraph, guidanceId: string, maxDepth?: number): {
    guidance: GuidanceNode;
    impact: NodeImpactResult;
};
export declare function proposeGuidancePatch(graph: KnowledgeGraph, guidanceId: string, proposal: Record<string, unknown>): GuidanceNode;
export declare function applyGuidancePatch(graph: KnowledgeGraph, guidanceId: string, proposal: Record<string, unknown>, actor: string, expectedTargetVersion?: number): {
    guidance: GuidanceNode;
    target: AnyNode;
};
export declare function rejectGuidance(graph: KnowledgeGraph, guidanceId: string, actor: string, resolution: string): GuidanceNode;
