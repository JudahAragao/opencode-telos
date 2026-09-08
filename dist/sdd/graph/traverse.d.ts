import type { KnowledgeGraph, AnyNode, Relationship } from "../domain/types.js";
export interface TraverseOptions {
    max_depth?: number;
    edge_types?: string[];
    include_start?: boolean;
}
export declare function bfsOutgoing(graph: KnowledgeGraph, startId: string, options?: TraverseOptions): {
    nodes: AnyNode[];
    edges: Relationship[];
    distances: Map<string, number>;
};
export declare function bfsIncoming(graph: KnowledgeGraph, startId: string, options?: TraverseOptions): {
    nodes: AnyNode[];
    edges: Relationship[];
    distances: Map<string, number>;
};
export declare function bfsBoth(graph: KnowledgeGraph, startId: string, options?: TraverseOptions): {
    nodes: AnyNode[];
    edges: Relationship[];
    distances: Map<string, number>;
};
export declare function findPath(graph: KnowledgeGraph, fromId: string, toId: string, maxDepth?: number): AnyNode[] | null;
export declare function computeImpact(graph: KnowledgeGraph, nodeId: string, maxDepth?: number): {
    direct: AnyNode[];
    indirect: AnyNode[];
    potential: AnyNode[];
};
export interface ImpactAction {
    node_id: string;
    node_type: string;
    node_name: string;
    action: "modify" | "create" | "update_relationship" | "add_test" | "update_spec";
    description: string;
    target_files: string[];
    priority: "high" | "medium" | "low";
}
/**
 * Compute impact with concrete actions: what files to modify,
 * what relationships to update, what tests to add.
 */
export declare function computeImpactActions(graph: KnowledgeGraph, nodeId: string, maxDepth?: number): ImpactAction[];
export declare function getSubgraph(graph: KnowledgeGraph, nodeIds: string[]): KnowledgeGraph;
