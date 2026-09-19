import type { KnowledgeGraph, AnyNode, NodeType, NodeStatus, Relationship } from "../domain/types.js";
import { type SddConfig } from "../domain/types.js";
import { GraphIndices } from "../graph/index.js";
/**
 * Write the sentinel atomically.
 * Called after every successful migration and during auto-heal.
 */
export declare function writeSentinel(projectDir: string, backend: "yaml" | "sqlite"): void;
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
/** Returns the last conflict resolution performed in this process (for sdd.check_migrations). */
export declare function getLastConflictResolution(): {
    winner: "yaml" | "sqlite";
    reason: string;
} | null;
/**
 * Auto-detect the best storage backend and return a repository.
 *
 * Decision priority:
 * 1. Sentinel file (.sdd/storage-backend) — authoritative explicit choice.
 *    Auto-healed on first call: if graph.db exists without a sentinel, the
 *    sentinel is written as "sqlite" immediately (Opção B).
 * 2. Both graph.yaml and graph.db exist without sentinel →
 *    resolveConflictingBackends() — intelligent analysis with SQLite preference.
 * 3. Only graph.db exists → SQLite (+ auto-heal sentinel).
 * 4. Only graph.yaml exists, < 1000 nodes → YAML.
 * 5. Only graph.yaml exists, ≥ 1000 nodes → auto-migrate to SQLite.
 * 6. Neither exists → YAML (default for new projects).
 *
 * .bak / .bk / .backup files are NEVER opened as active graphs — they are
 * read-only disaster-recovery archives.
 */
export declare function createRepository(projectDir: string): GraphRepository;
/**
 * Load the SDD configuration, falling back to defaults.
 */
export declare function loadSddConfig(projectDir: string): SddConfig;
