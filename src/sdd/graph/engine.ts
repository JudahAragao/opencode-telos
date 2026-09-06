import type {
  KnowledgeGraph,
  AnyNode,
  NodeType,
  Relationship,
  RelationshipType,
  NodeStatus,
} from "../domain/types.js"
import { GraphIndices } from "./index.js"

export function createGraph(projectId: string): KnowledgeGraph {
  const now = new Date().toISOString()
  return {
    version: "1.0.0",
    project_id: projectId,
    nodes: [],
    relationships: [],
    metadata: {
      created_at: now,
      updated_at: now,
      sdd_version: "1.0.0",
    },
  }
}

export function addNode(graph: KnowledgeGraph, node: AnyNode): void {
  const existing = graph.nodes.find((n) => n.id === node.id)
  if (existing) throw new Error(`Node ${node.id} already exists`)
  graph.nodes.push(node)
  graph.metadata.updated_at = new Date().toISOString()
}

export function updateNode(
  graph: KnowledgeGraph,
  nodeId: string,
  updates: Partial<AnyNode>,
): AnyNode {
  const idx = graph.nodes.findIndex((n) => n.id === nodeId)
  if (idx === -1) throw new Error(`Node ${nodeId} not found`)
  const node = graph.nodes[idx]
  const updated = {
    ...node,
    ...updates,
    version: node.version + 1,
    updated_at: new Date().toISOString(),
  }
  graph.nodes[idx] = updated as AnyNode
  graph.metadata.updated_at = new Date().toISOString()
  return updated as AnyNode
}

export function removeNode(graph: KnowledgeGraph, nodeId: string): void {
  const idx = graph.nodes.findIndex((n) => n.id === nodeId)
  if (idx === -1) throw new Error(`Node ${nodeId} not found`)
  graph.nodes.splice(idx, 1)
  graph.relationships = graph.relationships.filter(
    (r) => r.from !== nodeId && r.to !== nodeId,
  )
  graph.metadata.updated_at = new Date().toISOString()
}

/**
 * Get a node by ID. Uses indices when available, falls back to linear scan.
 */
export function getNode(graph: KnowledgeGraph, nodeId: string): AnyNode | undefined {
  return graph.nodes.find((n) => n.id === nodeId)
}

/**
 * Get nodes by type. Uses indices when available, falls back to linear scan.
 */
export function getNodesByType<T extends AnyNode = AnyNode>(
  graph: KnowledgeGraph,
  type: NodeType,
): T[] {
  return graph.nodes.filter((n) => n.type === type) as T[]
}

/**
 * Get nodes by status. Uses indices when available, falls back to linear scan.
 */
export function getNodesByStatus(
  graph: KnowledgeGraph,
  status: NodeStatus,
): AnyNode[] {
  return graph.nodes.filter((n) => n.status === status)
}

export function addRelationship(
  graph: KnowledgeGraph,
  from: string,
  to: string,
  type: RelationshipType,
  metadata: Record<string, unknown> = {},
): Relationship {
  if (!getNode(graph, from)) throw new Error(`Source node ${from} not found`)
  if (!getNode(graph, to)) throw new Error(`Target node ${to} not found`)

  // Prevent self-loops
  if (from === to) throw new Error(`Cannot create self-loop relationship on ${from}`)

  const existing = graph.relationships.find(
    (r) => r.from === from && r.to === to && r.type === type,
  )
  if (existing) return existing

  // Cycle prevention: check if adding this edge would create a cycle
  // Only check for directed dependency-like relationships
  const CYCLE_SENSITIVE_TYPES = new Set([
    "depends_on", "requires", "implements", "implemented_by",
    "satisfied_by", "derived_from", "blocked_by", "supersedes",
    "replaces", "deprecates", "migrates_to", "constrains",
    "influences", "flows_to",
  ])

  if (CYCLE_SENSITIVE_TYPES.has(type) && wouldCreateCycle(graph, from, to)) {
    throw new Error(
      `Adding ${from} →[${type}]→ ${to} would create a cycle in the graph. ` +
      `Use 'contains' or 'uses' for bidirectional relationships, or restructure the dependency.`
    )
  }

  const rel: Relationship = {
    id: `REL-${from}-${to}-${type}`,
    from,
    to,
    type,
    metadata,
  }
  graph.relationships.push(rel)
  graph.metadata.updated_at = new Date().toISOString()
  return rel
}

/**
 * Check if adding an edge from→to would create a cycle.
 * Uses BFS from 'to' to see if 'from' is already reachable.
 */
function wouldCreateCycle(graph: KnowledgeGraph, from: string, to: string): boolean {
  // BFS from 'to' following existing outgoing edges
  const visited = new Set<string>()
  const queue = [to]
  visited.add(to)

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current === from) return true // Cycle would be created

    for (const rel of graph.relationships) {
      if (rel.from === current && !visited.has(rel.to)) {
        visited.add(rel.to)
        queue.push(rel.to)
      }
    }
  }

  return false
}

export function removeRelationship(
  graph: KnowledgeGraph,
  from: string,
  to: string,
  type: RelationshipType,
): void {
  graph.relationships = graph.relationships.filter(
    (r) => !(r.from === from && r.to === to && r.type === type),
  )
  graph.metadata.updated_at = new Date().toISOString()
}

export function getRelationships(
  graph: KnowledgeGraph,
  nodeId: string,
): Relationship[] {
  return graph.relationships.filter(
    (r) => r.from === nodeId || r.to === nodeId,
  )
}

export function getOutgoing(graph: KnowledgeGraph, nodeId: string): Relationship[] {
  return graph.relationships.filter((r) => r.from === nodeId)
}

export function getIncoming(graph: KnowledgeGraph, nodeId: string): Relationship[] {
  return graph.relationships.filter((r) => r.to === nodeId)
}

export function getNeighbors(
  graph: KnowledgeGraph,
  nodeId: string,
  direction: "outgoing" | "incoming" | "both" = "both",
): AnyNode[] {
  const ids = new Set<string>()
  if (direction === "outgoing" || direction === "both") {
    for (const r of graph.relationships) {
      if (r.from === nodeId) ids.add(r.to)
    }
  }
  if (direction === "incoming" || direction === "both") {
    for (const r of graph.relationships) {
      if (r.to === nodeId) ids.add(r.from)
    }
  }
  return [...ids].map((id) => getNode(graph, id)).filter(Boolean) as AnyNode[]
}

export function getGraphStats(graph: KnowledgeGraph) {
  const byType: Record<string, number> = {}
  for (const node of graph.nodes) {
    byType[node.type] = (byType[node.type] || 0) + 1
  }
  const byStatus: Record<string, number> = {}
  for (const node of graph.nodes) {
    byStatus[node.status] = (byStatus[node.status] || 0) + 1
  }
  return {
    total_nodes: graph.nodes.length,
    total_relationships: graph.relationships.length,
    by_type: byType,
    by_status: byStatus,
  }
}

// ── Index-aware versions ─────────────────────────────────────────────
// These use GraphIndices for O(1) lookups instead of O(n) scans.

export function getNodeIndexed(indices: GraphIndices, nodeId: string): AnyNode | undefined {
  return indices.byId.get(nodeId)
}

export function getNodesByTypeIndexed<T extends AnyNode = AnyNode>(
  indices: GraphIndices,
  type: NodeType,
): T[] {
  return indices.getNodesByType(type) as T[]
}

export function getNodesByStatusIndexed(
  indices: GraphIndices,
  status: NodeStatus,
): AnyNode[] {
  return indices.getNodesByStatus(status)
}

export function getOutgoingIndexed(indices: GraphIndices, nodeId: string): Relationship[] {
  return indices.getOutgoing(nodeId)
}

export function getIncomingIndexed(indices: GraphIndices, nodeId: string): Relationship[] {
  return indices.getIncoming(nodeId)
}

export function getRelationshipsIndexed(indices: GraphIndices, nodeId: string): Relationship[] {
  return indices.getRelationships(nodeId)
}

export function searchNodesIndexed(indices: GraphIndices, query: string, type?: NodeType): AnyNode[] {
  return indices.search(query, type)
}

export function getGraphStatsIndexed(indices: GraphIndices) {
  const byType: Record<string, number> = {}
  for (const [type, nodes] of indices.byType) {
    byType[type] = nodes.length
  }
  const byStatus: Record<string, number> = {}
  for (const [status, nodes] of indices.byStatus) {
    byStatus[status] = nodes.length
  }
  return {
    total_nodes: indices.totalNodes,
    total_relationships: indices.totalRelationships,
    by_type: byType,
    by_status: byStatus,
  }
}
