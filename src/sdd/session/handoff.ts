import type { KnowledgeGraph, ChangeNode, DecisionNode, AnyNode, SpecPromise } from "../domain/types.js"
import { getNodesByType } from "../graph/engine.js"
import { getPendingChanges } from "../changes/manager.js"
import { getPromiseReport } from "../promises/tracker.js"
import { calculateQualityScore } from "../quality/scorer.js"
import { readFileSync, existsSync, mkdirSync } from "fs"
import { atomicWriteFile } from "../cache/atomic.js"
import { join, dirname } from "path"

export interface SessionHandoff {
  project_id: string
  last_session: string
  active_changes: ChangeNode[]
  pending_promises: SpecPromise[]
  quality_score: number
  recent_decisions: DecisionNode[]
  blocked_items: AnyNode[]
  summary: string
}

const SESSION_FILE = ".sdd/sessions/latest.json"

export interface HandoffOptions {
  /** Skip quality score calculation (faster handoff). */
  skipQualityCheck?: boolean
  /** Cached quality score to reuse. */
  qualityCache?: { score: number; timestamp: number }
  /** Max age in ms for quality cache (default: 60000). */
  qualityCacheMaxAge?: number
  /** Skip cycle detection in graph health (DFS O(V+E)). */
  skipCycleDetection?: boolean
  /** Only analyze these node types in health check. */
  focusNodeTypes?: string[]
}

export function generateHandoff(
  graph: KnowledgeGraph,
  projectDir: string,
  options?: HandoffOptions,
): SessionHandoff {
  // Auto-archive stale changes (>14 days without activity)
  autoArchiveStaleChanges(graph)

  const activeChanges = getPendingChanges(graph)

  const promiseReport = getPromiseReport(graph)
  const pendingPromises = promiseReport.promises.filter((p) => p.status === "pending")

  let qualityScore = 0
  if (!options?.skipQualityCheck) {
    try {
      const cacheMaxAge = options?.qualityCacheMaxAge ?? 60000
      const cached = options?.qualityCache
      if (cached && Date.now() - cached.timestamp < cacheMaxAge) {
        qualityScore = cached.score
      } else {
        const quality = calculateQualityScore(graph, projectDir)
        qualityScore = quality.score
        if (options?.qualityCache) {
          options.qualityCache.score = qualityScore
          options.qualityCache.timestamp = Date.now()
        }
      }
    } catch {
      qualityScore = 0
    }
  }

  const recentDecisions = getNodesByType<DecisionNode>(graph, "decision")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5)

  const blockedItems = graph.nodes.filter((n) => n.status === "BLOCKED")

  const summary = buildSummary(graph, activeChanges, pendingPromises, qualityScore, blockedItems)

  // Compute graph health for proactive monitoring
  const health = computeGraphHealth(graph, { skipCycleDetection: options?.skipCycleDetection, focusNodeTypes: options?.focusNodeTypes })

  const handoff: SessionHandoff = {
    project_id: graph.project_id,
    last_session: new Date().toISOString(),
    active_changes: activeChanges,
    pending_promises: pendingPromises.slice(0, 10),
    quality_score: qualityScore,
    recent_decisions: recentDecisions,
    blocked_items: blockedItems,
    summary,
  }

  // Attach health data (not part of the interface but used in formatting)
  ;(handoff as any).health = health

  return handoff
}

/**
 * Auto-archive changes that have been PROPOSED/APPROVED/DRAFT for >14 days.
 * Marks them as DEPRECATED to keep the graph clean.
 */
function autoArchiveStaleChanges(graph: KnowledgeGraph): void {
  const now = Date.now()
  const STALE_THRESHOLD = 14 * 24 * 60 * 60 * 1000 // 14 days
  let archivedCount = 0

  for (const node of graph.nodes) {
    if (node.type !== "change") continue
    const change = node as ChangeNode
    if (!["PROPOSED", "APPROVED", "DRAFT"].includes(change.status)) continue

    const age = now - new Date(change.created_at).getTime()
    if (age > STALE_THRESHOLD) {
      change.status = "DEPRECATED"
      change.updated_at = new Date().toISOString()
      change.metadata = {
        ...change.metadata,
        auto_archived: true,
        archived_reason: `Auto-archived: pending for ${Math.floor(age / (24 * 60 * 60 * 1000))} days`,
      }
      archivedCount++
    }
  }

  if (archivedCount > 0) {
    graph.metadata.updated_at = new Date().toISOString()
  }
}

function buildSummary(
  graph: KnowledgeGraph,
  activeChanges: ChangeNode[],
  pendingPromises: SpecPromise[],
  qualityScore: number,
  blockedItems: AnyNode[],
): string {
  const parts: string[] = []

  parts.push(`Project "${graph.project_id}" has ${graph.nodes.length} nodes and ${graph.relationships.length} relationships.`)

  if (activeChanges.length > 0) {
    parts.push(`${activeChanges.length} active change(s): ${activeChanges.map((c) => c.id).join(", ")}.`)
  }

  if (pendingPromises.length > 0) {
    parts.push(`${pendingPromises.length} pending promises to fulfill.`)
  }

  if (blockedItems.length > 0) {
    parts.push(`${blockedItems.length} blocked item(s) require attention.`)
  }

  const qualityPercent = (qualityScore * 100).toFixed(0)
  parts.push(`Quality score: ${qualityPercent}%.`)

  return parts.join(" ")
}

/**
 * Compute graph health indicators for proactive monitoring.
 */
export interface GraphHealth {
  staleChanges: number
  staleChangeIds: string[]
  cyclesDetected: number
  godNodes: Array<{ id: string; name: string; relCount: number }>
  orphanChanges: number
  draftEndpoints: number
}

export interface GraphHealthOptions {
  /** Skip cycle detection (DFS O(V+E)). */
  skipCycleDetection?: boolean
  /** Only check these node types for god nodes and orphans. */
  focusNodeTypes?: string[]
}

export function computeGraphHealth(graph: KnowledgeGraph, options?: GraphHealthOptions): GraphHealth {
  const now = Date.now()
  const STALE_DAYS = 7
  const GOD_THRESHOLD = Math.max(50, graph.nodes.length * 0.25)

  // Stale changes (PROPOSED/APPROVED for >7 days)
  const staleChanges: string[] = []
  const allChanges = graph.nodes.filter((n) => n.type === "change") as ChangeNode[]
  for (const change of allChanges) {
    if (["PROPOSED", "APPROVED", "DRAFT"].includes(change.status)) {
      const age = now - new Date(change.created_at).getTime()
      if (age > STALE_DAYS * 24 * 60 * 60 * 1000) {
        staleChanges.push(change.id)
      }
    }
  }

  // Cycles detection (simplified) — skippable
  let cyclesDetected = 0
  if (!options?.skipCycleDetection) {
    const adjList = new Map<string, string[]>()
    for (const rel of graph.relationships) {
      if (!adjList.has(rel.from)) adjList.set(rel.from, [])
      adjList.get(rel.from)!.push(rel.to)
    }
    const visitedGlobal = new Set<string>()
    const inStack = new Set<string>()

    function dfsCycle(nodeId: string): void {
      if (inStack.has(nodeId)) { cyclesDetected++; return }
      if (visitedGlobal.has(nodeId)) return
      visitedGlobal.add(nodeId)
      inStack.add(nodeId)
      for (const neighbor of adjList.get(nodeId) || []) {
        dfsCycle(neighbor)
      }
      inStack.delete(nodeId)
    }
    for (const node of graph.nodes) {
      if (!visitedGlobal.has(node.id)) dfsCycle(node.id)
    }
  }

  // God nodes — optionally filtered by focusNodeTypes
  const relCounts = new Map<string, number>()
  for (const rel of graph.relationships) {
    relCounts.set(rel.from, (relCounts.get(rel.from) || 0) + 1)
    relCounts.set(rel.to, (relCounts.get(rel.to) || 0) + 1)
  }
  const godNodes: Array<{ id: string; name: string; relCount: number }> = []
  for (const [nodeId, count] of relCounts.entries()) {
    if (count > GOD_THRESHOLD) {
      const node = graph.nodes.find((n) => n.id === nodeId)
      if (node && node.type !== "project") {
        if (!options?.focusNodeTypes || options.focusNodeTypes.includes(node.type)) {
          godNodes.push({ id: nodeId, name: node.name, relCount: count })
        }
      }
    }
  }

  // Orphan changes (CHG nodes with no relationships)
  let orphanChanges = 0
  for (const change of allChanges) {
    const hasRels = graph.relationships.some(
      (r) => r.from === change.id || r.to === change.id
    )
    if (!hasRels) orphanChanges++
  }

  // DRAFT endpoints
  const draftEndpoints = graph.nodes.filter(
    (n) => n.type === "endpoint" && n.status === "DRAFT"
  ).length

  return {
    staleChanges: staleChanges.length,
    staleChangeIds: staleChanges,
    cyclesDetected,
    godNodes,
    orphanChanges,
    draftEndpoints,
  }
}

function formatHealthReport(health: GraphHealth): string {
  const issues: string[] = []

  if (health.staleChanges > 0) {
    issues.push(`🔴 ${health.staleChanges} stale change(s) (>7 days without activity): ${health.staleChangeIds.slice(0, 5).join(", ")}${health.staleChanges > 5 ? "..." : ""}`)
  }
  if (health.cyclesDetected > 0) {
    issues.push(`🔴 ${health.cyclesDetected} cycle(s) detected in graph traversal`)
  }
  if (health.godNodes.length > 0) {
    for (const gn of health.godNodes.slice(0, 3)) {
      issues.push(`🟡 God node: "${gn.name}" (${gn.relCount} relationships) — consider splitting`)
    }
  }
  if (health.orphanChanges > 0) {
    issues.push(`🟡 ${health.orphanChanges} orphan change node(s) with no relationships`)
  }
  if (health.draftEndpoints > 0) {
    issues.push(`🔵 ${health.draftEndpoints} endpoint(s) still in DRAFT status`)
  }

  if (issues.length === 0) {
    return "✅ Graph health: No issues detected."
  }

  return ["## ⚠️ Graph Health Issues", "", ...issues].join("\n")
}

export function formatHandoffPack(handoff: SessionHandoff): string {
  const lines = [
    "## SDD Session Handoff",
    `**Project:** ${handoff.project_id}`,
    `**Last Session:** ${handoff.last_session}`,
    `**Quality Score:** ${(handoff.quality_score * 100).toFixed(1)}%`,
    "",
    handoff.summary,
  ]

  // Include graph health report if available
  if ((handoff as any).health) {
    lines.push("")
    lines.push(formatHealthReport((handoff as any).health))
  }

  if (handoff.active_changes.length > 0) {
    lines.push("\n### Active Changes")
    for (const c of handoff.active_changes) {
      lines.push(`- **${c.id}** (${c.status}): ${c.metadata.title}`)
    }
  }

  if (handoff.blocked_items.length > 0) {
    lines.push("\n### Blocked Items")
    for (const item of handoff.blocked_items) {
      lines.push(`- **${item.id}** (${item.type}): ${item.name}`)
    }
  }

  if (handoff.recent_decisions.length > 0) {
    lines.push("\n### Recent Decisions")
    for (const d of handoff.recent_decisions) {
      lines.push(`- **${d.id}**: ${d.metadata.decision}`)
    }
  }

  if (handoff.pending_promises.length > 0) {
    lines.push("\n### Pending Promises (top 10)")
    for (const p of handoff.pending_promises) {
      lines.push(`- **${p.id}**: ${p.description}`)
    }
  }

  return lines.join("\n")
}

export function saveSessionLog(projectDir: string, action: string): void {
  const path = join(projectDir, SESSION_FILE)
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  let log: Array<{ timestamp: string; action: string }> = []
  if (existsSync(path)) {
    try {
      log = JSON.parse(readFileSync(path, "utf-8"))
    } catch {
      log = []
    }
  }

  log.push({ timestamp: new Date().toISOString(), action })
  if (log.length > 100) log.splice(0, log.length - 100)

  atomicWriteFile(path, JSON.stringify(log, null, 2))
}
