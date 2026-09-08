import type { KnowledgeGraph, AnyNode, NodeType, Relationship, RelationshipType, NodeStatus } from "../domain/types.js";
import { GraphIndices } from "./index.js";
export declare function createGraph(projectId: string): KnowledgeGraph;
export declare function addNode(graph: KnowledgeGraph, node: AnyNode): void;
export declare function updateNode(graph: KnowledgeGraph, nodeId: string, updates: Partial<AnyNode>): AnyNode;
export declare function removeNode(graph: KnowledgeGraph, nodeId: string): void;
/**
 * Get a node by ID. Uses indices when available, falls back to linear scan.
 */
export declare function getNode(graph: KnowledgeGraph, nodeId: string): AnyNode | undefined;
/**
 * Get nodes by type. Uses indices when available, falls back to linear scan.
 */
export declare function getNodesByType<T extends AnyNode = AnyNode>(graph: KnowledgeGraph, type: NodeType): T[];
/**
 * Get nodes by status. Uses indices when available, falls back to linear scan.
 */
export declare function getNodesByStatus(graph: KnowledgeGraph, status: NodeStatus): AnyNode[];
export declare function addRelationship(graph: KnowledgeGraph, from: string, to: string, type: RelationshipType, metadata?: Record<string, unknown>): Relationship;
export declare function removeRelationship(graph: KnowledgeGraph, from: string, to: string, type: RelationshipType): void;
export declare function getRelationships(graph: KnowledgeGraph, nodeId: string): Relationship[];
export declare function getOutgoing(graph: KnowledgeGraph, nodeId: string): Relationship[];
export declare function getIncoming(graph: KnowledgeGraph, nodeId: string): Relationship[];
export declare function getNeighbors(graph: KnowledgeGraph, nodeId: string, direction?: "outgoing" | "incoming" | "both"): AnyNode[];
export declare function getGraphStats(graph: KnowledgeGraph): {
    total_nodes: number;
    total_relationships: number;
    by_type: Record<string, number>;
    by_status: Record<string, number>;
};
export declare function getNodeIndexed(indices: GraphIndices, nodeId: string): AnyNode | undefined;
export declare function getNodesByTypeIndexed<T extends AnyNode = AnyNode>(indices: GraphIndices, type: NodeType): T[];
export declare function getNodesByStatusIndexed(indices: GraphIndices, status: NodeStatus): AnyNode[];
export declare function getOutgoingIndexed(indices: GraphIndices, nodeId: string): Relationship[];
export declare function getIncomingIndexed(indices: GraphIndices, nodeId: string): Relationship[];
export declare function getRelationshipsIndexed(indices: GraphIndices, nodeId: string): Relationship[];
export declare function searchNodesIndexed(indices: GraphIndices, query: string, type?: NodeType): AnyNode[];
export declare function getGraphStatsIndexed(indices: GraphIndices): {
    total_nodes: number;
    total_relationships: number;
    by_type: Record<string, number>;
    by_status: Record<string, number>;
};
