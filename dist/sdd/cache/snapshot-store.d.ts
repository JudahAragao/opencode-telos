/**
 * Graph Snapshot Store — Persistência do grafo completo entre sessões.
 *
 * Salva graph + indices serializados em .sdd/graph-cache.json.
 * Na próxima sessão, carrega diretamente em vez de ler YAML/SQLite.
 *
 * Solução G: Snapshot persistente do grafo.
 */
import type { KnowledgeGraph } from "../domain/types.js";
export declare class GraphSnapshotStore {
    private projectDir;
    constructor(projectDir: string);
    /**
     * Save full graph + indices to disk.
     */
    save(graph: KnowledgeGraph, graphHash: string, sourceSignature: string): void;
    /**
     * Load graph from snapshot if valid.
     * Returns null if snapshot is missing, stale, or corrupted.
     */
    load(): {
        graph: KnowledgeGraph;
        graphHash: string;
        sourceSignature: string;
    } | null;
    /**
     * Check if snapshot exists and is fresh enough.
     */
    isValid(): boolean;
    /**
     * Invalidate (delete) the snapshot.
     */
    invalidate(): void;
    /**
     * Serialize graph indices for JSON storage.
     */
    private serializeIndices;
}
export declare function getGraphSnapshotStore(projectDir: string): GraphSnapshotStore;
