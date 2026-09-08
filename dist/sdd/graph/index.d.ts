import type { KnowledgeGraph, AnyNode, NodeType, NodeStatus, Relationship, RelationshipType } from "../domain/types.js";
/**
 * Pre-computed indices for O(1) lookups on a KnowledgeGraph.
 * Supports both full rebuild and incremental updates.
 */
export declare class GraphIndices {
    private readonly mutableById;
    private readonly mutableByType;
    private readonly mutableByStatus;
    private readonly mutableOutgoing;
    private readonly mutableIncoming;
    private readonly mutableAll;
    private readonly mutableRelByType;
    private readonly mutableNeighbors;
    private readonly searchIndex;
    readonly totalNodes: number;
    readonly totalRelationships: number;
    private constructor();
    get byId(): ReadonlyMap<string, AnyNode>;
    get byType(): ReadonlyMap<NodeType, readonly AnyNode[]>;
    get byStatus(): ReadonlyMap<NodeStatus, readonly AnyNode[]>;
    get outgoing(): ReadonlyMap<string, readonly Relationship[]>;
    get incoming(): ReadonlyMap<string, readonly Relationship[]>;
    get all(): ReadonlyMap<string, readonly Relationship[]>;
    get relByType(): ReadonlyMap<RelationshipType, readonly Relationship[]>;
    get neighbors(): ReadonlyMap<string, ReadonlySet<string>>;
    static from(graph: KnowledgeGraph): GraphIndices;
    private buildNodeIndices;
    private buildRelationshipIndices;
    private addToRelIndices;
    private removeFromRelIndices;
    private buildSearchIndex;
    private indexNodeForSearch;
    /**
     * Add a single node to all indices without rebuilding.
     * O(1) per index, no full scan.
     */
    addNode(node: AnyNode): void;
    /**
     * Update a single node in all indices without rebuilding.
     * Only updates the specific entries that changed.
     */
    updateNode(oldNode: AnyNode, newNode: AnyNode): void;
    /**
     * Remove a single node from all indices without rebuilding.
     */
    removeNode(nodeId: string): void;
    /**
     * Add a relationship to indices without rebuilding.
     */
    addRelationship(rel: Relationship): void;
    /**
     * Remove a relationship from indices without rebuilding.
     */
    removeRelationship(rel: Relationship): void;
    getNode(id: string): AnyNode | undefined;
    getNodesByType(type: NodeType): AnyNode[];
    getNodesByStatus(status: NodeStatus): AnyNode[];
    getOutgoing(nodeId: string): Relationship[];
    getIncoming(nodeId: string): Relationship[];
    getRelationships(nodeId: string): Relationship[];
    getNeighborIds(nodeId: string): Set<string>;
    searchAllTokens(tokens: Set<string>): string[];
    search(query: string, type?: NodeType): AnyNode[];
}
/**
 * Inverted index for fast text search.
 * Supports incremental add/remove.
 */
export declare class InvertedIndex {
    private index;
    add(nodeId: string, tokens: Set<string>): void;
    remove(nodeId: string): void;
    search(queryTokens: Set<string>): string[];
    searchAnd(queryTokens: Set<string>): string[];
}
/**
 * Granular graph cache that stores nodes by type separately.
 * Only the affected type is invalidated on mutation.
 */
export declare class PerTypeGraphCache {
    private nodesByType;
    private relationships;
    private graphFingerprint;
    /**
     * Get nodes of a specific type from cache.
     * Returns null if cache miss for that type.
     */
    getNodesByType(type: NodeType, currentFingerprint: string): AnyNode[] | null;
    /**
     * Get all relationships from cache.
     */
    getRelationships(currentFingerprint: string): Relationship[] | null;
    /**
     * Populate cache for a specific type only.
     */
    setType(type: NodeType, nodes: AnyNode[], fingerprint: string): void;
    /**
     * Set relationships cache.
     */
    setRelationships(rels: Relationship[], fingerprint: string): void;
    /**
     * Invalidate only a specific type.
     */
    invalidateType(type: NodeType): void;
    /**
     * Invalidate relationships.
     */
    invalidateRelationships(): void;
    /**
     * Full invalidation (all types).
     */
    invalidateAll(): void;
    /**
     * Check if cache is valid for a given version.
     */
    isValid(fingerprint: string): boolean;
}
export interface DirtyState {
    dirtyNodeIds: Set<string>;
    dirtyTypes: Set<NodeType>;
    allChanged: boolean;
}
export declare function computeDirtyState(oldGraph: KnowledgeGraph | null, newGraph: KnowledgeGraph): DirtyState;
