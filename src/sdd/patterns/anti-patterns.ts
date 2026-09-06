import type { KnowledgeGraph } from "../domain/types.js"
import { getNodesByType, getNode } from "../graph/engine.js"
import { getExclusionSets, isNodeExcludedOrDeprecated } from "../drift/exclusion.js"

export interface AntiPattern {
  type: string
  description: string
  node_id?: string
  file?: string
  severity: "error" | "warning" | "info"
  suggestion: string
}

export interface AntiPatternResult {
  patterns: AntiPattern[]
  total: number
  by_severity: { error: number; warning: number; info: number }
}

export function detectAntiPatterns(graph: KnowledgeGraph): AntiPatternResult {
  const patterns: AntiPattern[] = []

  detectGodNodes(graph, patterns)
  detectCircularDependencies(graph, patterns)
  detectSpeculation(graph, patterns)
  detectSkipSteps(graph, patterns)
  detectMissingTests(graph, patterns)
  detectEmptyNodes(graph, patterns)
  detectNearDuplicates(graph, patterns)

  const result: AntiPatternResult = {
    patterns,
    total: patterns.length,
    by_severity: {
      error: patterns.filter((p) => p.severity === "error").length,
      warning: patterns.filter((p) => p.severity === "warning").length,
      info: patterns.filter((p) => p.severity === "info").length,
    },
  }

  return result
}

function detectGodNodes(graph: KnowledgeGraph, patterns: AntiPattern[]): void {
  const nodeRelCounts = new Map<string, number>()
  for (const rel of graph.relationships) {
    nodeRelCounts.set(rel.from, (nodeRelCounts.get(rel.from) || 0) + 1)
    nodeRelCounts.set(rel.to, (nodeRelCounts.get(rel.to) || 0) + 1)
  }

  const threshold = Math.max(10, graph.nodes.length * 0.3)
  for (const [nodeId, count] of nodeRelCounts.entries()) {
    if (count > threshold) {
      const node = getNode(graph, nodeId)
      if (node) {
        patterns.push({
          type: "god_node",
          description: `Node "${node.name}" has ${count} relationships (threshold: ${threshold})`,
          node_id: nodeId,
          severity: "warning",
          suggestion: "Consider splitting this node into smaller, focused components.",
        })
      }
    }
  }
}

function detectCircularDependencies(graph: KnowledgeGraph, patterns: AntiPattern[]): void {
  const adjList = new Map<string, string[]>()
  for (const rel of graph.relationships) {
    if (!adjList.has(rel.from)) adjList.set(rel.from, [])
    adjList.get(rel.from)!.push(rel.to)
  }

  const visited = new Set<string>()
  const inStack = new Set<string>()

  const dfs = (nodeId: string, path: string[]): void => {
    if (inStack.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId)
      const cycle = path.slice(cycleStart).concat(nodeId)
      const cycleNames = cycle.map((id) => {
        const n = getNode(graph, id)
        return n ? n.name : id
      })

      const cycleNode = getNode(graph, nodeId)
      if (cycleNode) {
        patterns.push({
          type: "circular_dependency",
          description: `Circular dependency detected: ${cycleNames.join(" → ")}`,
          node_id: nodeId,
          severity: "error",
          suggestion: "Break the cycle by extracting shared logic into a new node.",
        })
      }
      return
    }

    if (visited.has(nodeId)) return

    visited.add(nodeId)
    inStack.add(nodeId)
    path.push(nodeId)

    for (const neighbor of adjList.get(nodeId) || []) {
      dfs(neighbor, [...path])
    }

    inStack.delete(nodeId)
  }

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id, [])
    }
  }
}

function detectSpeculation(graph: KnowledgeGraph, patterns: AntiPattern[]): void {
  const { removed, deprecated } = getExclusionSets(graph)
  const completedFeatures = getNodesByType(graph, "feature")
    .filter((f) => f.status === "COMPLETED" && !isNodeExcludedOrDeprecated(f.id, f.status, removed, deprecated))
  const totalFeatures = getNodesByType(graph, "feature")
    .filter((f) => !isNodeExcludedOrDeprecated(f.id, f.status, removed, deprecated))

  if (totalFeatures.length < 3) return

  const completionRate = completedFeatures.length / totalFeatures.length
  if (completionRate < 0.3) {
    const reqNodes = getNodesByType(graph, "requirement")
      .filter((r) => !isNodeExcludedOrDeprecated(r.id, r.status, removed, deprecated))
    const apiNodes = getNodesByType(graph, "api")
      .filter((a) => !isNodeExcludedOrDeprecated(a.id, a.status, removed, deprecated))
    const entityNodes = getNodesByType(graph, "entity")
      .filter((e) => !isNodeExcludedOrDeprecated(e.id, e.status, removed, deprecated))

    if (reqNodes.length + apiNodes.length + entityNodes.length > totalFeatures.length * 3) {
      patterns.push({
        type: "speculation",
        description: `High spec count (${reqNodes.length + apiNodes.length + entityNodes.length}) with low completion rate (${(completionRate * 100).toFixed(0)}%)`,
        severity: "warning",
        suggestion: "Focus on completing existing features before adding new specifications.",
      })
    }
  }
}

function detectSkipSteps(graph: KnowledgeGraph, patterns: AntiPattern[]): void {
  const { removed, deprecated } = getExclusionSets(graph)
  const changes = getNodesByType(graph, "change")

  const nodesWithSpecs = new Set<string>()
  for (const node of graph.nodes) {
    const specs = graph.relationships
      .filter((r) => r.from === node.id && r.type === "satisfied_by")
      .map((r) => r.to)
    if (specs.length > 0) nodesWithSpecs.add(node.id)
  }

  for (const node of graph.nodes) {
    if (isNodeExcludedOrDeprecated(node.id, node.status, removed, deprecated)) continue
    if (!nodesWithSpecs.has(node.id) && (node.type === "feature" || node.type === "requirement")) {
      const relatedChanges = changes.filter((c) => {
        return graph.relationships.some(
          (r) => r.from === c.id && r.to === node.id && r.type === "modifies",
        )
      })
      const hasApprovedChange = relatedChanges.some((c) => c.status === "APPROVED")

      if (hasApprovedChange) {
        patterns.push({
          type: "skip_step",
          description: `Node "${node.name}" has approved changes without specification`,
          node_id: node.id,
          severity: "error",
          suggestion: "Add a specification before approving changes.",
        })
      }
    }
  }
}

function detectMissingTests(graph: KnowledgeGraph, patterns: AntiPattern[]): void {
  const { removed, deprecated } = getExclusionSets(graph)
  const requirements = getNodesByType(graph, "requirement")
    .filter((r) => !isNodeExcludedOrDeprecated(r.id, r.status, removed, deprecated))

  for (const req of requirements) {
    const hasTest = graph.relationships.some(
      (r) => r.from === req.id && r.type === "tested_by",
    )
    if (!hasTest) {
      patterns.push({
        type: "missing_test",
        description: `Requirement "${req.name}" has no linked test`,
        node_id: req.id,
        severity: "info",
        suggestion: "Add a test node to verify this requirement.",
      })
    }
  }
}

function detectEmptyNodes(graph: KnowledgeGraph, patterns: AntiPattern[]): void {
  const { removed, deprecated } = getExclusionSets(graph)
  for (const node of graph.nodes) {
    if (isNodeExcludedOrDeprecated(node.id, node.status, removed, deprecated)) continue
    const relCount = graph.relationships.filter(
      (r) => r.from === node.id || r.to === node.id,
    ).length

    if (relCount === 0 && node.type !== "project") {
      patterns.push({
        type: "empty_node",
        description: `Node "${node.name}" has no relationships`,
        node_id: node.id,
        severity: "info",
        suggestion: "Connect this node to related items in the graph.",
      })
    }
  }
}

/**
 * Detect near-duplicate nodes: nodes of the same type with very similar names
 * or descriptions. This catches mutant duplicates like pages↔posts or
 * test files that are nearly identical.
 *
 * For ≥95% similarity, suggests auto-merge.
 */
function detectNearDuplicates(graph: KnowledgeGraph, patterns: AntiPattern[]): void {
  const { removed, deprecated } = getExclusionSets(graph)

  // Group nodes by type
  const byType = new Map<string, typeof graph.nodes>()
  for (const node of graph.nodes) {
    if (isNodeExcludedOrDeprecated(node.id, node.status, removed, deprecated)) continue
    if (node.type === "project" || node.type === "change" || node.type === "symbol") continue
    const list = byType.get(node.type) || []
    list.push(node)
    byType.set(node.type, list)
  }

  for (const [type, nodes] of byType) {
    if (nodes.length < 2) continue

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]

        const similarity = computeSimilarity(a, b)
        if (similarity >= 0.95) {
          patterns.push({
            type: "near_duplicate",
            description: `Nodes "${a.name}" and "${b.name}" are ${Math.round(similarity * 100)}% similar — AUTO-MERGE RECOMMENDED`,
            node_id: a.id,
            severity: "error",
            suggestion: `Auto-merge: keep "${a.name}" (id: ${a.id}), remove "${b.name}" (id: ${b.id}). Use sdd.remove_node on the duplicate after moving its relationships.`,
          })
        } else if (similarity >= 0.85) {
          patterns.push({
            type: "near_duplicate",
            description: `Nodes "${a.name}" and "${b.name}" are ${Math.round(similarity * 100)}% similar (potential mutant duplicate)`,
            node_id: a.id,
            severity: "warning",
            suggestion: `Consider extracting shared logic into a common ${type} or removing one of the duplicates.`,
          })
        }
      }
    }
  }
}

/**
 * Compute similarity between two nodes based on name and description.
 * Uses token-based Jaccard similarity.
 */
function computeSimilarity(a: { name: string; description?: string }, b: { name: string; description?: string }): number {
  const tokensA = tokenizeForSimilarity(`${a.name} ${a.description || ""}`)
  const tokensB = tokenizeForSimilarity(`${b.name} ${b.description || ""}`)

  if (tokensA.size === 0 || tokensB.size === 0) return 0

  let intersection = 0
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++
  }

  const union = tokensA.size + tokensB.size - intersection
  return union === 0 ? 0 : intersection / union
}

function tokenizeForSimilarity(text: string): Set<string> {
  const tokens = new Set<string>()
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2)
  for (const word of words) tokens.add(word)
  return tokens
}

export function formatAntiPatterns(result: AntiPatternResult): string {
  const lines = [
    `## Anti-Patterns (${result.total} total)`,
    `Errors: ${result.by_severity.error} | Warnings: ${result.by_severity.warning} | Info: ${result.by_severity.info}`,
    "",
  ]

  const grouped = new Map<string, AntiPattern[]>()
  for (const p of result.patterns) {
    if (!grouped.has(p.type)) grouped.set(p.type, [])
    grouped.get(p.type)!.push(p)
  }

  for (const [type, items] of grouped) {
    lines.push(`### ${type} (${items.length})`)
    for (const item of items.slice(0, 5)) {
      const severity = item.severity === "error" ? "🔴" : item.severity === "warning" ? "🟡" : "🔵"
      const nodeRef = item.node_id ? ` [${item.node_id}]` : ""
      lines.push(`- ${severity}${nodeRef} ${item.description}`)
      lines.push(`  💡 ${item.suggestion}`)
    }
    if (items.length > 5) lines.push(`  ... and ${items.length - 5} more`)
    lines.push("")
  }

  return lines.join("\n")
}
