import type { KnowledgeGraph, AnyNode, NodeType, NodeStatus, Relationship } from "../domain/types.js";
import { type SddConfig } from "../domain/types.js";
import { GraphIndices } from "../graph/index.js";
/**
 * Unified interface for graph storage.
 * Both YAML and SQLite implementations satisfy this contract.
 */
export interface GraphRepository {
    /** Check if SDD is initialized (graph file/db exists) */
    isInitialized(): boolean;
    /** Load the full graph into memory */
    loadGraph(): KnowledgeGraph;
    /** Save the full graph (and update cache/indices) */
    saveGraph(graph: KnowledgeGraph): void;
    /** Get pre-computed indices for O(1) queries */
    getIndices(): GraphIndices;
    /** Get the underlying storage type */
    getStorageType(): "yaml" | "sqlite";
    /** Check if the cache is still valid */
    isCacheValid(): boolean;
    /** Invalidate the in-memory cache */
    invalidateCache(): void;
    /** Ensure the .sdd directory structure exists */
    ensureSddDir(): void;
    /** Create a new project graph */
    createProject(projectId: string, name: string, description?: string): KnowledgeGraph;
    /** Create a snapshot of the current state */
    createSnapshot(description: string): string;
    /** List available snapshots */
    listSnapshots(): string[];
    /** Migrate to a different storage backend */
    migrateTo(target: "yaml" | "sqlite", projectDir: string): GraphRepository;
    /** Get node count without loading full graph (optimized) */
    getNodeCount(): number;
    /** Get relationship count without loading full graph (optimized) */
    getRelationshipCount(): number;
    /** Get nodes by type without loading full graph (optimized for large graphs) */
    getNodesByType?(type: NodeType): AnyNode[];
    /** Get nodes by status without loading full graph (optimized for large graphs) */
    getNodesByStatus?(status: NodeStatus): AnyNode[];
    /** Get a single node by ID without loading full graph (optimized for large graphs) */
    getNodeById?(id: string): AnyNode | undefined;
    /** Get relationships for a node without loading full graph (optimized for large graphs) */
    getRelationshipsForNode?(nodeId: string): Relationship[];
}
/**
 * Auto-detect the best storage backend and return a repository.
 *
 * Decision logic:
 * - If .sdd/graph.db exists → use SQLite
 * - If .sdd/graph.yaml exists and <1000 nodes → use YAML
 * - If .sdd/graph.yaml exists and ≥1000 nodes → auto-migrate to SQLite
 * - If neither exists → return YAML (default for new projects)
 */
export declare function createRepository(projectDir: string): GraphRepository;
/**
 * Load the SDD configuration, falling back to defaults.
 */
export declare function loadSddConfig(projectDir: string): SddConfig;
