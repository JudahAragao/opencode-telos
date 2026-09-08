/**
 * Graph Snapshot Store — Persistência do grafo completo entre sessões.
 *
 * Salva graph + indices serializados em .sdd/graph-cache.json.
 * Na próxima sessão, carrega diretamente em vez de ler YAML/SQLite.
 *
 * Solução G: Snapshot persistente do grafo.
 */
import { existsSync, readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { atomicWriteFile } from "./atomic.js";
import { graphFingerprint } from "./fingerprint.js";
import { sddDebug } from "../log.js";
const SNAPSHOT_FILE = ".sdd/graph-cache.json";
const SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
export class GraphSnapshotStore {
    projectDir;
    constructor(projectDir) {
        this.projectDir = projectDir;
    }
    /**
     * Save full graph + indices to disk.
     */
    save(graph, graphHash, sourceSignature) {
        const snapshot = {
            version: 3,
            timestamp: Date.now(),
            graph,
            indices: this.serializeIndices(graph),
            graphHash,
            sourceSignature,
        };
        const path = join(this.projectDir, SNAPSHOT_FILE);
        const dir = dirname(path);
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        atomicWriteFile(path, JSON.stringify(snapshot));
    }
    /**
     * Load graph from snapshot if valid.
     * Returns null if snapshot is missing, stale, or corrupted.
     */
    load() {
        const path = join(this.projectDir, SNAPSHOT_FILE);
        if (!existsSync(path))
            return null;
        try {
            const raw = readFileSync(path, "utf-8");
            const snapshot = JSON.parse(raw);
            // Validate version
            if (snapshot.version !== 3)
                return null;
            // Validate age
            if (Date.now() - snapshot.timestamp > SNAPSHOT_MAX_AGE_MS)
                return null;
            // Validate graph structure
            if (!snapshot.graph || !Array.isArray(snapshot.graph.nodes))
                return null;
            if (!snapshot.sourceSignature || snapshot.graphHash !== graphFingerprint(snapshot.graph))
                return null;
            return {
                graph: snapshot.graph,
                graphHash: snapshot.graphHash || "",
                sourceSignature: snapshot.sourceSignature,
            };
        }
        catch (error) {
            sddDebug("snapshot", "Failed to load snapshot", error);
            return null;
        }
    }
    /**
     * Check if snapshot exists and is fresh enough.
     */
    isValid() {
        const path = join(this.projectDir, SNAPSHOT_FILE);
        if (!existsSync(path))
            return false;
        try {
            const raw = readFileSync(path, "utf-8");
            const snapshot = JSON.parse(raw);
            return snapshot.version === 3 && Boolean(snapshot.sourceSignature) &&
                (Date.now() - snapshot.timestamp) < SNAPSHOT_MAX_AGE_MS;
        }
        catch (error) {
            sddDebug("snapshot", "Snapshot validation failed", error);
            return false;
        }
    }
    /**
     * Invalidate (delete) the snapshot.
     */
    invalidate() {
        const path = join(this.projectDir, SNAPSHOT_FILE);
        try {
            if (existsSync(path)) {
                const { unlinkSync } = require("fs");
                unlinkSync(path);
            }
        }
        catch (error) {
            sddDebug("snapshot", "Failed to invalidate snapshot", error);
        }
    }
    /**
     * Serialize graph indices for JSON storage.
     */
    serializeIndices(graph) {
        const byType = {};
        const byStatus = {};
        const outgoing = {};
        const incoming = {};
        const relByType = {};
        const neighbors = {};
        // Node indices
        for (const node of graph.nodes) {
            if (!byType[node.type])
                byType[node.type] = [];
            byType[node.type].push(node.id);
            if (!byStatus[node.status])
                byStatus[node.status] = [];
            byStatus[node.status].push(node.id);
            if (!neighbors[node.id])
                neighbors[node.id] = [];
        }
        // Relationship indices
        for (const rel of graph.relationships) {
            if (!outgoing[rel.from])
                outgoing[rel.from] = [];
            outgoing[rel.from].push(rel.id);
            if (!incoming[rel.to])
                incoming[rel.to] = [];
            incoming[rel.to].push(rel.id);
            if (!relByType[rel.type])
                relByType[rel.type] = [];
            relByType[rel.type].push(rel.id);
            if (!neighbors[rel.from])
                neighbors[rel.from] = [];
            if (!neighbors[rel.to])
                neighbors[rel.to] = [];
            neighbors[rel.from].push(rel.to);
            if (rel.from !== rel.to) {
                neighbors[rel.to].push(rel.from);
            }
        }
        return {
            byType,
            byStatus,
            outgoing,
            incoming,
            relByType,
            neighbors,
            totalNodes: graph.nodes.length,
            totalRelationships: graph.relationships.length,
        };
    }
}
// Singleton per project
const stores = new Map();
export function getGraphSnapshotStore(projectDir) {
    let store = stores.get(projectDir);
    if (!store) {
        store = new GraphSnapshotStore(projectDir);
        stores.set(projectDir, store);
    }
    return store;
}
