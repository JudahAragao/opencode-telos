import type { AnyNode, KnowledgeGraph, Relationship } from "../domain/types.js";
export interface ImpactNode {
    node: AnyNode;
    distance: number;
    directions: Array<"incoming" | "outgoing">;
    relationships: Relationship[];
    action: "review" | "recalculate" | "propose_update";
}
export interface NodeImpactResult {
    source: AnyNode;
    direct: ImpactNode[];
    indirect: ImpactNode[];
    potential: ImpactNode[];
    affected_relationships: Relationship[];
    acceptance_criteria: AnyNode[];
}
export declare function analyzeNodeImpact(graph: KnowledgeGraph, nodeId: string, maxDepth?: number): NodeImpactResult;
export declare function formatNodeImpact(result: NodeImpactResult): string;
