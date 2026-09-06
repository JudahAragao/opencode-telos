import type {
  KnowledgeGraph,
  AnyNode,
  NodeType,
  NodeStatus,
  Relationship,
  RelationshipType,
} from "../domain/types.js"
import { GraphIndices } from "../graph/index.js"
import { ensureDir } from "./yaml.js"
import { join } from "path"
import { getCacheManager } from "../cache/manager.js"
import { fileSignature } from "../cache/fingerprint.js"
import type { GraphRepository } from "./repository.js"
import { recordLegitimateSave, validateGraphIntegrity } from "../graph/integrity-guard.js"

let dbCounter = 0

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
export class SqliteGraphRepository {
  private baseDir: string
  private dbPath: string
  private db: any
  private static cache: Map<string, { graph: KnowledgeGraph; indices: GraphIndices; sourceSignature: string }> = new Map()

  constructor(projectDir: string) {
    this.baseDir = join(projectDir, ".sdd")
    this.dbPath = join(this.baseDir, "graph.db")
    this.db = null
  }

  private getDb(): any {
    if (this.db) return this.db

    ensureDir(this.baseDir)

    // Use Bun's built-in SQLite
    const { Database } = require("bun:sqlite")
    this.db = new Database(this.dbPath)

    // Enable WAL mode for better concurrency
    this.db.exec("PRAGMA journal_mode=WAL")
    this.db.exec("PRAGMA synchronous=NORMAL")

    // Create tables if they don't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS graph_metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        version INTEGER DEFAULT 1,
        description TEXT,
        metadata_json TEXT,
        created_at TEXT,
        updated_at TEXT,
        created_by TEXT,
        change_id TEXT,
        previous_version INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
      CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
      CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);

      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        type TEXT NOT NULL,
        metadata_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_rels_from ON relationships(from_id);
      CREATE INDEX IF NOT EXISTS idx_rels_to ON relationships(to_id);
      CREATE INDEX IF NOT EXISTS idx_rels_type ON relationships(type);
      CREATE INDEX IF NOT EXISTS idx_rels_from_type ON relationships(from_id, type);
      CREATE INDEX IF NOT EXISTS idx_rels_to_type ON relationships(to_id, type);
    `)

    return this.db
  }

  isInitialized(): boolean {
    try {
      const db = this.getDb()
      const result = db.query("SELECT value FROM graph_metadata WHERE key = 'project_id'").get()
      return !!result
    } catch {
      return false
    }
  }

  loadGraph(): KnowledgeGraph {
    const cacheMgr = getCacheManager(require("path").dirname(this.baseDir))
    const sourcePaths = [this.dbPath, `${this.dbPath}-wal`, `${this.dbPath}-shm`]
    const currentSourceSignature = fileSignature(sourcePaths)

    // Check cache with revalidation
    const cached = SqliteGraphRepository.cache.get(this.dbPath)
    if (cached) {
      // Revalidation: check content signature and durable invalidation events.
      if (cached.sourceSignature === currentSourceSignature && !cacheMgr.checkCrossProcessInvalidation(this.dbPath)) {
        return structuredClone(cached.graph)
      }
      // DB was modified externally, invalidate cache
      SqliteGraphRepository.cache.delete(this.dbPath)
    }

    const snapshot = cacheMgr.loadGraphSnapshot()
    if (snapshot?.sourceSignature === currentSourceSignature) {
      const graph = snapshot.graph
      const indices = GraphIndices.from(graph)
      SqliteGraphRepository.cache.set(this.dbPath, {
        graph: structuredClone(graph),
        indices,
        sourceSignature: currentSourceSignature,
      })
      cacheMgr.initGraphHash(graph.nodes.length, graph.relationships.length)
      return structuredClone(graph)
    }

    const db = this.getDb()

    // Load metadata
    const metaRows = db.query("SELECT key, value FROM graph_metadata").all()
    const metaMap = new Map<string, string>()
    for (const row of metaRows) {
      metaMap.set((row as any).key, (row as any).value)
    }

    // Load all nodes
    const nodeRows = db.query("SELECT * FROM nodes").all() as any[]
    const nodes: AnyNode[] = nodeRows.map(row => ({
      id: row.id,
      type: row.type,
      name: row.name,
      description: row.description || undefined,
      status: row.status,
      version: row.version,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by || undefined,
      change_id: row.change_id || undefined,
      previous_version: row.previous_version || undefined,
    })) as AnyNode[]

    // Load all relationships
    const relRows = db.query("SELECT * FROM relationships").all() as any[]
    const relationships: Relationship[] = relRows.map(row => ({
      id: row.id,
      from: row.from_id,
      to: row.to_id,
      type: row.type,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
    }))

    const graph: KnowledgeGraph = {
      version: metaMap.get("version") || "1.0.0",
      project_id: metaMap.get("project_id") || "unknown",
      nodes,
      relationships,
      metadata: {
        created_at: metaMap.get("created_at") || new Date().toISOString(),
        updated_at: metaMap.get("updated_at") || new Date().toISOString(),
        sdd_version: metaMap.get("sdd_version") || "1.0.0",
      },
    }

    // Build indices and cache
    const indices = GraphIndices.from(graph)
    SqliteGraphRepository.cache.set(this.dbPath, { graph, indices, sourceSignature: currentSourceSignature })

    // Anti-bypass: check for out-of-band modifications
    const projectDir = require("path").dirname(this.baseDir)
    try {
      const tamperResult = validateGraphIntegrity(projectDir, graph)
      if (tamperResult.tampered) {
        ;(graph.metadata as any).__tamper_warning = tamperResult.reason
      }
    } catch {}

    return structuredClone(graph)
  }

  saveGraph(graph: KnowledgeGraph): void {
    const db = this.getDb()
    const cacheMgr = getCacheManager(require("path").dirname(this.baseDir))
    if (!cacheMgr.acquireWriteLock()) {
      throw new Error("Another process is writing the SDD graph; retry the mutation")
    }

    // Use transaction for atomicity
    try {
      db.exec("BEGIN TRANSACTION")

      try {
        // Differential persistence: update only changed rows and delete only
        // rows that disappeared. This keeps SQLite useful for large graphs.
        const upsertMeta = db.prepare(
          "INSERT INTO graph_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        upsertMeta.run("project_id", graph.project_id)
        upsertMeta.run("version", graph.version)
        upsertMeta.run("created_at", graph.metadata.created_at)
        upsertMeta.run("updated_at", graph.metadata.updated_at)
        upsertMeta.run("sdd_version", graph.metadata.sdd_version)

      // Save nodes in batches for performance
      const upsertNode = db.prepare(`
        INSERT INTO nodes (id, type, name, status, version, description, metadata_json, created_at, updated_at, created_by, change_id, previous_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type=excluded.type, name=excluded.name, status=excluded.status,
          version=excluded.version, description=excluded.description,
          metadata_json=excluded.metadata_json, updated_at=excluded.updated_at,
          created_by=excluded.created_by, change_id=excluded.change_id,
          previous_version=excluded.previous_version
      `)

      for (const node of graph.nodes) {
        upsertNode.run(
          node.id,
          node.type,
          node.name,
          node.status,
          node.version,
          node.description || null,
          JSON.stringify(node.metadata),
          node.created_at,
          node.updated_at,
          node.created_by || null,
          node.change_id || null,
          node.previous_version || null,
        )
      }

      // Save relationships in batches
      const upsertRel = db.prepare(`
        INSERT INTO relationships (id, from_id, to_id, type, metadata_json)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          from_id=excluded.from_id, to_id=excluded.to_id,
          type=excluded.type, metadata_json=excluded.metadata_json
      `)

      for (const rel of graph.relationships) {
        upsertRel.run(
          rel.id,
          rel.from,
          rel.to,
          rel.type,
          JSON.stringify(rel.metadata),
        )
      }

      const nodeIds = new Set(graph.nodes.map((node) => node.id))
      const existingNodeIds = db.query("SELECT id FROM nodes").all() as Array<{ id: string }>
      const deleteNode = db.prepare("DELETE FROM nodes WHERE id = ?")
      for (const row of existingNodeIds) if (!nodeIds.has(row.id)) deleteNode.run(row.id)

      const relationshipIds = new Set(graph.relationships.map((relationship) => relationship.id))
      const existingRelationshipIds = db.query("SELECT id FROM relationships").all() as Array<{ id: string }>
      const deleteRelationship = db.prepare("DELETE FROM relationships WHERE id = ?")
      for (const row of existingRelationshipIds) if (!relationshipIds.has(row.id)) deleteRelationship.run(row.id)

        db.exec("COMMIT")
      } catch (e) {
        db.exec("ROLLBACK")
        throw e
      }
    } finally {
      cacheMgr.releaseWriteLock()
    }

    // Compare against the immutable cached snapshot before replacing it.
    const cached = SqliteGraphRepository.cache.get(this.dbPath)
    const { computeDirtyState } = require("../graph/index.js")
    const snapshot = structuredClone(graph) as KnowledgeGraph
    const dirty = computeDirtyState(cached?.graph || null, snapshot)
    const indices = GraphIndices.from(snapshot)
    const sourcePaths = [this.dbPath, `${this.dbPath}-wal`, `${this.dbPath}-shm`]
    const sourceSignature = fileSignature(sourcePaths)
    SqliteGraphRepository.cache.set(this.dbPath, { graph: snapshot, indices, sourceSignature })
    /*
    if (cached) {
      const oldGraph = cached.graph
      const { computeDirtyState } = require("../graph/index.js")
      const dirty = computeDirtyState(oldGraph, graph)

      if (!dirty.allChanged && dirty.dirtyNodeIds.size <= 50) {
        // Incremental update
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
        const oldRelKeys = new Set(oldGraph.relationships.map(r => `${r.from}||${r.to}||${r.type}`))
        const newRelKeys = new Set(graph.relationships.map(r => `${r.from}||${r.to}||${r.type}`))
        for (const rel of graph.relationships) {
          const key = `${rel.from}||${rel.to}||${rel.type}`
          if (!oldRelKeys.has(key)) cached.indices.addRelationship(rel)
        }
        for (const rel of oldGraph.relationships) {
          const key = `${rel.from}||${rel.to}||${rel.type}`
          if (!newRelKeys.has(key)) cached.indices.removeRelationship(rel)
        }
      } else {
        // Full rebuild needed
        SqliteGraphRepository.cache.delete(this.dbPath)
        const indices = GraphIndices.from(graph)
        SqliteGraphRepository.cache.set(this.dbPath, { graph, indices })
      }
    } else {
      const indices = GraphIndices.from(graph)
      SqliteGraphRepository.cache.set(this.dbPath, { graph, indices })
    }
    */

    // Update incremental hash
    cacheMgr.initGraphHash(graph.nodes.length, graph.relationships.length)

    // A: Granular invalidation — only invalidate caches for changed types
    if (dirty.allChanged || dirty.dirtyTypes.size > 10) {
      // Too many types changed — full invalidation is faster
      cacheMgr.invalidateAll()
    } else if (dirty.dirtyTypes.size > 0) {
      // A: Partial invalidation — only affected types
      cacheMgr.invalidatePartial([...dirty.dirtyTypes])
    }

    // G: Save graph snapshot to disk for cross-session restore
    cacheMgr.saveGraphSnapshot(graph, sourceSignature)

    // Anti-bypass: record legitimate save for integrity tracking
    const projectDir = require("path").dirname(this.baseDir)
    try {
      recordLegitimateSave(projectDir, graph)
    } catch {}
  }

  getIndices(): GraphIndices {
    const cached = SqliteGraphRepository.cache.get(this.dbPath)
    if (cached) return cached.indices

    const graph = this.loadGraph()
    return GraphIndices.from(graph)
  }

  getStorageType(): "sqlite" {
    return "sqlite"
  }

  isCacheValid(): boolean {
    return SqliteGraphRepository.cache.has(this.dbPath)
  }

  invalidateCache(): void {
    SqliteGraphRepository.cache.delete(this.dbPath)
  }

  ensureSddDir(): void {
    ensureDir(this.baseDir)
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
    const snapshotPath = join(this.baseDir, "snapshots", `${snapshotId}.json`)

    ensureDir(join(this.baseDir, "snapshots"))
    const { writeJson } = require("./yaml.js")
    writeJson(snapshotPath, {
      id: snapshotId,
      timestamp: new Date().toISOString(),
      description,
      graph_state: graph,
    })

    return snapshotId
  }

  listSnapshots(): string[] {
    const { readdirSync, existsSync } = require("fs")
    const snapDir = join(this.baseDir, "snapshots")
    if (!existsSync(snapDir)) return []
    return readdirSync(snapDir)
      .filter((f: string) => f.endsWith(".json"))
      .map((f: string) => join(snapDir, f))
  }

  migrateTo(target: "yaml" | "sqlite", projectDir: string): GraphRepository {
    const graph = this.loadGraph()

    if (target === "yaml") {
      const { YamlGraphRepository } = require("./yaml.js")
      const repo = new YamlGraphRepository(projectDir)
      repo.saveGraph(graph)
      return repo
    }

    // Already SQLite
    return this
  }

  // ── Optimized queries (don't need full graph load) ──────────────

  getNodeCount(): number {
    const db = this.getDb()
    const result = db.query("SELECT COUNT(*) as count FROM nodes").get() as any
    return result?.count || 0
  }

  getRelationshipCount(): number {
    const db = this.getDb()
    const result = db.query("SELECT COUNT(*) as count FROM relationships").get() as any
    return result?.count || 0
  }

  getNodesByType(type: NodeType): AnyNode[] {
    // Check per-type cache first
    const cacheMgr = getCacheManager(require("path").dirname(this.baseDir))
    const versionNum = (() => { try { return new Date(this.loadGraph().metadata.updated_at).getTime() } catch { return 0 } })()
    const cached = cacheMgr.getCachedNodesByType(type, versionNum)
    if (cached) return cached

    const db = this.getDb()
    const rows = db.query("SELECT * FROM nodes WHERE type = ?").all(type) as any[]
    const nodes = rows.map(row => ({
      id: row.id,
      type: row.type,
      name: row.name,
      description: row.description || undefined,
      status: row.status,
      version: row.version,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
      created_at: row.created_at,
      updated_at: row.updated_at,
    })) as AnyNode[]

    cacheMgr.setCachedNodesByType(type, nodes, versionNum)
    return nodes
  }

  getNodesByStatus(status: NodeStatus): AnyNode[] {
    const db = this.getDb()
    const rows = db.query("SELECT * FROM nodes WHERE status = ?").all(status) as any[]
    return rows.map(row => ({
      id: row.id,
      type: row.type,
      name: row.name,
      description: row.description || undefined,
      status: row.status,
      version: row.version,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
      created_at: row.created_at,
      updated_at: row.updated_at,
    })) as AnyNode[]
  }

  getNodeById(id: string): AnyNode | undefined {
    const db = this.getDb()
    const row = db.query("SELECT * FROM nodes WHERE id = ?").get(id) as any
    if (!row) return undefined
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      description: row.description || undefined,
      status: row.status,
      version: row.version,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
      created_at: row.created_at,
      updated_at: row.updated_at,
    } as AnyNode
  }

  getRelationshipsForNode(nodeId: string): Relationship[] {
    const db = this.getDb()
    const rows = db.query(
      "SELECT * FROM relationships WHERE from_id = ? OR to_id = ?"
    ).all(nodeId, nodeId) as any[]
    return rows.map(row => ({
      id: row.id,
      from: row.from_id,
      to: row.to_id,
      type: row.type,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
    }))
  }

  /**
   * Search nodes by text using SQLite's LIKE (fast with index).
   */
  searchNodes(query: string, type?: NodeType): AnyNode[] {
    const db = this.getDb()
    const q = `%${query.toLowerCase()}%`

    let sql = "SELECT * FROM nodes WHERE (LOWER(name) LIKE ? OR LOWER(id) LIKE ? OR LOWER(metadata_json) LIKE ?)"
    const params: any[] = [q, q, q]

    if (type) {
      sql += " AND type = ?"
      params.push(type)
    }

    sql += " LIMIT 50"

    const rows = db.query(sql).all(...params) as any[]
    return rows.map(row => ({
      id: row.id,
      type: row.type,
      name: row.name,
      description: row.description || undefined,
      status: row.status,
      version: row.version,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
      created_at: row.created_at,
      updated_at: row.updated_at,
    })) as AnyNode[]
  }

  // ── Lightweight queries for dashboard (avoid full graph load) ───

  /**
   * Get counts only — O(1), no graph load.
   */
  getGraphCounts(): { nodeCount: number; relCount: number } {
    const db = this.getDb()
    const nodeRow = db.query("SELECT COUNT(*) as c FROM nodes").get() as any
    const relRow = db.query("SELECT COUNT(*) as c FROM relationships").get() as any
    return {
      nodeCount: nodeRow?.c || 0,
      relCount: relRow?.c || 0,
    }
  }

  /**
   * Get graph metadata only — O(1), no node/rel load.
   */
  getMetadata(): Record<string, string> {
    const db = this.getDb()
    const rows = db.query("SELECT key, value FROM graph_metadata").all() as any[]
    const map: Record<string, string> = {}
    for (const row of rows) {
      map[row.key] = row.value
    }
    return map
  }

  /**
   * Get paginated node summary (id, type, name, status, version).
   * Lightweight — no metadata/description loaded.
   */
  getNodesSummary(offset: number, limit: number, type?: string): { nodes: Array<{ id: string; type: string; name: string; status: string; version: number }>; total: number } {
    const db = this.getDb()

    let countSql = "SELECT COUNT(*) as c FROM nodes"
    let dataSql = "SELECT id, type, name, status, version FROM nodes"
    const params: any[] = []

    if (type) {
      countSql += " WHERE type = ?"
      dataSql += " WHERE type = ?"
      params.push(type)
    }

    const totalRow = db.query(countSql).get(...params) as any
    const total = totalRow?.c || 0

    dataSql += " ORDER BY type, name LIMIT ? OFFSET ?"
    const rows = db.query(dataSql).all(...params, limit, offset) as any[]

    return {
      nodes: rows.map(row => ({
        id: row.id,
        type: row.type,
        name: row.name,
        status: row.status,
        version: row.version,
      })),
      total,
    }
  }

  /**
   * Get paginated relationships (id, from, to, type).
   * Lightweight — no metadata loaded.
   */
  getRelationshipsSummary(offset: number, limit: number): { relationships: Array<{ id: string; from: string; to: string; type: string }>; total: number } {
    const db = this.getDb()

    const totalRow = db.query("SELECT COUNT(*) as c FROM relationships").get() as any
    const total = totalRow?.c || 0

    const rows = db.query(
      "SELECT id, from_id, to_id, type FROM relationships LIMIT ? OFFSET ?"
    ).all(limit, offset) as any[]

    return {
      relationships: rows.map(row => ({
        id: row.id,
        from: row.from_id,
        to: row.to_id,
        type: row.type,
      })),
      total,
    }
  }

  /**
   * Get all node types with counts — O(n) but lightweight (no metadata).
   */
  getNodeTypeCounts(): Array<{ type: string; count: number }> {
    const db = this.getDb()
    const rows = db.query(
      "SELECT type, COUNT(*) as c FROM nodes GROUP BY type ORDER BY c DESC"
    ).all() as any[]
    return rows.map(row => ({ type: row.type, count: row.c }))
  }

  /**
   * Get all status counts — O(n) but lightweight.
   */
  getStatusCounts(): Array<{ status: string; count: number }> {
    const db = this.getDb()
    const rows = db.query(
      "SELECT status, COUNT(*) as c FROM nodes GROUP BY status ORDER BY c DESC"
    ).all() as any[]
    return rows.map(row => ({ status: row.status, count: row.c }))
  }

  /**
   * Get all nodes (for small graphs or when full data is needed).
   * Returns just the dashboard-relevant fields.
   */
  getAllNodesSummary(): Array<{ id: string; type: string; name: string; status: string; version: number }> {
    const db = this.getDb()
    const rows = db.query(
      "SELECT id, type, name, status, version FROM nodes ORDER BY type, name"
    ).all() as any[]
    return rows.map(row => ({
      id: row.id,
      type: row.type,
      name: row.name,
      status: row.status,
      version: row.version,
    }))
  }

  /**
   * Get all relationships (for small graphs or when full data is needed).
   * Returns just the dashboard-relevant fields.
   */
  getAllRelationshipsSummary(): Array<{ id: string; from: string; to: string; type: string }> {
    const db = this.getDb()
    const rows = db.query(
      "SELECT id, from_id, to_id, type FROM relationships"
    ).all() as any[]
    return rows.map(row => ({
      id: row.id,
      from: row.from_id,
      to: row.to_id,
      type: row.type,
    }))
  }

  /**
   * Get updated_at timestamp — O(1).
   */
  getUpdatedAt(): string {
    const db = this.getDb()
    const row = db.query("SELECT value FROM graph_metadata WHERE key = 'updated_at'").get() as any
    return row?.value || ""
  }
}
