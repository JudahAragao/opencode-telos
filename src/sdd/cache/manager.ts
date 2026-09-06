import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs"
import { join, dirname } from "path"
import { createHash } from "crypto"
import { PerTypeGraphCache, IncrementalGraphHash } from "../graph/index.js"
import type { AnyNode, NodeType, Relationship } from "../domain/types.js"
import { getGraphSnapshotStore } from "./snapshot-store.js"
import type { KnowledgeGraph } from "../domain/types.js"

// ── Cache Entry Types ────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T
  timestamp: number
  version: number
  accessCount: number
  lastAccess: number
}

interface ToolCacheEntry {
  response: string
  timestamp: number
  lastAccess: number
  toolName: string
  argsHash: string
  graphVersion: string
}

interface AnalysisCacheEntry {
  result: unknown
  timestamp: number
  lastAccess: number
  graphVersion: number
  nodeCount: number
  type: string
}

interface PersistentCacheData {
  version: number
  toolResponses: Record<string, ToolCacheEntry>
  analysisResults: Record<string, AnalysisCacheEntry>
  graphSnapshot: {
    nodeCount: number
    relationshipCount: number
    version: string
    lastModified: number
  } | null
  graphHash: string
}

// ── Granular Invalidation Tracking ───────────────────────────────────

interface InvalidationTracker {
  lastFullInvalidation: number
  dirtyTypes: Set<string>
  dirtyNodeIds: Set<string>
  dirtyRelTypes: Set<string>
  version: number
}

// ── Main Cache Manager ───────────────────────────────────────────────

const TOOL_RESPONSE_TTL = 5 * 60 * 1000      // 5 minutes
const ANALYSIS_TTL = 3 * 60 * 1000            // 3 minutes
const PERSISTENT_CACHE_FILE = ".sdd/cache.json"
const INVALIDATION_FILE = ".sdd/cache-invalidated.json"

export class CacheManager {
  private projectDir: string

  // In-memory caches
  private toolResponses: Map<string, ToolCacheEntry> = new Map()
  private analysisResults: Map<string, AnalysisCacheEntry> = new Map()

  // Granular invalidation tracker
  private invalidation: InvalidationTracker = {
    lastFullInvalidation: 0,
    dirtyTypes: new Set(),
    dirtyNodeIds: new Set(),
    dirtyRelTypes: new Set(),
    version: 0,
  }

  // Version counter for lazy revalidation (F)
  private invalidationVersionOnWrite: number = 0

  // Per-type graph cache
  private graphCache = new PerTypeGraphCache()

  // Incremental graph hash
  private graphHash = new IncrementalGraphHash()

  // Statistics
  private stats = {
    toolHits: 0,
    toolMisses: 0,
    analysisHits: 0,
    analysisMisses: 0,
    invalidations: 0,
  }

  constructor(projectDir: string) {
    this.projectDir = projectDir
    this.loadInvalidationTracker()
    this.invalidationVersionOnWrite = this.invalidation.version
  }

  // ── Tool Response Cache ───────────────────────────────────────────

  /**
   * Get cached tool response if valid.
   * Checks: TTL (using lastAccess for freshness), graph version, invalidation status.
   * F: Uses lazy revalidation — checks version before clearing.
   */
  getToolResponse(toolName: string, args: Record<string, unknown>, graphVersion: string): string | null {
    const key = this.toolCacheKey(toolName, args)
    const entry = this.toolResponses.get(key)

    if (!entry) {
      this.stats.toolMisses++
      return null
    }

    // F: Lazy revalidation — if invalidation version changed, check if this entry is affected
    if (this.invalidation.version !== this.invalidationVersionOnWrite) {
      if (this.isToolAffectedByInvalidation(toolName, entry.argsHash)) {
        this.toolResponses.delete(key)
        this.clearDirtyTypesForTool(toolName)
        this.stats.toolMisses++
        return null
      }
    }

    // B: Check TTL using lastAccess (not timestamp) — entries accessed recently survive restore
    const effectiveAge = Date.now() - (entry.lastAccess || entry.timestamp)
    if (effectiveAge > TOOL_RESPONSE_TTL) {
      this.toolResponses.delete(key)
      this.stats.toolMisses++
      return null
    }

    // Check graph version consistency
    if (entry.graphVersion !== graphVersion) {
      this.toolResponses.delete(key)
      this.stats.toolMisses++
      return null
    }

    // Update access stats — refresh lastAccess on hit
    entry.lastAccess = Date.now()
    this.stats.toolHits++
    return entry.response
  }

  /**
   * Cache a tool response.
   */
  setToolResponse(toolName: string, args: Record<string, unknown>, response: string, graphVersion: string): void {
    const key = this.toolCacheKey(toolName, args)
    const now = Date.now()
    this.toolResponses.set(key, {
      response,
      timestamp: now,
      lastAccess: now,
      toolName,
      argsHash: this.toolCacheKey(toolName, args).split(':')[1] || '',
      graphVersion,
    })

    // Evict old entries if cache is too large
    if (this.toolResponses.size > 200) {
      this.evictOldestToolEntries(50)
    }
  }

  // ── Analysis Result Cache ─────────────────────────────────────────

  /**
   * Get cached analysis result (validate, drift, quality, etc.).
   * Revalidates based on graph state.
   * F: Uses lazy revalidation.
   */
  getAnalysisResult(type: string, graphVersion: number, nodeCount: number): unknown | null {
    const key = `analysis:${type}`
    const entry = this.analysisResults.get(key)

    if (!entry) {
      this.stats.analysisMisses++
      return null
    }

    // F: Lazy revalidation
    if (this.invalidation.version !== this.invalidationVersionOnWrite) {
      if (this.isAnalysisAffectedByInvalidation(type)) {
        this.analysisResults.delete(key)
        this.clearDirtyTypesForAnalysis(type)
        this.stats.analysisMisses++
        return null
      }
    }

    // B: Check TTL using lastAccess
    const effectiveAge = Date.now() - (entry.lastAccess || entry.timestamp)
    if (effectiveAge > ANALYSIS_TTL) {
      this.analysisResults.delete(key)
      this.stats.analysisMisses++
      return null
    }

    // Revalidation: if graph changed since analysis, invalidate
    if (entry.graphVersion !== graphVersion || entry.nodeCount !== nodeCount) {
      this.analysisResults.delete(key)
      this.stats.analysisMisses++
      return null
    }

    // Update lastAccess
    entry.lastAccess = Date.now()
    this.stats.analysisHits++
    return entry.result
  }

  /**
   * Cache an analysis result.
   */
  setAnalysisResult(type: string, result: unknown, graphVersion: number, nodeCount: number): void {
    const key = `analysis:${type}`
    const now = Date.now()
    this.analysisResults.set(key, {
      result,
      timestamp: now,
      lastAccess: now,
      graphVersion,
      nodeCount,
      type,
    })
  }

  // ── Granular Invalidation ─────────────────────────────────────────

  /**
   * Mark specific node IDs as dirty.
   */
  invalidateNodeIds(ids: string[]): void {
    for (const id of ids) {
      this.invalidation.dirtyNodeIds.add(id)
    }
    this.invalidation.version++
    this.saveInvalidationTracker()
  }

  /**
   * Mark specific relationship types as dirty.
   */
  invalidateRelTypes(types: string[]): void {
    for (const type of types) {
      this.invalidation.dirtyRelTypes.add(type)
    }
    this.invalidation.version++
    this.saveInvalidationTracker()
  }

  /**
   * Full invalidation: clear everything.
   * Now reserved only for explicit reset (H) or major structural changes.
   */
  invalidateAll(): void {
    this.toolResponses.clear()
    this.analysisResults.clear()
    this.graphCache.invalidateAll()
    this.invalidation.lastFullInvalidation = Date.now()
    this.invalidation.dirtyTypes.clear()
    this.invalidation.dirtyNodeIds.clear()
    this.invalidation.dirtyRelTypes.clear()
    this.invalidation.version++
    this.stats.invalidations++
    this.saveInvalidationTracker()
  }

  /**
   * Partial invalidation: clear only affected caches.
   * A: Much faster than full invalidation for targeted changes.
   * Called by repositories after saveGraph() with the dirty types.
   */
  invalidatePartial(changedNodeTypes: string[], changedRelTypes: string[] = []): void {
    // Invalidate tool responses that depend on changed types
    for (const [key, entry] of this.toolResponses) {
      if (this.doesToolDependOnTypes(key, changedNodeTypes, changedRelTypes)) {
        this.toolResponses.delete(key)
      }
    }

    // Invalidate analysis results that depend on changed types
    for (const [key, entry] of this.analysisResults) {
      if (this.doesAnalysisDependOnTypes(key, changedNodeTypes, changedRelTypes)) {
        this.analysisResults.delete(key)
      }
    }

    // Track dirty types
    this.invalidateNodeTypes(changedNodeTypes)
    this.invalidateRelTypes(changedRelTypes)
  }

  /**
   * Invalidate specific node IDs (e.g., when a node is updated).
   */
  invalidateNodeId(nodeId: string, nodeType: string): void {
    // Invalidate tool responses that mention this node
    for (const [key, entry] of this.toolResponses) {
      if (entry.response.includes(nodeId)) {
        this.toolResponses.delete(key)
      }
    }

    // Invalidate analysis results for this node type
    const analysisTypes = this.getAnalysisTypesForNodeType(nodeType)
    for (const type of analysisTypes) {
      this.analysisResults.delete(`analysis:${type}`)
    }

    this.invalidation.dirtyNodeIds.add(nodeId)
    this.invalidation.dirtyTypes.add(nodeType)
    this.invalidation.version++
    this.saveInvalidationTracker()
  }

  // ── Persistent Cache (Cross-Session) ──────────────────────────────

  /**
   * Load persistent cache from disk.
   */
  loadPersistentCache(): PersistentCacheData | null {
    const path = join(this.projectDir, PERSISTENT_CACHE_FILE)
    if (!existsSync(path)) return null
    try {
      const data = JSON.parse(readFileSync(path, "utf-8"))
      // Check if persistent cache is too old (>1 hour)
      if (Date.now() - (data.timestamp || 0) > 60 * 60 * 1000) {
        return null
      }
      return data
    } catch {
      return null
    }
  }

  /**
   * Save persistent cache to disk.
   */
  savePersistentCache(data: PersistentCacheData): void {
    const path = join(this.projectDir, PERSISTENT_CACHE_FILE)
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(path, JSON.stringify({ ...data, timestamp: Date.now() }, null, 2))
  }

  /**
   * Restore tool responses from persistent cache.
   * B: Uses lastAccess for TTL check so recently-accessed entries survive restore.
   */
  restoreFromPersistentCache(): number {
    const persistent = this.loadPersistentCache()
    if (!persistent) return 0

    let restored = 0
    for (const [key, entry] of Object.entries(persistent.toolResponses)) {
      // B: Use lastAccess for freshness check — entries accessed recently are valid
      const effectiveAge = Date.now() - (entry.lastAccess || entry.timestamp)
      if (effectiveAge < TOOL_RESPONSE_TTL) {
        this.toolResponses.set(key, {
          response: entry.response,
          timestamp: entry.timestamp,
          lastAccess: entry.lastAccess || entry.timestamp,
          toolName: entry.toolName,
          argsHash: entry.argsHash,
          graphVersion: entry.graphVersion,
        })
        restored++
      }
    }

    for (const [key, entry] of Object.entries(persistent.analysisResults)) {
      const effectiveAge = Date.now() - (entry.lastAccess || entry.timestamp)
      if (effectiveAge < ANALYSIS_TTL) {
        this.analysisResults.set(key, {
          result: entry.result,
          timestamp: entry.timestamp,
          lastAccess: entry.lastAccess || entry.timestamp,
          graphVersion: entry.graphVersion,
          nodeCount: entry.nodeCount,
          type: key.replace("analysis:", ""),
        })
        restored++
      }
    }

    return restored
  }

  /**
   * Persist current cache to disk.
   */
  persistToDisk(): void {
    const toolResponses: Record<string, ToolCacheEntry> = {}
    for (const [key, entry] of this.toolResponses) {
      toolResponses[key] = {
        response: entry.response,
        timestamp: entry.timestamp,
        lastAccess: entry.lastAccess,
        toolName: entry.toolName,
        argsHash: entry.argsHash,
        graphVersion: entry.graphVersion,
      }
    }

    const analysisResults: Record<string, AnalysisCacheEntry> = {}
    for (const [key, entry] of this.analysisResults) {
      analysisResults[key] = {
        result: entry.result,
        timestamp: entry.timestamp,
        lastAccess: entry.lastAccess,
        graphVersion: entry.graphVersion,
        nodeCount: entry.nodeCount,
        type: key.replace("analysis:", ""),
      }
    }

    this.savePersistentCache({
      version: 2,
      toolResponses,
      analysisResults,
      graphSnapshot: null,
      graphHash: this.graphHash.getHash(),
    })
  }

  /**
   * Save graph snapshot to disk (G).
   * Called after graph mutations and on dispose.
   */
  saveGraphSnapshot(graph: KnowledgeGraph): void {
    try {
      const store = getGraphSnapshotStore(this.projectDir)
      store.save(graph, this.graphHash.getHash())
    } catch {}
  }

  /**
   * Load graph snapshot from disk (G).
   * Returns null if no valid snapshot exists.
   */
  loadGraphSnapshot(): { graph: KnowledgeGraph; graphHash: string } | null {
    try {
      const store = getGraphSnapshotStore(this.projectDir)
      return store.load()
    } catch {
      return null
    }
  }

  /**
   * Invalidate graph snapshot on disk.
   */
  invalidateGraphSnapshot(): void {
    try {
      const store = getGraphSnapshotStore(this.projectDir)
      store.invalidate()
    } catch {}
  }

  // ── Cross-Process Shared Cache ────────────────────────────────────

  /**
   * D: Check if another process has modified the graph since our last read.
   * Uses file-based locking + PID liveness check for robust cross-process coordination.
   */
  checkCrossProcessInvalidation(graphPath: string): boolean {
    const lockPath = join(this.projectDir, ".sdd", ".cache-lock")
    try {
      if (existsSync(lockPath)) {
        const lockData = JSON.parse(readFileSync(lockPath, "utf-8"))

        // D: If lock is older than 30 seconds, check if the process is still alive
        if (Date.now() - lockData.timestamp > 30000) {
          // D: If the locking process is dead, treat as invalidation needed
          if (lockData.pid && lockData.pid !== process.pid) {
            try {
              process.kill(lockData.pid, 0) // Signal 0 = check if alive
              // Process is alive but lock is stale — another process is slow, ignore
              return false
            } catch {
              // Process is dead — force invalidation
              this.invalidation.lastFullInvalidation = Date.now()
              this.invalidation.version++
              return true
            }
          }
          return false // Stale lock from same process or no PID
        }

        // If another process wrote after our last read
        if (lockData.timestamp > (this.invalidation.lastFullInvalidation || 0)) {
          return true
        }
      }
    } catch {}
    return false
  }

  /**
   * Acquire cross-process lock before writing.
   */
  acquireWriteLock(): boolean {
    const lockPath = join(this.projectDir, ".sdd", ".cache-lock")
    const dir = dirname(lockPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    try {
      // Try to create lock file
      if (existsSync(lockPath)) {
        const existing = JSON.parse(readFileSync(lockPath, "utf-8"))
        // If lock is stale (>30s), override it
        if (Date.now() - existing.timestamp > 30000) {
          // Stale lock, ok to override
        } else if (existing.pid !== process.pid) {
          return false // Another process holds the lock
        }
      }

      writeFileSync(lockPath, JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
      }))
      return true
    } catch {
      return false
    }
  }

  /**
   * Release cross-process lock.
   */
  releaseWriteLock(): void {
    const lockPath = join(this.projectDir, ".sdd", ".cache-lock")
    try {
      if (existsSync(lockPath)) {
        const lockData = JSON.parse(readFileSync(lockPath, "utf-8"))
        if (lockData.pid === process.pid) {
          unlinkSync(lockPath)
        }
      }
    } catch {}
  }

  // ── Full Reset (H) ───────────────────────────────────────────────

  /**
   * H: Full cache reset — clears everything in memory and on disk.
   * Used by /sdd cache reset command.
   */
  fullReset(): { cleared: { memory: boolean; disk: boolean; snapshot: boolean; lock: boolean } } {
    // Clear in-memory
    this.toolResponses.clear()
    this.analysisResults.clear()
    this.graphCache.invalidateAll()

    // Reset invalidation tracker
    this.invalidation.lastFullInvalidation = Date.now()
    this.invalidation.dirtyTypes.clear()
    this.invalidation.dirtyNodeIds.clear()
    this.invalidation.dirtyRelTypes.clear()
    this.invalidation.version++
    this.stats.invalidations++
    this.saveInvalidationTracker()

    // Clear persistent cache on disk
    let disk = false
    try {
      const cachePath = join(this.projectDir, PERSISTENT_CACHE_FILE)
      if (existsSync(cachePath)) {
        unlinkSync(cachePath)
        disk = true
      }
    } catch {}

    // Clear graph snapshot (G)
    let snapshot = false
    try {
      const store = getGraphSnapshotStore(this.projectDir)
      if (store.isValid()) {
        store.invalidate()
        snapshot = true
      }
    } catch {}

    // Release lock
    let lock = false
    try {
      const lockPath = join(this.projectDir, ".sdd", ".cache-lock")
      if (existsSync(lockPath)) {
        this.releaseWriteLock()
        lock = true
      }
    } catch {}

    return { cleared: { memory: true, disk, snapshot, lock } }
  }

  /**
   * Get current invalidation version (for external checks).
   */
  getInvalidationVersion(): number {
    return this.invalidation.version
  }

  /**
   * Sync invalidation version after external write.
   */
  syncInvalidationVersion(): void {
    this.invalidationVersionOnWrite = this.invalidation.version
  }

  // ── Per-Type Graph Cache ──────────────────────────────────────────

  /**
   * Get cached nodes for a specific type.
   * Only returns if the cache version matches.
   */
  getCachedNodesByType(type: NodeType, graphVersion: number): AnyNode[] | null {
    return this.graphCache.getNodesByType(type, graphVersion)
  }

  /**
   * Cache nodes for a specific type.
   */
  setCachedNodesByType(type: NodeType, nodes: AnyNode[], graphVersion: number): void {
    this.graphCache.setType(type, nodes, graphVersion)
  }

  /**
   * Invalidate cache for a specific node type only.
   * Other types remain cached.
   */
  invalidateNodeType(type: NodeType): void {
    this.graphCache.invalidateType(type)
    this.invalidateNodeTypes([type])
  }

  /**
   * Invalidate cache for multiple node types.
   */
  invalidateNodeTypes(types: string[]): void {
    for (const type of types) {
      this.invalidation.dirtyTypes.add(type)
      this.graphCache.invalidateType(type as NodeType)
    }
    this.invalidation.version++
    this.saveInvalidationTracker()
  }

  /**
   * Get cached relationships.
   */
  getCachedRelationships(graphVersion: number): Relationship[] | null {
    return this.graphCache.getRelationships(graphVersion)
  }

  /**
   * Cache relationships.
   */
  setCachedRelationships(rels: Relationship[], graphVersion: number): void {
    this.graphCache.setRelationships(rels, graphVersion)
  }

  // ── Incremental Graph Hash ────────────────────────────────────────

  /**
   * Initialize the incremental hash from graph state.
   */
  initGraphHash(nodeCount: number, relCount: number): void {
    this.graphHash.initialize(nodeCount, relCount)
  }

  /**
   * Record a node mutation for incremental hash.
   */
  recordNodeMutation(delta: number = 0): void {
    this.graphHash.recordNodeCountChange(delta)
  }

  /**
   * Record a relationship mutation for incremental hash.
   */
  recordRelMutation(delta: number = 0): void {
    this.graphHash.recordRelCountChange(delta)
  }

  /**
   * Get current graph hash.
   */
  getGraphHash(): string {
    return this.graphHash.getHash()
  }

  /**
   * Check if graph hash matches.
   */
  isGraphHashValid(expectedHash: string): boolean {
    return this.graphHash.matches(expectedHash)
  }

  /**
   * Get current node count from incremental hash.
   */
  getNodeCountFromHash(): number {
    return this.graphHash.getNodeCount()
  }

  // ── Statistics ────────────────────────────────────────────────────

  getStats() {
    return {
      ...this.stats,
      toolCacheSize: this.toolResponses.size,
      analysisCacheSize: this.analysisResults.size,
      invalidationVersion: this.invalidation.version,
      hitRate: this.stats.toolHits + this.stats.toolMisses > 0
        ? (this.stats.toolHits / (this.stats.toolHits + this.stats.toolMisses) * 100).toFixed(1) + "%"
        : "0%",
      analysisHitRate: this.stats.analysisHits + this.stats.analysisMisses > 0
        ? (this.stats.analysisHits / (this.stats.analysisHits + this.stats.analysisMisses) * 100).toFixed(1) + "%"
        : "0%",
    }
  }

  // ── Private Helpers ───────────────────────────────────────────────

  private toolCacheKey(toolName: string, args: Record<string, unknown>): string {
    const argsStr = JSON.stringify(args, Object.keys(args).sort())
    const argsHash = createHash("md5").update(argsStr).digest("hex").slice(0, 8)
    return `${toolName}:${argsHash}`
  }

  private isToolAffectedByInvalidation(toolName: string, argsHash: string): boolean {
    // Check if the tool's dependent types have been invalidated
    const dependentTypes = this.getToolDependentTypes(toolName)
    for (const type of dependentTypes) {
      if (this.invalidation.dirtyTypes.has(type)) return true
    }
    return false
  }

  private isAnalysisAffectedByInvalidation(analysisType: string): boolean {
    const dependentTypes = this.getAnalysisDependentTypes(analysisType)
    for (const type of dependentTypes) {
      if (this.invalidation.dirtyTypes.has(type)) return true
    }
    return false
  }

  /**
   * Clear dirty types that are relevant to a specific analysis type.
   * Called after the analysis cache entry has been invalidated due to dirty types.
   * This allows the cache to work again after the analysis is recomputed.
   */
  private clearDirtyTypesForAnalysis(analysisType: string): void {
    const dependentTypes = this.getAnalysisDependentTypes(analysisType)
    for (const type of dependentTypes) {
      this.invalidation.dirtyTypes.delete(type)
    }
    this.invalidation.version++
  }

  /**
   * Clear dirty types that are relevant to a specific tool.
   */
  private clearDirtyTypesForTool(toolName: string): void {
    const dependentTypes = this.getToolDependentTypes(toolName)
    for (const type of dependentTypes) {
      this.invalidation.dirtyTypes.delete(type)
    }
    this.invalidation.version++
  }

  private getToolDependentTypes(toolName: string): string[] {
    const map: Record<string, string[]> = {
      "sdd.query_graph": [], // depends on any type
      "sdd.list_nodes": [], // depends on queried type
      "sdd.get_nodes_by_status": [],
      "sdd.count_nodes": [],
      "sdd.inspect": [],
      "sdd.validate": ["feature", "requirement", "entity", "api", "endpoint", "table", "task", "test", "change", "constitution", "business_rule"],
      "sdd.detect_drift": ["file", "task", "change", "entity", "api"],
      "sdd.quality": ["feature", "requirement", "entity", "api", "endpoint", "task", "test", "change", "constitution", "business_rule"],
      "sdd.anti_patterns": ["feature", "requirement", "entity", "change", "task", "test"],
      "sdd.contradictions": ["requirement", "business_rule", "constraint"],
      "sdd.coverage": ["requirement", "test"],
      "sdd.analyze_impact": [],
      "sdd.get_context": [],
      "sdd.pending_changes": ["change"],
      "sdd.session_handoff": ["change", "decision"],
    }
    return map[toolName] || []
  }

  private getAnalysisDependentTypes(analysisType: string): string[] {
    const map: Record<string, string[]> = {
      "validate": ["feature", "requirement", "entity", "api", "endpoint", "table", "task", "test", "change", "constitution", "business_rule"],
      "drift": ["file", "task", "change", "entity", "api"],
      "quality": ["feature", "requirement", "entity", "api", "endpoint", "task", "test", "change", "constitution", "business_rule"],
      "anti_patterns": ["feature", "requirement", "entity", "change", "task", "test"],
      "contradictions": ["requirement", "business_rule", "constraint"],
      "coverage": ["requirement", "test"],
      "constitution": ["constitution", "feature", "requirement", "entity", "business_rule"],
      "promises": ["requirement", "business_rule"],
      "integrity": [],
    }
    return map[analysisType] || []
  }

  private getAnalysisTypesForNodeType(nodeType: string): string[] {
    const map: Record<string, string[]> = {
      "feature": ["validate", "quality", "anti_patterns"],
      "requirement": ["validate", "quality", "coverage", "promises", "constitution"],
      "entity": ["validate", "quality", "drift"],
      "endpoint": ["validate", "quality"],
      "api": ["validate", "quality"],
      "business_rule": ["validate", "quality", "contradictions", "promises"],
      "change": ["validate", "quality", "anti_patterns"],
      "task": ["validate", "quality", "drift"],
      "test": ["validate", "quality", "coverage"],
      "file": ["drift"],
      "constitution": ["validate", "constitution"],
      "constraint": ["contradictions"],
    }
    return map[nodeType] || []
  }

  private doesToolDependOnTypes(key: string, types: string[], relTypes: string[]): boolean {
    const toolName = key.split(":")[0]
    const depTypes = this.getToolDependentTypes(toolName)
    if (depTypes.length === 0) return true // Unknown dependency, invalidate to be safe
    return types.some(t => depTypes.includes(t))
  }

  private doesAnalysisDependOnTypes(key: string, types: string[], relTypes: string[]): boolean {
    const analysisType = key.replace("analysis:", "")
    const depTypes = this.getAnalysisDependentTypes(analysisType)
    if (depTypes.length === 0) return true
    return types.some(t => depTypes.includes(t))
  }

  private evictOldestToolEntries(count: number): void {
    const entries = [...this.toolResponses.entries()]
      .sort((a, b) => (a[1].lastAccess || a[1].timestamp) - (b[1].lastAccess || b[1].timestamp))
    for (let i = 0; i < count && i < entries.length; i++) {
      this.toolResponses.delete(entries[i][0])
    }
  }

  private loadInvalidationTracker(): void {
    const path = join(this.projectDir, INVALIDATION_FILE)
    if (!existsSync(path)) return
    try {
      const data = JSON.parse(readFileSync(path, "utf-8"))
      this.invalidation.lastFullInvalidation = data.lastFullInvalidation || 0
      this.invalidation.version = data.version || 0
      this.invalidation.dirtyTypes = new Set(data.dirtyTypes || [])
      this.invalidation.dirtyNodeIds = new Set(data.dirtyNodeIds || [])
      this.invalidation.dirtyRelTypes = new Set(data.dirtyRelTypes || [])
    } catch {}
  }

  private saveInvalidationTracker(): void {
    const path = join(this.projectDir, INVALIDATION_FILE)
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(path, JSON.stringify({
      lastFullInvalidation: this.invalidation.lastFullInvalidation,
      version: this.invalidation.version,
      dirtyTypes: [...this.invalidation.dirtyTypes],
      dirtyNodeIds: [...this.invalidation.dirtyNodeIds],
      dirtyRelTypes: [...this.invalidation.dirtyRelTypes],
    }))
  }
}

// ── Singleton per project ────────────────────────────────────────────

const instances = new Map<string, CacheManager>()

export function getCacheManager(projectDir: string): CacheManager {
  let instance = instances.get(projectDir)
  if (!instance) {
    instance = new CacheManager(projectDir)
    instances.set(projectDir, instance)
  }
  return instance
}
