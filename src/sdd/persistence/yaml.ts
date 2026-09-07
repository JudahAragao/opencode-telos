import * as yaml from "js-yaml"
import { readFileSync, existsSync, mkdirSync, readdirSync } from "fs"
import { join, dirname } from "path"
import type { KnowledgeGraph, AnyNode, NodeType, NodeStatus, Relationship } from "../domain/types.js"
import { GraphIndices } from "../graph/index.js"
import type { GraphRepository } from "./repository.js"
import { getCacheManager } from "../cache/manager.js"
import { atomicWriteFile } from "../cache/atomic.js"
import { fileSignature, graphFingerprint } from "../cache/fingerprint.js"
import { recordLegitimateSave, validateGraphIntegrity } from "../graph/integrity-guard.js"

export function readYaml<T>(filePath: string): T {
  const content = readFileSync(filePath, "utf-8")
  return yaml.load(content) as T
}

export function writeYaml(filePath: string, data: unknown): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const content = yaml.dump(data, {
    noRefs: true,
    lineWidth: 120,
    quotingType: '"',
    forceQuotes: false,
  })
  atomicWriteFile(filePath, content)
}

export function readJson<T>(filePath: string): T {
  const content = readFileSync(filePath, "utf-8")
  return JSON.parse(content) as T
}

export function writeJson(filePath: string, data: unknown): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  atomicWriteFile(filePath, JSON.stringify(data, null, 2))
}

export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

export function fileExists(filePath: string): boolean {
  return existsSync(filePath)
}

export function listFiles(dirPath: string, extension?: string): string[] {
  if (!existsSync(dirPath)) return []
  const entries = readdirSync(dirPath, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.isFile()) {
      if (!extension || entry.name.endsWith(extension)) {
        files.push(join(dirPath, entry.name))
      }
    }
  }
  return files
}

export function listDirs(dirPath: string): string[] {
  if (!existsSync(dirPath)) return []
  const entries = readdirSync(dirPath, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => join(dirPath, e.name))
}

// ── Cache types ──────────────────────────────────────────────────────

interface GraphCache {
  graph: KnowledgeGraph
  indices: GraphIndices
  lastModified: number
  sourceSignature: string
}

// ── Repository ───────────────────────────────────────────────────────

/**
 * YAML-backed graph repository.
 * Suitable for small to medium projects (<1000 nodes).
 * Uses in-memory cache and pre-computed indices for fast queries.
 */
export class YamlGraphRepository implements GraphRepository {
  private baseDir: string
  private graphPath: string
  private static cache: Map<string, GraphCache> = new Map()

  constructor(projectDir: string) {
    this.baseDir = join(projectDir, ".sdd")
    this.graphPath = join(this.baseDir, "graph.yaml")
  }

  ensureSddDir(): void {
    ensureDir(this.baseDir)
    ensureDir(join(this.baseDir, "nodes"))
    ensureDir(join(this.baseDir, "relationships"))
    ensureDir(join(this.baseDir, "changes"))
    ensureDir(join(this.baseDir, "snapshots"))
    ensureDir(join(this.baseDir, "transactions"))
  }

  isInitialized(): boolean {
    return fileExists(this.graphPath)
  }

  loadGraph(): KnowledgeGraph {
    if (!this.isInitialized()) {
      throw new Error("SDD not initialized. Run sdd.initialize first.")
    }

    const cacheMgr = getCacheManager(require("path").dirname(this.baseDir))
    const currentSourceSignature = fileSignature([this.graphPath])
    const externallyInvalidated = cacheMgr.checkCrossProcessInvalidation(this.graphPath)

    // Check cache with revalidation
    const cached = YamlGraphRepository.cache.get(this.graphPath)
    if (cached) {
      if (!externallyInvalidated && cached.sourceSignature === currentSourceSignature) {
        // Never expose the cached snapshot itself: callers intentionally
        // mutate the graph before saveGraph(), and leaking this reference
        // makes old/new comparisons impossible.
        return structuredClone(cached.graph)
      }
      // File was modified externally or hash mismatch, invalidate cache
      YamlGraphRepository.cache.delete(this.graphPath)
    }
    if (externallyInvalidated) YamlGraphRepository.cache.delete(this.graphPath)

    const snapshot = cacheMgr.loadGraphSnapshot()
    if (snapshot?.sourceSignature === currentSourceSignature) {
      const graph = snapshot.graph
      const indices = GraphIndices.from(graph)
      YamlGraphRepository.cache.set(this.graphPath, {
        graph: structuredClone(graph),
        indices,
        lastModified: Date.now(),
        sourceSignature: currentSourceSignature,
      })
      return structuredClone(graph)
    }

    const graph = readYaml<KnowledgeGraph>(this.graphPath)
    const indices = GraphIndices.from(graph)
    const stat = (() => { try { return require("fs").statSync(this.graphPath).mtimeMs } catch { return 0 } })()

    YamlGraphRepository.cache.set(this.graphPath, {
      graph,
      indices,
      lastModified: stat,
      sourceSignature: currentSourceSignature,
    })

    // Anti-bypass: check for out-of-band modifications
    const projectDir = require("path").dirname(this.baseDir)
    try {
      const tamperResult = validateGraphIntegrity(projectDir, graph)
      if (tamperResult.tampered) {
        // Graph was modified outside SDD workflow — attach warning to graph metadata
        ;(graph.metadata as any).__tamper_warning = tamperResult.reason
      }
    } catch {
      ;(graph.metadata as any).__tamper_warning = "Graph integrity validation could not be completed"
    }

    return structuredClone(graph)
  }

  getIndices(): GraphIndices {
    const cached = YamlGraphRepository.cache.get(this.graphPath)
    if (cached) return GraphIndices.from(structuredClone(cached.graph))

    const graph = this.loadGraph()
    return GraphIndices.from(graph)
  }

  saveGraph(graph: KnowledgeGraph): void {
    this.ensureSddDir()

    // Acquire cross-process lock
    const cacheMgr = getCacheManager(require("path").dirname(this.baseDir))
    if (!cacheMgr.acquireWriteLock()) {
      throw new Error("Another process is writing the SDD graph; retry the mutation")
    }

    try {
      writeYaml(this.graphPath, graph)
    } finally {
      cacheMgr.releaseWriteLock()
    }

    // Record legitimate save for anti-bypass integrity tracking
    const projectDir = require("path").dirname(this.baseDir)
    try {
      recordLegitimateSave(projectDir, graph)
    } catch (error) {
      throw new Error("Graph saved but integrity state could not be recorded", { cause: error })
    }

    // Keep an immutable cache snapshot.  Compute the dirty state before
    // replacing it; doing this afterwards compares the new graph to itself.
    const cached = YamlGraphRepository.cache.get(this.graphPath)
    const { computeDirtyState } = require("../graph/index.js")
    const snapshot = structuredClone(graph) as KnowledgeGraph
    const dirty = computeDirtyState(cached?.graph || null, snapshot)

    // Rebuilding the in-memory index is deterministic and avoids stale
    // readonly totals/search entries after additions and removals. YAML is
    // limited to small graphs; large graphs migrate to SQLite.
    const indices = GraphIndices.from(snapshot)
      YamlGraphRepository.cache.set(this.graphPath, {
        graph: snapshot,
        indices,
        lastModified: Date.now(),
        sourceSignature: fileSignature([this.graphPath]),
      })
    /*
    if (cached) {
      // Compute dirty nodes incrementally
      const oldGraph = cached.graph
      const { computeDirtyState } = require("../graph/index.js")
      const dirty = computeDirtyState(oldGraph, graph)

      if (!dirty.allChanged && dirty.dirtyNodeIds.size <= 50) {
        // Incremental update: modify only affected entries
        for (const nodeId of dirty.dirtyNodeIds) {
          const oldNode = oldGraph.nodes.find(n => n.id === nodeId)
          const newNode = graph.nodes.find(n => n.id === nodeId)
          if (oldNode && newNode) {
            cached.indices.updateNode(oldNode, newNode)
          } else if (newNode) {
            cached.indices.addNode(newNode)
          } else if (oldNode) {
            cached.indices.removeNode(nodeId)
          }
        }
        // Update relationship indices incrementally
        const oldRelKeys = new Set(oldGraph.relationships.map(r => `${r.from}||${r.to}||${r.type}`))
        const newRelKeys = new Set(graph.relationships.map(r => `${r.from}||${r.to}||${r.type}`))
        for (const rel of graph.relationships) {
          const key = `${rel.from}||${rel.to}||${rel.type}`
          if (!oldRelKeys.has(key)) {
            cached.indices.addRelationship(rel)
          }
        }
        for (const rel of oldGraph.relationships) {
          const key = `${rel.from}||${rel.to}||${rel.type}`
          if (!newRelKeys.has(key)) {
            cached.indices.removeRelationship(rel)
          }
        }
      } else {
        // Full rebuild needed
        YamlGraphRepository.cache.delete(this.graphPath)
        const indices = GraphIndices.from(graph)
        YamlGraphRepository.cache.set(this.graphPath, {
          graph,
          indices,
          lastModified: Date.now(),
        })
      }
    } else {
      // No previous cache, full build
      const indices = GraphIndices.from(graph)
      YamlGraphRepository.cache.set(this.graphPath, {
        graph,
        indices,
        lastModified: Date.now(),
      })
    }
    */

    // A: Granular invalidation — only invalidate caches for changed types
    if (dirty.allChanged || dirty.dirtyTypes.size > 10) {
      // Too many types changed — full invalidation is faster
      cacheMgr.invalidateAll()
    } else if (dirty.dirtyTypes.size > 0) {
      // A: Partial invalidation — only affected types
      cacheMgr.invalidatePartial([...dirty.dirtyTypes])
    }

    // G: Save graph snapshot to disk for cross-session restore
    cacheMgr.saveGraphSnapshot(graph, fileSignature([this.graphPath]))
  }

  getStorageType(): "yaml" {
    return "yaml"
  }

  isCacheValid(): boolean {
    const cached = YamlGraphRepository.cache.get(this.graphPath)
    if (!cached) return false
    try {
      return fileSignature([this.graphPath]) === cached.sourceSignature
    } catch {
      return false
    }
  }

  invalidateCache(): void {
    YamlGraphRepository.cache.delete(this.graphPath)
  }

  createProject(projectId: string, name: string, description?: string): KnowledgeGraph {
    this.ensureSddDir()
    const now = new Date().toISOString()
    const graph: KnowledgeGraph = {
      version: "1.0.0",
      project_id: projectId,
      nodes: [
        {
          id: projectId,
          type: "project",
          name,
          description,
          status: "DRAFT",
          version: 1,
          metadata: { name, description },
          created_at: now,
          updated_at: now,
        },
      ],
      relationships: [],
      metadata: {
        created_at: now,
        updated_at: now,
        sdd_version: "1.0.0",
      },
    }
    this.saveGraph(graph)
    return graph
  }

  createSnapshot(description: string): string {
    const graph = this.loadGraph()
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const snapshotId = `snapshot-${timestamp}`
    const snapshotPath = join(this.baseDir, "snapshots", `${snapshotId}.yaml`)
    writeYaml(snapshotPath, { id: snapshotId, timestamp: new Date().toISOString(), description, graph_state: graph })
    return snapshotId
  }

  listSnapshots(): string[] {
    const snapDir = join(this.baseDir, "snapshots")
    // Get both YAML files and directories (for snapshot folders)
    const yamlFiles = listFiles(snapDir, ".yaml")
    const dirs = listDirs(snapDir)
    return [...yamlFiles, ...dirs]
  }

  migrateTo(target: "yaml" | "sqlite", projectDir: string): GraphRepository {
    const graph = this.loadGraph()

    if (target === "sqlite") {
      const { SqliteGraphRepository } = require("./sqlite.js")
      const repo = new SqliteGraphRepository(projectDir)
      repo.saveGraph(graph)
      return repo
    }

    // Already YAML
    return this
  }

  // ── Optimized queries (use indices) ─────────────────────────────

  getNodeCount(): number {
    const cached = YamlGraphRepository.cache.get(this.graphPath)
    if (cached) return cached.indices.totalNodes
    // Quick count without full parse
    try {
      const content = readFileSync(this.graphPath, "utf-8")
      const matches = content.match(/^  - id:/gm)
      return matches ? matches.length : 0
    } catch {
      return 0
    }
  }

  getRelationshipCount(): number {
    const cached = YamlGraphRepository.cache.get(this.graphPath)
    if (cached) return cached.indices.totalRelationships
    return 0
  }

  getNodesByType(type: NodeType): AnyNode[] {
    // Check per-type cache first
    const cacheMgr = getCacheManager(require("path").dirname(this.baseDir))
    const currentFingerprint = (() => { try { return graphFingerprint(this.loadGraph()) } catch { return "" } })()
    const cached = cacheMgr.getCachedNodesByType(type, currentFingerprint)
    if (cached) return cached

    const indices = this.getIndices()
    const nodes = indices.getNodesByType(type)
    cacheMgr.setCachedNodesByType(type, nodes, currentFingerprint)
    return nodes
  }

  getNodesByStatus(status: NodeStatus): AnyNode[] {
    const indices = this.getIndices()
    return indices.getNodesByStatus(status)
  }

  getNodeById(id: string): AnyNode | undefined {
    // Check byId map directly (O(1))
    const indices = this.getIndices()
    return indices.byId.get(id)
  }

  getRelationshipsForNode(nodeId: string): Relationship[] {
    const indices = this.getIndices()
    return indices.getRelationships(nodeId)
  }
}
