import type { KnowledgeGraph, AnyNode, NodeType, NodeStatus, Relationship } from "../domain/types.js";
import { GraphIndices } from "../graph/index.js";
import type { GraphRepository } from "./repository.js";
export declare function readYaml<T>(filePath: string): T;
export declare function writeYaml(filePath: string, data: unknown): void;
export declare function readJson<T>(filePath: string): T;
export declare function writeJson(filePath: string, data: unknown): void;
export declare function ensureDir(dirPath: string): void;
export declare function fileExists(filePath: string): boolean;
export declare function listFiles(dirPath: string, extension?: string): string[];
export declare function listDirs(dirPath: string): string[];
/**
 * YAML-backed graph repository.
 * Suitable for small to medium projects (<1000 nodes).
 * Uses in-memory cache and pre-computed indices for fast queries.
 */
export declare class YamlGraphRepository implements GraphRepository {
    private baseDir;
    private graphPath;
    private static cache;
    constructor(projectDir: string);
    ensureSddDir(): void;
    isInitialized(): boolean;
    loadGraph(): KnowledgeGraph;
    getIndices(): GraphIndices;
    saveGraph(graph: KnowledgeGraph): void;
    getStorageType(): "yaml";
    isCacheValid(): boolean;
    invalidateCache(): void;
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
}
