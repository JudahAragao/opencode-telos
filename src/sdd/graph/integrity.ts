import type {
  KnowledgeGraph,
  AnyNode,
  RelationshipType,
} from "../domain/types.js"
import {
  getNode,
  addRelationship,
} from "./engine.js"

// ─── Types ─────────────────────────────────────────────────────────

export interface IntegrityReport {
  orphan_nodes: OrphanInfo[]
  disconnected_groups: DisconnectedGroup[]
  redundant_relationships: RedundantRelationship[]
  fixes_applied: IntegrityFix[]
  summary: IntegritySummary
}

/**
 * Options for controlling graph integrity check scope.
 */
export interface IntegrityCheckOptions {
  /** Auto-fix detected issues. */
  auto_fix?: boolean
  /** Only check these specific node IDs and their neighbors. */
  focusNodeIds?: string[]
  /** Skip these check types. */
  skipChecks?: Array<"orphans" | "disconnected" | "redundant">
  /** Only check nodes that changed since a specific timestamp. */
  changedSince?: string
  /** Maximum disconnected groups to report. */
  maxGroups?: number
  /** Maximum orphans to report. */
  maxOrphans?: number
  /** Cache for disconnected group detection (graph_hash → result). */
  connectivityCache?: Map<string, { connected: boolean; groups: DisconnectedGroup[]; timestamp: number }>
}

export interface OrphanInfo {
  node_id: string
  node_name: string
  node_type: string
}

export interface DisconnectedGroup {
  group_id: number
  node_ids: string[]
  node_names: string[]
  size: number
  suggested_connection: {
    target_id: string
    target_name: string
    relationship_type: RelationshipType
  } | null
}

export interface RedundantRelationship {
  relationship_id: string
  from: string
  to: string
  type: string
  reason: "duplicate" | "self_loop" | "reversed_exists"
}

export interface IntegrityFix {
  action: "connected_orphan" | "merged_group" | "removed_duplicate" | "removed_self_loop" | "removed_reversed"
  details: string
  relationship?: { from: string; to: string; type: string }
}

export interface IntegritySummary {
  total_nodes: number
  total_relationships: number
  orphans_found: number
  disconnected_groups_found: number
  redundant_relationships_found: number
  fixes_applied: number
  graph_connected: boolean
}

// ─── Main Entry Point ──────────────────────────────────────────────

/**
 * Runs a full integrity check on the graph and optionally fixes issues.
 * This should be called after any graph mutation (add/remove node or relationship).
 */
export function ensureGraphIntegrity(
  graph: KnowledgeGraph,
  options: IntegrityCheckOptions = {},
): IntegrityReport {
  const autoFix = options.auto_fix ?? true

  const report: IntegrityReport = {
    orphan_nodes: [],
    disconnected_groups: [],
    redundant_relationships: [],
    fixes_applied: [],
    summary: {
      total_nodes: graph.nodes.length,
      total_relationships: graph.relationships.length,
      orphans_found: 0,
      disconnected_groups_found: 0,
      redundant_relationships_found: 0,
      fixes_applied: 0,
      graph_connected: false,
    },
  }

  // Build focus node set for targeted checks
  const focusSet = options.focusNodeIds ? new Set(options.focusNodeIds) : null
  const skipChecks = new Set(options.skipChecks || [])

  // Filter graph to focus nodes if specified
  const graphToCheck = focusSet ? filterGraphToFocus(graph, focusSet) : graph

  // Step 1: Detect and fix redundant relationships first (before connectivity)
  if (!skipChecks.has("redundant")) {
    report.redundant_relationships = detectRedundantRelationships(graphToCheck)
    report.summary.redundant_relationships_found = report.redundant_relationships.length

    if (autoFix) {
      for (const redundant of report.redundant_relationships) {
        removeRedundantRelationship(graph, redundant)
        report.fixes_applied.push({
          action: redundant.reason === "self_loop" ? "removed_self_loop" : redundant.reason === "duplicate" ? "removed_duplicate" : "removed_reversed",
          details: `Removed ${redundant.reason}: ${redundant.from} → ${redundant.to} (${redundant.type})`,
          relationship: { from: redundant.from, to: redundant.to, type: redundant.type },
        })
      }
    }
  }

  // Step 2: Detect orphan nodes (no relationships at all)
  if (!skipChecks.has("orphans")) {
    report.orphan_nodes = detectOrphanNodes(graphToCheck)
    if (options.maxOrphans && report.orphan_nodes.length > options.maxOrphans) {
      report.orphan_nodes = report.orphan_nodes.slice(0, options.maxOrphans)
    }
    report.summary.orphans_found = report.orphan_nodes.length

    if (autoFix) {
      for (const orphan of report.orphan_nodes) {
        const fix = connectOrphanNode(graph, orphan)
        if (fix) report.fixes_applied.push(fix)
      }
    }
  }

  // Step 3: Detect disconnected subgraphs
  if (!skipChecks.has("disconnected")) {
    // Check connectivity cache
    const graphHash = `${graphToCheck.nodes.length}:${graphToCheck.relationships.length}`
    const cachedConnectivity = options?.connectivityCache?.get(graphHash)
    const cacheMaxAge = 30000 // 30 seconds

    if (cachedConnectivity && (Date.now() - cachedConnectivity.timestamp) < cacheMaxAge) {
      report.disconnected_groups = options.maxGroups ? cachedConnectivity.groups.slice(0, options.maxGroups) : cachedConnectivity.groups
      report.summary.disconnected_groups_found = cachedConnectivity.groups.length
      report.summary.graph_connected = cachedConnectivity.connected
    } else {
      const { disconnectedGroups } = detectDisconnectedGroups(graphToCheck)
      if (options.maxGroups && disconnectedGroups.length > options.maxGroups) {
        report.disconnected_groups = disconnectedGroups.slice(0, options.maxGroups)
      } else {
        report.disconnected_groups = disconnectedGroups
      }
      report.summary.disconnected_groups_found = disconnectedGroups.length
      report.summary.graph_connected = disconnectedGroups.length === 0

      // Store in cache
      if (options?.connectivityCache) {
        options.connectivityCache.set(graphHash, {
          connected: disconnectedGroups.length === 0,
          groups: disconnectedGroups,
          timestamp: Date.now(),
        })
      }
    }

    if (autoFix) {
      for (const group of report.disconnected_groups) {
        const fix = connectDisconnectedGroup(graph, group, { nodeIds: new Set(graph.nodes.map(n => n.id)), representative: graph.project_id })
        if (fix) report.fixes_applied.push(fix)
      }
    }
  }

  report.summary.fixes_applied = report.fixes_applied.length
  return report
}

/**
 * Filter a graph to only include focus nodes and their immediate neighbors.
 */
function filterGraphToFocus(graph: KnowledgeGraph, focusIds: Set<string>): KnowledgeGraph {
  const neighborIds = new Set<string>()
  for (const rel of graph.relationships) {
    if (focusIds.has(rel.from)) neighborIds.add(rel.to)
    if (focusIds.has(rel.to)) neighborIds.add(rel.from)
  }
  const includeIds = new Set([...focusIds, ...neighborIds])

  return {
    ...graph,
    nodes: graph.nodes.filter(n => includeIds.has(n.id)),
    relationships: graph.relationships.filter(r => includeIds.has(r.from) && includeIds.has(r.to)),
  }
}

// ─── Redundant Relationship Detection ──────────────────────────────

function detectRedundantRelationships(graph: KnowledgeGraph): RedundantRelationship[] {
  const redundants: RedundantRelationship[] = []
  const seen = new Set<string>()

  for (const rel of graph.relationships) {
    // Self-loops are always redundant
    if (rel.from === rel.to) {
      redundants.push({
        relationship_id: rel.id,
        from: rel.from,
        to: rel.to,
        type: rel.type,
        reason: "self_loop",
      })
      continue
    }

    // Exact duplicates (same from, to, type)
    const key = `${rel.from}||${rel.to}||${rel.type}`
    if (seen.has(key)) {
      redundants.push({
        relationship_id: rel.id,
        from: rel.from,
        to: rel.to,
        type: rel.type,
        reason: "duplicate",
      })
      continue
    }
    seen.add(key)

    // Reversed relationship exists (A→B and B→A with same type)
    const reverseKey = `${rel.to}||${rel.from}||${rel.type}`
    if (seen.has(reverseKey)) {
      // Only flag if the relationship is not bidirectional by design
      if (!isBidirectionalType(rel.type)) {
        redundants.push({
          relationship_id: rel.id,
          from: rel.from,
          to: rel.to,
          type: rel.type,
          reason: "reversed_exists",
        })
      }
    }
  }

  return redundants
}

function isBidirectionalType(type: string): boolean {
  // Some relationship types are naturally bidirectional
  const bidirectional = new Set([
    "contradicts",
    "supersedes",
    "blocked_by",
  ])
  return bidirectional.has(type)
}

function removeRedundantRelationship(
  graph: KnowledgeGraph,
  redundant: RedundantRelationship,
): void {
  // Find and remove the actual relationship object
  const idx = graph.relationships.findIndex(
    (r) => r.from === redundant.from && r.to === redundant.to && r.type === redundant.type,
  )
  if (idx !== -1) {
    graph.relationships.splice(idx, 1)
    graph.metadata.updated_at = new Date().toISOString()
  }
}

// ─── Orphan Node Detection ─────────────────────────────────────────

function detectOrphanNodes(graph: KnowledgeGraph): OrphanInfo[] {
  const orphans: OrphanInfo[] = []
  const relatedIds = new Set<string>()

  for (const rel of graph.relationships) {
    relatedIds.add(rel.from)
    relatedIds.add(rel.to)
  }

  for (const node of graph.nodes) {
    if (relatedIds.has(node.id)) continue
    orphans.push({
      node_id: node.id,
      node_name: node.name,
      node_type: node.type,
    })
  }

  return orphans
}

function connectOrphanNode(
  graph: KnowledgeGraph,
  orphan: OrphanInfo,
): IntegrityFix | null {
  const projectId = graph.project_id
  const projectNode = getNode(graph, projectId)

  if (!projectNode) return null

  // Strategy: connect to project root with "contains" relationship
  try {
    addRelationship(graph, projectId, orphan.node_id, "contains")
    return {
      action: "connected_orphan",
      details: `Connected orphan "${orphan.node_name}" (${orphan.node_type}) to project root`,
      relationship: { from: projectId, to: orphan.node_id, type: "contains" },
    }
  } catch {
    // Relationship might already exist
    return null
  }
}

// ─── Disconnected Group Detection ──────────────────────────────────

interface SubgraphInfo {
  nodeIds: Set<string>
  representative: string // A node ID from this group
}

function detectDisconnectedGroups(
  graph: KnowledgeGraph,
): { mainGroup: SubgraphInfo; disconnectedGroups: DisconnectedGroup[] } {
  const projectId = graph.project_id
  const visited = new Set<string>()
  const allGroups: SubgraphInfo[] = []

  // Build adjacency list for BFS
  const adj = new Map<string, Set<string>>()
  for (const node of graph.nodes) {
    adj.set(node.id, new Set())
  }
  for (const rel of graph.relationships) {
    adj.get(rel.from)?.add(rel.to)
    adj.get(rel.to)?.add(rel.from)
  }

  // Find all connected components via BFS
  for (const node of graph.nodes) {
    if (visited.has(node.id)) continue

    const group = new Set<string>()
    const queue = [node.id]
    visited.add(node.id)

    while (queue.length > 0) {
      const current = queue.shift()!
      group.add(current)

      for (const neighbor of adj.get(current) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push(neighbor)
        }
      }
    }

    allGroups.push({ nodeIds: group, representative: node.id })
  }

  // The main group is the one containing the project root
  const mainGroup = allGroups.find((g) => g.nodeIds.has(projectId)) || allGroups[0]

  // All other groups are disconnected
  const disconnectedGroups: DisconnectedGroup[] = []
  let groupId = 0

  for (const group of allGroups) {
    if (group === mainGroup) continue
    if (group.nodeIds.size === 0) continue

    groupId++
    const nodeIds = [...group.nodeIds]
    const nodeNames = nodeIds
      .map((id) => getNode(graph, id))
      .filter(Boolean)
      .map((n) => n!.name)

    // Find the best connection target for this group
    const suggestedConnection = findBestConnectionTarget(graph, group, mainGroup)

    disconnectedGroups.push({
      group_id: groupId,
      node_ids: nodeIds,
      node_names: nodeNames,
      size: group.nodeIds.size,
      suggested_connection: suggestedConnection,
    })
  }

  return { mainGroup, disconnectedGroups }
}

function findBestConnectionTarget(
  graph: KnowledgeGraph,
  group: SubgraphInfo,
  mainGroup: SubgraphInfo,
): DisconnectedGroup["suggested_connection"] {
  // Strategy 1: Find nodes in the group that share a type with nodes in the main group
  // and suggest connecting them
  const groupNodes = [...group.nodeIds]
    .map((id) => getNode(graph, id))
    .filter(Boolean) as AnyNode[]

  const mainNodes = [...mainGroup.nodeIds]
    .map((id) => getNode(graph, id))
    .filter(Boolean) as AnyNode[]

  // Try to find a semantic connection
  for (const groupNode of groupNodes) {
    for (const mainNode of mainNodes) {
      const relType = suggestRelationshipType(groupNode, mainNode)
      if (relType) {
        return {
          target_id: mainNode.id,
          target_name: mainNode.name,
          relationship_type: relType,
        }
      }
    }
  }

  // Fallback: connect to project root
  const projectId = graph.project_id
  return {
    target_id: projectId,
    target_name: "Project Root",
    relationship_type: "contains",
  }
}

function suggestRelationshipType(
  source: AnyNode,
  target: AnyNode,
): RelationshipType | null {
  const s = source.type
  const t = target.type

  // Semantic connection rules based on node types
  const rules: Array<[string, string, RelationshipType]> = [
    // Features use entities and architecture
    ["feature", "entity", "uses"],
    ["feature", "architecture_component", "uses"],
    ["feature", "requirement", "satisfied_by"],
    // Requirements
    ["requirement", "feature", "implemented_by"],
    ["requirement", "task", "implemented_by"],
    // Endpoints expose entities
    ["endpoint", "entity", "exposes"],
    ["api", "endpoint", "contains"],
    // Entities persist to database
    ["entity", "database", "persists_to"],
    ["entity", "table", "persists_to"],
    // Architecture depends on
    ["architecture_component", "architecture_component", "depends_on"],
    // Business rules
    ["business_rule", "feature", "constrains"],
    ["business_rule", "requirement", "constrains"],
    // Decisions influence
    ["decision", "feature", "influences"],
    ["decision", "architecture_component", "influences"],
    // Tasks implement
    ["task", "requirement", "implements"],
    ["task", "feature", "implements"],
    // Files contain symbols
    ["file", "symbol", "contains"],
    // Changes affect
    ["change", "feature", "affects"],
    ["change", "entity", "affects"],
    // Tests test
    ["test", "requirement", "tests"],
    ["test", "feature", "tests"],
  ]

  // Check both directions
  for (const [fromType, toType, relType] of rules) {
    if (s === fromType && t === toType) return relType
    if (s === toType && t === fromType) {
      // Reverse the relationship direction
      return relType
    }
  }

  // Default: use "contains" from parent to child based on hierarchy
  const hierarchy = getHierarchyLevel(s)
  const targetHierarchy = getHierarchyLevel(t)
  if (hierarchy < targetHierarchy) return "contains"
  if (hierarchy > targetHierarchy) return "belongs_to"

  return null
}

function getHierarchyLevel(type: string): number {
  // Higher number = more specific/leaf node
  const levels: Record<string, number> = {
    project: 0,
    domain: 1,
    architecture_component: 2,
    database: 2,
    feature: 3,
    requirement: 3,
    entity: 3,
    api: 3,
    business_rule: 3,
    decision: 3,
    endpoint: 4,
    table: 4,
    field: 5,
    task: 4,
    test: 4,
    file: 4,
    symbol: 5,
    change: 2,
    constitution: 1,
  }
  return levels[type] ?? 3
}

function connectDisconnectedGroup(
  graph: KnowledgeGraph,
  group: DisconnectedGroup,
  _mainGroup: SubgraphInfo,
): IntegrityFix | null {
  if (!group.suggested_connection) return null

  // Connect the first node of the disconnected group to the suggested target
  const sourceNodeId = group.node_ids[0]
  const targetId = group.suggested_connection.target_id
  const relType = group.suggested_connection.relationship_type

  // Verify both nodes exist
  if (!getNode(graph, sourceNodeId) || !getNode(graph, targetId)) return null

  try {
    addRelationship(graph, sourceNodeId, targetId, relType)
    return {
      action: "merged_group",
      details: `Merged disconnected group (${group.size} nodes: ${group.node_names.slice(0, 3).join(", ")}${group.size > 3 ? "..." : ""}) → "${group.suggested_connection.target_name}" via ${relType}`,
      relationship: { from: sourceNodeId, to: targetId, type: relType },
    }
  } catch {
    return null
  }
}

// ─── Formatting ────────────────────────────────────────────────────

export function formatIntegrityReport(report: IntegrityReport): string {
  const lines: string[] = []

  const emoji = report.summary.graph_connected ? "✅" : "⚠️"
  lines.push(`${emoji} Graph Integrity Report\n`)

  lines.push(`**Nodes:** ${report.summary.total_nodes}`)
  lines.push(`**Relationships:** ${report.summary.total_relationships}`)
  lines.push(`**Connected:** ${report.summary.graph_connected ? "Yes" : "No"}`)
  lines.push("")

  if (report.summary.fixes_applied > 0) {
    lines.push(`### 🔧 Fixes Applied (${report.summary.fixes_applied})`)
    for (const fix of report.fixes_applied) {
      lines.push(`- **${fix.action}:** ${fix.details}`)
    }
    lines.push("")
  }

  if (report.orphan_nodes.length > 0 && report.summary.fixes_applied === 0) {
    lines.push(`### 🔴 Orphan Nodes (${report.orphan_nodes.length})`)
    for (const orphan of report.orphan_nodes.slice(0, 10)) {
      lines.push(`- **${orphan.node_name}** (${orphan.node_type}) [${orphan.node_id}]`)
    }
    if (report.orphan_nodes.length > 10) {
      lines.push(`- ... and ${report.orphan_nodes.length - 10} more`)
    }
    lines.push("")
  }

  if (report.disconnected_groups.length > 0 && report.summary.fixes_applied === 0) {
    lines.push(`### 🏝️ Disconnected Groups (${report.disconnected_groups.length})`)
    for (const group of report.disconnected_groups) {
      const names = group.node_names.slice(0, 5).join(", ")
      const extra = group.node_names.length > 5 ? ` ... (+${group.node_names.length - 5})` : ""
      lines.push(`- **Group ${group.group_id}** (${group.size} nodes): ${names}${extra}`)
      if (group.suggested_connection) {
        lines.push(`  → Suggested: connect to "${group.suggested_connection.target_name}" via ${group.suggested_connection.relationship_type}`)
      }
    }
    lines.push("")
  }

  if (report.redundant_relationships.length > 0 && report.summary.fixes_applied === 0) {
    lines.push(`### 🔄 Redundant Relationships (${report.redundant_relationships.length})`)
    for (const r of report.redundant_relationships.slice(0, 10)) {
      lines.push(`- ${r.from} → ${r.to} (${r.type}): ${r.reason}`)
    }
    lines.push("")
  }

  if (report.summary.fixes_applied === 0 && report.summary.graph_connected) {
    lines.push("✅ Graph is fully connected. No issues found.")
  }

  return lines.join("\n")
}
