import type { AnyNode, KnowledgeGraph, Relationship } from "../domain/types.js"
import { getIncoming, getNode, getOutgoing } from "../graph/engine.js"

export interface ImpactNode {
  node: AnyNode
  distance: number
  directions: Array<"incoming" | "outgoing">
  relationships: Relationship[]
  action: "review" | "recalculate" | "propose_update"
}

export interface NodeImpactResult {
  source: AnyNode
  direct: ImpactNode[]
  indirect: ImpactNode[]
  potential: ImpactNode[]
  affected_relationships: Relationship[]
  acceptance_criteria: AnyNode[]
}

const AUTOMATIC_RELATIONSHIPS = new Set([
  "contains",
  "belongs_to",
  "has_acceptance_criterion",
])

function neighbors(graph: KnowledgeGraph, id: string): Array<{ node: AnyNode; rel: Relationship; direction: "incoming" | "outgoing" }> {
  const result: Array<{ node: AnyNode; rel: Relationship; direction: "incoming" | "outgoing" }> = []
  for (const rel of getOutgoing(graph, id)) {
    const node = getNode(graph, rel.to)
    if (node) result.push({ node, rel, direction: "outgoing" })
  }
  for (const rel of getIncoming(graph, id)) {
    const node = getNode(graph, rel.from)
    if (node) result.push({ node, rel, direction: "incoming" })
  }
  return result
}

export function analyzeNodeImpact(graph: KnowledgeGraph, nodeId: string, maxDepth = 5): NodeImpactResult {
  const source = getNode(graph, nodeId)
  if (!source) throw new Error(`Node ${nodeId} not found`)

  const depth = Math.max(1, Math.min(20, Number.isFinite(maxDepth) ? Math.floor(maxDepth) : 5))
  const distances = new Map<string, number>([[nodeId, 0]])
  const directionMap = new Map<string, Set<"incoming" | "outgoing">>()
  const relationshipMap = new Map<string, Relationship[]>()
  const queue = [nodeId]
  const affectedRelationships: Relationship[] = []

  while (queue.length > 0) {
    const current = queue.shift()!
    const distance = distances.get(current) ?? 0
    if (distance >= depth) continue
    for (const entry of neighbors(graph, current)) {
      affectedRelationships.push(entry.rel)
      if (!directionMap.has(entry.node.id)) directionMap.set(entry.node.id, new Set())
      directionMap.get(entry.node.id)!.add(entry.direction)
      const rels = relationshipMap.get(entry.node.id) || []
      rels.push(entry.rel)
      relationshipMap.set(entry.node.id, rels)
      // Structural parent/child edges are useful as direct context but must
      // not turn a project/domain node into a graph-wide impact hub.
      const structural = entry.rel.type === "contains" || entry.rel.type === "belongs_to"
      if (!distances.has(entry.node.id) && !structural) {
        distances.set(entry.node.id, distance + 1)
        queue.push(entry.node.id)
      }
    }
  }

  const build = (min: number, max: number): ImpactNode[] => [...distances.entries()]
    .filter(([id, distance]) => id !== nodeId && distance >= min && distance <= max)
    .map(([id, distance]) => {
      const node = getNode(graph, id)!
      const rels = relationshipMap.get(id) || []
      const automatic = rels.every((rel) => AUTOMATIC_RELATIONSHIPS.has(rel.type))
      return {
        node,
        distance,
        directions: [...(directionMap.get(id) || [])],
        relationships: rels,
        action: automatic ? "recalculate" : distance <= 2 ? "review" : "propose_update",
      }
    })

  const acceptanceCriteria = new Set<string>()
  if (source.type === "requirement") {
    for (const rel of graph.relationships) {
      if (rel.from === source.id && rel.type === "has_acceptance_criterion") acceptanceCriteria.add(rel.to)
    }
  }
  for (const item of [...build(1, depth)]) {
    if (item.node.type === "requirement") {
      for (const rel of graph.relationships) {
        if (rel.from === item.node.id && rel.type === "has_acceptance_criterion") acceptanceCriteria.add(rel.to)
      }
    }
  }

  const uniqueRelationships = [...new Map(affectedRelationships.map((rel) => [rel.id, rel])).values()]
  return {
    source,
    direct: build(1, 1),
    indirect: build(2, 2),
    potential: build(3, depth),
    affected_relationships: uniqueRelationships,
    acceptance_criteria: [...acceptanceCriteria].map((id) => getNode(graph, id)).filter(Boolean) as AnyNode[],
  }
}

export function formatNodeImpact(result: NodeImpactResult): string {
  const lines = [
    `## Impact: ${result.source.id}`,
    `**Source:** ${result.source.type} — ${result.source.name}`,
    `**Direct:** ${result.direct.length} · **Indirect:** ${result.indirect.length} · **Potential:** ${result.potential.length}`,
    `**Acceptance criteria affected:** ${result.acceptance_criteria.length}`,
    "",
  ]
  for (const group of ["direct", "indirect", "potential"] as const) {
    if (result[group].length === 0) continue
    lines.push(`### ${group}`)
    for (const item of result[group]) {
      lines.push(`- ${item.node.id} (${item.node.type}) — ${item.action} — distance ${item.distance}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}
