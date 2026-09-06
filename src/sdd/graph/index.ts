import type { KnowledgeGraph, AnyNode, NodeType, NodeStatus, Relationship, RelationshipType } from "../domain/types.js"

/**
 * Pre-computed indices for O(1) lookups on a KnowledgeGraph.
 * Supports both full rebuild and incremental updates.
 */
export class GraphIndices {
  readonly byId: Map<string, AnyNode>
  readonly byType: Map<NodeType, AnyNode[]>
  readonly byStatus: Map<NodeStatus, AnyNode[]>
  readonly outgoing: Map<string, Relationship[]>
  readonly incoming: Map<string, Relationship[]>
  readonly all: Map<string, Relationship[]>
  readonly relByType: Map<RelationshipType, Relationship[]>
  readonly neighbors: Map<string, Set<string>>
  readonly searchIndex: InvertedIndex
  readonly totalNodes: number
  readonly totalRelationships: number

  private constructor(graph: KnowledgeGraph) {
    this.byId = new Map()
    this.byType = new Map()
    this.byStatus = new Map()
    this.outgoing = new Map()
    this.incoming = new Map()
    this.all = new Map()
    this.relByType = new Map()
    this.neighbors = new Map()
    this.searchIndex = new InvertedIndex()
    this.totalNodes = graph.nodes.length
    this.totalRelationships = graph.relationships.length

    this.buildNodeIndices(graph)
    this.buildRelationshipIndices(graph)
    this.buildSearchIndex(graph)
  }

  static from(graph: KnowledgeGraph): GraphIndices {
    return new GraphIndices(graph)
  }

  // ── Node index building ────────────────────────────────────────────

  private buildNodeIndices(graph: KnowledgeGraph): void {
    for (const node of graph.nodes) {
      this.byId.set(node.id, node)

      const typeList = this.byType.get(node.type)
      if (typeList) typeList.push(node)
      else this.byType.set(node.type, [node])

      const statusList = this.byStatus.get(node.status)
      if (statusList) statusList.push(node)
      else this.byStatus.set(node.status, [node])

      this.neighbors.set(node.id, new Set())
    }
  }

  // ── Relationship index building ────────────────────────────────────

  private buildRelationshipIndices(graph: KnowledgeGraph): void {
    for (const rel of graph.relationships) {
      this.addToRelIndices(rel)
    }
  }

  private addToRelIndices(rel: Relationship): void {
    const outgoingList = this.outgoing.get(rel.from)
    if (outgoingList) outgoingList.push(rel)
    else this.outgoing.set(rel.from, [rel])

    const incomingList = this.incoming.get(rel.to)
    if (incomingList) incomingList.push(rel)
    else this.incoming.set(rel.to, [rel])

    const allList = this.all.get(rel.from)
    if (allList) allList.push(rel)
    else this.all.set(rel.from, [rel])

    if (rel.from !== rel.to) {
      const allListTo = this.all.get(rel.to)
      if (allListTo) allListTo.push(rel)
      else this.all.set(rel.to, [rel])
    }

    const relTypeList = this.relByType.get(rel.type)
    if (relTypeList) relTypeList.push(rel)
    else this.relByType.set(rel.type, [rel])

    this.neighbors.get(rel.from)?.add(rel.to)
    this.neighbors.get(rel.to)?.add(rel.from)
  }

  private removeFromRelIndices(rel: Relationship): void {
    const removeById = (map: Map<string, Relationship[]>, key: string, rel: Relationship) => {
      const list = map.get(key)
      if (list) {
        const idx = list.findIndex(r => r.id === rel.id)
        if (idx !== -1) list.splice(idx, 1)
      }
    }

    removeById(this.outgoing, rel.from, rel)
    removeById(this.incoming, rel.to, rel)
    removeById(this.all, rel.from, rel)
    if (rel.from !== rel.to) removeById(this.all, rel.to, rel)

    const relTypeList = this.relByType.get(rel.type)
    if (relTypeList) {
      const idx = relTypeList.findIndex(r => r.id === rel.id)
      if (idx !== -1) relTypeList.splice(idx, 1)
    }

    this.neighbors.get(rel.from)?.delete(rel.to)
    this.neighbors.get(rel.to)?.delete(rel.from)
  }

  // ── Search index building ──────────────────────────────────────────

  private buildSearchIndex(graph: KnowledgeGraph): void {
    for (const node of graph.nodes) {
      this.indexNodeForSearch(node)
    }
  }

  private indexNodeForSearch(node: AnyNode): void {
    const tokens = new Set<string>()

    tokens.add(node.id.toLowerCase())
    tokens.add(node.type.toLowerCase())
    tokens.add(node.status.toLowerCase())
    tokens.add(node.name.toLowerCase())

    if (node.description) {
      tokenize(node.description, tokens)
    }

    const meta = node.metadata as Record<string, unknown>
    for (const [key, value] of Object.entries(meta)) {
      tokens.add(key.toLowerCase())
      if (typeof value === "string") {
        tokenize(value, tokens)
      } else if (typeof value === "number") {
        tokens.add(String(value))
      }
    }

    this.searchIndex.add(node.id, tokens)
  }

  // ── Incremental Updates ────────────────────────────────────────────

  /**
   * Add a single node to all indices without rebuilding.
   * O(1) per index, no full scan.
   */
  addNode(node: AnyNode): void {
    this.byId.set(node.id, node)

    const typeList = this.byType.get(node.type)
    if (typeList) typeList.push(node)
    else this.byType.set(node.type, [node])

    const statusList = this.byStatus.get(node.status)
    if (statusList) statusList.push(node)
    else this.byStatus.set(node.status, [node])

    this.neighbors.set(node.id, new Set())
    this.indexNodeForSearch(node)
  }

  /**
   * Update a single node in all indices without rebuilding.
   * Only updates the specific entries that changed.
   */
  updateNode(oldNode: AnyNode, newNode: AnyNode): void {
    // Update byId
    this.byId.set(newNode.id, newNode)

    // Update byType if type changed
    if (oldNode.type !== newNode.type) {
      const oldTypeList = this.byType.get(oldNode.type)
      if (oldTypeList) {
        const idx = oldTypeList.findIndex(n => n.id === oldNode.id)
        if (idx !== -1) oldTypeList.splice(idx, 1)
      }
      const newTypeList = this.byType.get(newNode.type)
      if (newTypeList) newTypeList.push(newNode)
      else this.byType.set(newNode.type, [newNode])
    }

    // Update byStatus if status changed
    if (oldNode.status !== newNode.status) {
      const oldStatusList = this.byStatus.get(oldNode.status)
      if (oldStatusList) {
        const idx = oldStatusList.findIndex(n => n.id === oldNode.id)
        if (idx !== -1) oldStatusList.splice(idx, 1)
      }
      const newStatusList = this.byStatus.get(newNode.status)
      if (newStatusList) newStatusList.push(newNode)
      else this.byStatus.set(newNode.status, [newNode])
    }

    // Update search index
    this.searchIndex.remove(oldNode.id)
    this.indexNodeForSearch(newNode)
  }

  /**
   * Remove a single node from all indices without rebuilding.
   */
  removeNode(nodeId: string): void {
    const node = this.byId.get(nodeId)
    if (!node) return

    this.byId.delete(nodeId)

    // Remove from byType
    const typeList = this.byType.get(node.type)
    if (typeList) {
      const idx = typeList.findIndex(n => n.id === nodeId)
      if (idx !== -1) typeList.splice(idx, 1)
    }

    // Remove from byStatus
    const statusList = this.byStatus.get(node.status)
    if (statusList) {
      const idx = statusList.findIndex(n => n.id === nodeId)
      if (idx !== -1) statusList.splice(idx, 1)
    }

    // Remove from neighbors
    this.neighbors.delete(nodeId)
    for (const [, neighbors] of this.neighbors) {
      neighbors.delete(nodeId)
    }

    // Remove from search index
    this.searchIndex.remove(nodeId)
  }

  /**
   * Add a relationship to indices without rebuilding.
   */
  addRelationship(rel: Relationship): void {
    this.addToRelIndices(rel)
  }

  /**
   * Remove a relationship from indices without rebuilding.
   */
  removeRelationship(rel: Relationship): void {
    this.removeFromRelIndices(rel)
  }

  // ── Query helpers ──────────────────────────────────────────────────

  getNode(id: string): AnyNode | undefined {
    return this.byId.get(id)
  }

  getNodesByType(type: NodeType): AnyNode[] {
    return this.byType.get(type) || []
  }

  getNodesByStatus(status: NodeStatus): AnyNode[] {
    return this.byStatus.get(status) || []
  }

  getOutgoing(nodeId: string): Relationship[] {
    return this.outgoing.get(nodeId) || []
  }

  getIncoming(nodeId: string): Relationship[] {
    return this.incoming.get(nodeId) || []
  }

  getRelationships(nodeId: string): Relationship[] {
    return this.all.get(nodeId) || []
  }

  getNeighborIds(nodeId: string): Set<string> {
    return this.neighbors.get(nodeId) || new Set()
  }

  search(query: string, type?: NodeType): AnyNode[] {
    const queryTokens = new Set<string>()
    tokenize(query, queryTokens)
    if (queryTokens.size === 0) return []

    let candidateIds = this.searchIndex.search(queryTokens)
    if (type) {
      const typeNodes = this.byType.get(type)
      if (!typeNodes) return []
      const typeIdSet = new Set(typeNodes.map(n => n.id))
      candidateIds = candidateIds.filter(id => typeIdSet.has(id))
    }

    return candidateIds
      .map(id => this.byId.get(id))
      .filter((n): n is AnyNode => n !== undefined)
  }
}

/**
 * Inverted index for fast text search.
 * Supports incremental add/remove.
 */
export class InvertedIndex {
  private index: Map<string, Set<string>> = new Map()

  add(nodeId: string, tokens: Set<string>): void {
    for (const token of tokens) {
      const existing = this.index.get(token)
      if (existing) existing.add(nodeId)
      else this.index.set(token, new Set([nodeId]))
    }
  }

  remove(nodeId: string): void {
    for (const [, nodeIds] of this.index) {
      nodeIds.delete(nodeId)
    }
  }

  search(queryTokens: Set<string>): string[] {
    const resultIds = new Set<string>()
    for (const token of queryTokens) {
      const matches = this.index.get(token)
      if (matches) {
        for (const id of matches) resultIds.add(id)
      }
    }
    return [...resultIds]
  }

  searchAnd(queryTokens: Set<string>): string[] {
    const arrays: string[][] = []
    for (const token of queryTokens) {
      const matches = this.index.get(token)
      if (!matches || matches.size === 0) return []
      arrays.push([...matches])
    }
    if (arrays.length === 0) return []

    arrays.sort((a, b) => a.length - b.length)

    let result = new Set(arrays[0])
    for (let i = 1; i < arrays.length; i++) {
      const currentSet = new Set(arrays[i])
      result = new Set([...result].filter(id => currentSet.has(id)))
      if (result.size === 0) return []
    }
    return [...result]
  }
}

// ── Utility ──────────────────────────────────────────────────────────

function tokenize(text: string, output: Set<string>): void {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F]+/g, " ")
    .trim()

  for (const word of normalized.split(/\s+/)) {
    if (word.length > 1) {
      output.add(word)
      const stemmed = stem(word)
      if (stemmed !== word) output.add(stemmed)
    }
  }
}

function stem(word: string): string {
  if (word.length <= 4) return word
  const suffixes = [
    "mentes", "mento", "ções", "ção", "mente", "avel", "ivel",
    "ments", "tion", "ness", "able", "ible", "ling",
    "ated", "ting", "ship", "less", "ence", "ance",
    "ised", "ized", "ally", "ical",
    "es", "ed", "er", "ly", "ing", "ion", "al", "en", "s",
  ]
  for (const suffix of suffixes) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, -suffix.length)
    }
  }
  return word
}

// ── Per-Type Graph Cache ─────────────────────────────────────────────

/**
 * Granular graph cache that stores nodes by type separately.
 * Only the affected type is invalidated on mutation.
 */
export class PerTypeGraphCache {
  private nodesByType: Map<NodeType, AnyNode[]> = new Map()
  private relationships: Relationship[] = []
  private graphVersion: number = 0
  private lastFullRebuild: number = 0

  /**
   * Get nodes of a specific type from cache.
   * Returns null if cache miss for that type.
   */
  getNodesByType(type: NodeType, currentVersion: number): AnyNode[] | null {
    if (currentVersion !== this.graphVersion) return null
    return this.nodesByType.get(type) || []
  }

  /**
   * Get all relationships from cache.
   */
  getRelationships(currentVersion: number): Relationship[] | null {
    if (currentVersion !== this.graphVersion) return null
    return this.relationships
  }

  /**
   * Populate cache for a specific type only.
   */
  setType(type: NodeType, nodes: AnyNode[], version: number): void {
    this.nodesByType.set(type, nodes)
    this.graphVersion = version
  }

  /**
   * Set relationships cache.
   */
  setRelationships(rels: Relationship[], version: number): void {
    this.relationships = rels
    this.graphVersion = version
  }

  /**
   * Invalidate only a specific type.
   */
  invalidateType(type: NodeType): void {
    this.nodesByType.delete(type)
  }

  /**
   * Invalidate relationships.
   */
  invalidateRelationships(): void {
    this.relationships = []
  }

  /**
   * Full invalidation (all types).
   */
  invalidateAll(): void {
    this.nodesByType.clear()
    this.relationships = []
    this.graphVersion = 0
  }

  /**
   * Check if cache is valid for a given version.
   */
  isValid(version: number): boolean {
    return version === this.graphVersion
  }
}

// ── Incremental Graph Hash ───────────────────────────────────────────

/**
 * Calculate a graph hash incrementally without reading the full graph.
 * Based on node count + relationship count + mutation counter.
 */
export class IncrementalGraphHash {
  private hash: string = ""
  private nodeCount: number = 0
  private relCount: number = 0
  private mutationCount: number = 0

  /**
   * Initialize from graph metadata.
   */
  initialize(nodeCount: number, relCount: number): void {
    this.nodeCount = nodeCount
    this.relCount = relCount
    this.mutationCount = 0
    this.hash = this.computeHash()
  }

  /**
   * Record a mutation (add/update/remove node or relationship).
   */
  recordMutation(): void {
    this.mutationCount++
    this.hash = this.computeHash()
  }

  /**
   * Record node count change.
   */
  recordNodeCountChange(delta: number): void {
    this.nodeCount += delta
    this.mutationCount++
    this.hash = this.computeHash()
  }

  /**
   * Record relationship count change.
   */
  recordRelCountChange(delta: number): void {
    this.relCount += delta
    this.mutationCount++
    this.hash = this.computeHash()
  }

  /**
   * Get current hash.
   */
  getHash(): string {
    return this.hash
  }

  /**
   * Get current node count.
   */
  getNodeCount(): number {
    return this.nodeCount
  }

  /**
   * Get current relationship count.
   */
  getRelCount(): number {
    return this.relCount
  }

  /**
   * Check if hash matches.
   */
  matches(otherHash: string): boolean {
    return this.hash === otherHash
  }

  private computeHash(): string {
    const data = `${this.nodeCount}:${this.relCount}:${this.mutationCount}`
    // Simple hash without crypto dependency
    let hash = 0
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return hash.toString(36)
  }
}

// ── Dirty State for Incremental Analysis ─────────────────────────────

export interface DirtyState {
  dirtyNodeIds: Set<string>
  dirtyTypes: Set<NodeType>
  allChanged: boolean
}

export function computeDirtyState(
  oldGraph: KnowledgeGraph | null,
  newGraph: KnowledgeGraph,
): DirtyState {
  if (!oldGraph) {
    return { dirtyNodeIds: new Set(), dirtyTypes: new Set(), allChanged: true }
  }

  const dirtyNodeIds = new Set<string>()
  const dirtyTypes = new Set<NodeType>()

  const oldNodeIds = new Set(oldGraph.nodes.map(n => n.id))
  const newNodeIds = new Set(newGraph.nodes.map(n => n.id))

  for (const node of newGraph.nodes) {
    if (!oldNodeIds.has(node.id)) {
      dirtyNodeIds.add(node.id)
      dirtyTypes.add(node.type)
    }
  }

  for (const node of oldGraph.nodes) {
    if (!newNodeIds.has(node.id)) {
      dirtyNodeIds.add(node.id)
      dirtyTypes.add(node.type)
    }
  }

  const oldNodeMap = new Map(oldGraph.nodes.map(n => [n.id, n]))
  for (const node of newGraph.nodes) {
    const old = oldNodeMap.get(node.id)
    if (old && old.version !== node.version) {
      dirtyNodeIds.add(node.id)
      dirtyTypes.add(node.type)
    }
  }

  if (oldGraph.relationships.length !== newGraph.relationships.length) {
    return { dirtyNodeIds, dirtyTypes, allChanged: true }
  }

  const oldRelKeys = new Set(
    oldGraph.relationships.map(r => `${r.from}||${r.to}||${r.type}`)
  )
  for (const rel of newGraph.relationships) {
    const key = `${rel.from}||${rel.to}||${rel.type}`
    if (!oldRelKeys.has(key)) {
      dirtyNodeIds.add(rel.from)
      dirtyNodeIds.add(rel.to)
    }
  }

  const expandedDirty = new Set(dirtyNodeIds)
  const relIndex = new Map<string, Set<string>>()
  for (const rel of newGraph.relationships) {
    if (!relIndex.has(rel.from)) relIndex.set(rel.from, new Set())
    if (!relIndex.has(rel.to)) relIndex.set(rel.to, new Set())
    relIndex.get(rel.from)!.add(rel.to)
    relIndex.get(rel.to)!.add(rel.from)
  }

  for (const dirtyId of dirtyNodeIds) {
    const adjacent = relIndex.get(dirtyId)
    if (adjacent) {
      for (const adjId of adjacent) expandedDirty.add(adjId)
    }
  }

  // Adaptive threshold: larger graphs tolerate higher % of dirty nodes
  // before falling back to full validation
  const adaptiveThreshold = computeAdaptiveThreshold(
    newGraph.nodes.length,
    dirtyNodeIds.size,
    dirtyTypes,
  )

  return {
    dirtyNodeIds: expandedDirty,
    dirtyTypes,
    allChanged: dirtyNodeIds.size > newGraph.nodes.length * adaptiveThreshold,
  }
}

/**
 * Compute an adaptive threshold for deciding when to fall back to full validation.
 *
 * Strategy:
 * - Small graphs (<50 nodes): conservative, fall back at 30%
 * - Medium graphs (50-200): moderate, fall back at 20%
 * - Large graphs (>200): permissive, fall back at 10%
 * - Metadata-only changes (no structural types): +15% more tolerance
 * - Structural changes (types/relationships): -10% less tolerance
 */
function computeAdaptiveThreshold(
  graphSize: number,
  dirtyCount: number,
  dirtyTypes: Set<NodeType>,
): number {
  // Base threshold by graph size
  let threshold: number
  if (graphSize < 50) {
    threshold = 0.30
  } else if (graphSize < 200) {
    threshold = 0.20
  } else {
    threshold = 0.10
  }

  // Adjust for change type
  const STRUCTURAL_TYPES: Set<string> = new Set([
    "architecture_component", "database", "table",
    "constitution", "deprecation", "migration",
  ])
  const METADATA_ONLY_TYPES: Set<string> = new Set([
    "task", "test", "decision", "constraint", "assumption",
    "metric", "alert", "sla",
  ])

  let hasStructural = false
  let hasMetadataOnly = true
  for (const t of dirtyTypes) {
    if (STRUCTURAL_TYPES.has(t)) hasStructural = true
    if (!METADATA_ONLY_TYPES.has(t)) hasMetadataOnly = false
  }

  if (hasMetadataOnly && dirtyTypes.size > 0) {
    threshold += 0.15 // More tolerance for metadata-only changes
  }
  if (hasStructural) {
    threshold -= 0.10 // Less tolerance for structural changes
  }

  // Clamp between 5% and 50%
  return Math.max(0.05, Math.min(0.5, threshold))
}
