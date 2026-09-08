import type { KnowledgeGraph, AnyNode, NodeType, NodeStatus, Relationship } from "../domain/types.js";
import { GraphIndices } from "../graph/index.js";
import type { GraphRepository } from "./repository.js";
/**
 * SQLite-backed graph repository.
 * Uses Bun's built-in SQLite for storage with native indexing.
 *
 * Benefits over YAML:
 * - O(log n) queries by type/status/id (indexed)
 * - Atomic writes via transactions
 * - Lazy loading: can query subsets without loading full graph
 * - Better concurrency for multi-process scenarios
 * - Handles 10,000+ nodes efficiently
 */
export declare class SqliteGraphRepository {
    private baseDir;
    private dbPath;
    private db;
    private static cache;
    constructor(projectDir: string);
    private getDb;
    isInitialized(): boolean;
    loadGraph(): KnowledgeGraph;
    saveGraph(graph: KnowledgeGraph): void;
    getIndices(): GraphIndices;
    getStorageType(): "sqlite";
    isCacheValid(): boolean;
    invalidateCache(): void;
    ensureSddDir(): void;
    createProject(projectId: string, name: string, description?: string): KnowledgeGraph;
    createSnapshot(description: string): string;
    listSnapshots(): string[];
    migrateTo(target: "yaml" | "sqlite", projectDir: string): GraphRepository;
    getNodeCount(): number;
    getRelationshipCount(): number;
    getNodesByType(type: NodeType): AnyNode[];
    getNodesByStatus(status: NodeStatus): AnyNode[];
    getNodeById(id: string): AnyNode | undefined;
    getRelationshipsForNode(nodeId: string): Relationship[];
    /**
     * Search nodes by text using SQLite's LIKE (fast with index).
     */
    searchNodes(query: string, type?: NodeType): AnyNode[];
    /**
     * Get counts only — O(1), no graph load.
     */
    getGraphCounts(): {
        nodeCount: number;
        relCount: number;
    };
    /**
     * Get graph metadata only — O(1), no node/rel load.
     */
    getMetadata(): Record<string, string>;
    /**
     * Get paginated node summary (id, type, name, status, version).
     * Lightweight — no metadata/description loaded.
     */
    getNodesSummary(offset: number, limit: number, type?: string): {
        nodes: Array<{
            id: string;
            type: string;
            name: string;
            status: string;
            version: number;
        }>;
        total: number;
    };
    /**
     * Get paginated relationships (id, from, to, type).
     * Lightweight — no metadata loaded.
     */
    getRelationshipsSummary(offset: number, limit: number): {
        relationships: Array<{
            id: string;
            from: string;
            to: string;
            type: string;
        }>;
        total: number;
    };
    /**
     * Get all node types with counts — O(n) but lightweight (no metadata).
     */
    getNodeTypeCounts(): Array<{
        type: string;
        count: number;
    }>;
    /**
     * Get all status counts — O(n) but lightweight.
     */
    getStatusCounts(): Array<{
        status: string;
        count: number;
    }>;
    /**
     * Get all nodes (for small graphs or when full data is needed).
     * Returns just the dashboard-relevant fields.
     */
    getAllNodesSummary(): Array<{
        id: string;
        type: string;
        name: string;
        status: string;
        version: number;
    }>;
    /**
     * Get all relationships (for small graphs or when full data is needed).
     * Returns just the dashboard-relevant fields.
     */
    getAllRelationshipsSummary(): Array<{
        id: string;
        from: string;
        to: string;
        type: string;
    }>;
    /**
     * Get updated_at timestamp — O(1).
     */
    getUpdatedAt(): string;
}
