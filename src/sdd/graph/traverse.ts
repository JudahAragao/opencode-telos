import type { KnowledgeGraph, AnyNode, Relationship } from "../domain/types.js"
import { getNode, getOutgoing, getIncoming } from "./engine.js"

export interface TraverseOptions {
  max_depth?: number
  edge_types?: string[]
  include_start?: boolean
}

export function bfsOutgoing(
  graph: KnowledgeGraph,
  startId: string,
  options: TraverseOptions = {},
): { nodes: AnyNode[]; edges: Relationship[]; distances: Map<string, number> } {
  const maxDepth = options.max_depth ?? 10
  const edgeTypes = options.edge_types ? new Set(options.edge_types) : null

  const visited = new Set<string>()
  const distances = new Map<string, number>()
  const resultNodes: AnyNode[] = []
  const resultEdges: Relationship[] = []

  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }]
  visited.add(startId)
  distances.set(startId, 0)

  if (options.include_start) {
    const startNode = getNode(graph, startId)
    if (startNode) resultNodes.push(startNode)
  }

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.depth >= maxDepth) continue

    const outgoing = getOutgoing(graph, current.id)
    for (const edge of outgoing) {
      if (edgeTypes && !edgeTypes.has(edge.type)) continue
      if (visited.has(edge.to)) continue

      visited.add(edge.to)
      distances.set(edge.to, current.depth + 1)
      resultEdges.push(edge)

      const targetNode = getNode(graph, edge.to)
      if (targetNode) resultNodes.push(targetNode)

      queue.push({ id: edge.to, depth: current.depth + 1 })
    }
  }

  return { nodes: resultNodes, edges: resultEdges, distances }
}

export function bfsIncoming(
  graph: KnowledgeGraph,
  startId: string,
  options: TraverseOptions = {},
): { nodes: AnyNode[]; edges: Relationship[]; distances: Map<string, number> } {
  const maxDepth = options.max_depth ?? 10
  const edgeTypes = options.edge_types ? new Set(options.edge_types) : null

  const visited = new Set<string>()
  const distances = new Map<string, number>()
  const resultNodes: AnyNode[] = []
  const resultEdges: Relationship[] = []

  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }]
  visited.add(startId)
  distances.set(startId, 0)

  if (options.include_start) {
    const startNode = getNode(graph, startId)
    if (startNode) resultNodes.push(startNode)
  }

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.depth >= maxDepth) continue

    const incoming = getIncoming(graph, current.id)
    for (const edge of incoming) {
      if (edgeTypes && !edgeTypes.has(edge.type)) continue
      if (visited.has(edge.from)) continue

      visited.add(edge.from)
      distances.set(edge.from, current.depth + 1)
      resultEdges.push(edge)

      const sourceNode = getNode(graph, edge.from)
      if (sourceNode) resultNodes.push(sourceNode)

      queue.push({ id: edge.from, depth: current.depth + 1 })
    }
  }

  return { nodes: resultNodes, edges: resultEdges, distances }
}

export function bfsBoth(
  graph: KnowledgeGraph,
  startId: string,
  options: TraverseOptions = {},
): { nodes: AnyNode[]; edges: Relationship[]; distances: Map<string, number> } {
  const maxDepth = options.max_depth ?? 10
  const edgeTypes = options.edge_types ? new Set(options.edge_types) : null

  const visited = new Set<string>()
  const distances = new Map<string, number>()
  const resultNodes: AnyNode[] = []
  const resultEdges: Relationship[] = []

  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }]
  visited.add(startId)
  distances.set(startId, 0)

  if (options.include_start) {
    const startNode = getNode(graph, startId)
    if (startNode) resultNodes.push(startNode)
  }

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.depth >= maxDepth) continue

    const outgoing = getOutgoing(graph, current.id)
    const incoming = getIncoming(graph, current.id)
    const allEdges = [...outgoing, ...incoming]

    for (const edge of allEdges) {
      if (edgeTypes && !edgeTypes.has(edge.type)) continue
      const neighborId = edge.from === current.id ? edge.to : edge.from
      if (visited.has(neighborId)) continue

      visited.add(neighborId)
      distances.set(neighborId, current.depth + 1)
      resultEdges.push(edge)

      const neighborNode = getNode(graph, neighborId)
      if (neighborNode) resultNodes.push(neighborNode)

      queue.push({ id: neighborId, depth: current.depth + 1 })
    }
  }

  return { nodes: resultNodes, edges: resultEdges, distances }
}

export function findPath(
  graph: KnowledgeGraph,
  fromId: string,
  toId: string,
  maxDepth: number = 10,
): AnyNode[] | null {
  const visited = new Set<string>()
  const queue: Array<{ id: string; path: string[] }> = [{ id: fromId, path: [fromId] }]
  visited.add(fromId)

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.id === toId) {
      return current.path
        .map((id) => getNode(graph, id))
        .filter(Boolean) as AnyNode[]
    }
    if (current.path.length > maxDepth) continue

    const outgoing = getOutgoing(graph, current.id)
    for (const edge of outgoing) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to)
        queue.push({ id: edge.to, path: [...current.path, edge.to] })
      }
    }
  }

  return null
}

export function computeImpact(
  graph: KnowledgeGraph,
  nodeId: string,
  maxDepth: number = 5,
): { direct: AnyNode[]; indirect: AnyNode[]; potential: AnyNode[] } {
  const depth1 = bfsOutgoing(graph, nodeId, { max_depth: 1, include_start: false })
  const depthN = bfsOutgoing(graph, nodeId, { max_depth: maxDepth, include_start: false })

  const directIds = new Set(depth1.nodes.map((n) => n.id))
  const indirectIds = new Set<string>()
  const potentialIds = new Set<string>()

  for (const node of depthN.nodes) {
    if (directIds.has(node.id)) continue
    const dist = depthN.distances.get(node.id) ?? 0
    if (dist <= 2) indirectIds.add(node.id)
    else potentialIds.add(node.id)
  }

  return {
    direct: depth1.nodes,
    indirect: [...indirectIds].map((id) => getNode(graph, id)).filter(Boolean) as AnyNode[],
    potential: [...potentialIds].map((id) => getNode(graph, id)).filter(Boolean) as AnyNode[],
  }
}

export interface ImpactAction {
  node_id: string
  node_type: string
  node_name: string
  action: "modify" | "create" | "update_relationship" | "add_test" | "update_spec"
  description: string
  target_files: string[]
  priority: "high" | "medium" | "low"
}

/**
 * Compute impact with concrete actions: what files to modify,
 * what relationships to update, what tests to add.
 */
export function computeImpactActions(
  graph: KnowledgeGraph,
  nodeId: string,
  maxDepth: number = 3,
): ImpactAction[] {
  const impact = computeImpact(graph, nodeId, maxDepth)
  const actions: ImpactAction[] = []
  const sourceNode = getNode(graph, nodeId)
  if (!sourceNode) return actions

  // Direct impact → modify actions
  for (const node of impact.direct) {
    const files = findNodeFiles(graph, node.id)
    const actionType: ImpactAction["action"] = node.type === "file" ? "modify" :
      node.type === "test" ? "add_test" : "update_spec"

    actions.push({
      node_id: node.id,
      node_type: node.type,
      node_name: node.name,
      action: actionType,
      description: generateActionDescription(sourceNode, node),
      target_files: files,
      priority: "high",
    })
  }

  // Indirect impact → medium priority
  for (const node of impact.indirect) {
    const files = findNodeFiles(graph, node.id)
    actions.push({
      node_id: node.id,
      node_type: node.type,
      node_name: node.name,
      action: "update_spec",
      description: `Verify ${node.type} "${node.name}" still aligns after changes to "${sourceNode.name}"`,
      target_files: files,
      priority: "medium",
    })
  }

  // Potential impact → low priority, verification needed
  for (const node of impact.potential.slice(0, 10)) {
    const files = findNodeFiles(graph, node.id)
    actions.push({
      node_id: node.id,
      node_type: node.type,
      node_name: node.name,
      action: "update_spec",
      description: `Check if ${node.type} "${node.name}" needs updates`,
      target_files: files,
      priority: "low",
    })
  }

  return actions
}

function findNodeFiles(graph: KnowledgeGraph, nodeId: string): string[] {
  const files: string[] = []
  // Check if the node itself is a file
  const node = getNode(graph, nodeId)
  if (node?.type === "file") {
    const path = (node.metadata as any).path
    if (path) files.push(path)
    return files
  }

  // Find file nodes connected to this node
  for (const rel of graph.relationships) {
    if (rel.from === nodeId || rel.to === nodeId) {
      const otherId = rel.from === nodeId ? rel.to : rel.from
      const other = getNode(graph, otherId)
      if (other?.type === "file") {
        const path = (other.metadata as any).path
        if (path) files.push(path)
      }
      if (other?.type === "symbol") {
        const path = (other.metadata as any).file_path
        if (path) files.push(path)
      }
    }
  }
  return [...new Set(files)]
}

function generateActionDescription(source: AnyNode, target: AnyNode): string {
  const relType = target.type
  if (relType === "entity") return `Update entity "${target.name}" to reflect changes in "${source.name}"`
  if (relType === "endpoint") return `Update endpoint "${target.name}" API contract`
  if (relType === "requirement") return `Verify requirement "${target.name}" is still satisfied`
  if (relType === "test") return `Update test "${target.name}" for new behavior`
  if (relType === "business_rule") return `Check if business rule "${target.name}" still applies`
  if (relType === "file") return `Modify file "${target.name}"`
  return `Update ${relType} "${target.name}"`
}

export function getSubgraph(
  graph: KnowledgeGraph,
  nodeIds: string[],
): KnowledgeGraph {
  const idSet = new Set(nodeIds)
  return {
    version: graph.version,
    project_id: graph.project_id,
    nodes: graph.nodes.filter((n) => idSet.has(n.id)),
    relationships: graph.relationships.filter(
      (r) => idSet.has(r.from) && idSet.has(r.to),
    ),
    metadata: { ...graph.metadata },
  }
}
