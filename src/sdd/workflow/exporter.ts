import type { KnowledgeGraph, ChangeNode, DecisionNode } from "../domain/types.js"
import { getNodesByType } from "../graph/engine.js"
import { getPendingChanges } from "../changes/manager.js"

export interface WorkflowExport {
  project_id: string
  exported_at: string
  summary: {
    total_nodes: number
    total_relationships: number
    nodes_by_type: Record<string, number>
    status_distribution: Record<string, number>
  }
  changes: ChangeExport[]
  decisions: DecisionExport[]
  blockers: BlockerExport[]
  recommendations: string[]
}

export interface ChangeExport {
  id: string
  status: string
  title: string
  created_at: string
}

export interface DecisionExport {
  id: string
  decision: string
  rationale?: string
  created_at: string
}

export interface BlockerExport {
  node_id: string
  node_type: string
  name: string
  reason: string
}

export function exportWorkflow(graph: KnowledgeGraph): WorkflowExport {
  const nodesByType: Record<string, number> = {}
  for (const node of graph.nodes) {
    nodesByType[node.type] = (nodesByType[node.type] || 0) + 1
  }

  const statusDistribution: Record<string, number> = {}
  for (const node of graph.nodes) {
    statusDistribution[node.status] = (statusDistribution[node.status] || 0) + 1
  }

  const changes = getNodesByType<ChangeNode>(graph, "change").map((c) => ({
    id: c.id,
    status: c.status,
    title: c.metadata.title,
    created_at: c.created_at,
  }))

  const decisions = getNodesByType<DecisionNode>(graph, "decision").map((d) => ({
    id: d.id,
    decision: d.metadata.decision,
    rationale: d.metadata.context,
    created_at: d.created_at,
  }))

  const blockers = graph.nodes
    .filter((n) => n.status === "BLOCKED")
    .map((n) => ({
      node_id: n.id,
      node_type: n.type,
      name: n.name,
      reason: (n.metadata as any).reason || "Unknown",
    }))

  const recommendations = generateRecommendations(graph)

  return {
    project_id: graph.project_id,
    exported_at: new Date().toISOString(),
    summary: {
      total_nodes: graph.nodes.length,
      total_relationships: graph.relationships.length,
      nodes_by_type: nodesByType,
      status_distribution: statusDistribution,
    },
    changes,
    decisions,
    blockers,
    recommendations,
  }
}

function generateRecommendations(graph: KnowledgeGraph): string[] {
  const recs: string[] = []

  const pendingChanges = getPendingChanges(graph)
  if (pendingChanges.length > 3) {
    recs.push(`${pendingChanges.length} changes pending approval - consider batch review`)
  }

  const features = getNodesByType(graph, "feature")
  const completedFeatures = features.filter((f) => f.status === "COMPLETED")
  if (features.length > 0 && completedFeatures.length / features.length < 0.5) {
    recs.push("Less than 50% of features completed - focus on finishing existing work")
  }

  const requirements = getNodesByType(graph, "requirement")
  const tests = getNodesByType(graph, "test")
  if (requirements.length > 0 && tests.length < requirements.length * 0.5) {
    recs.push("Low test coverage - add tests for requirements")
  }

  const blocked = graph.nodes.filter((n) => n.status === "BLOCKED")
  if (blocked.length > 0) {
    recs.push(`${blocked.length} blocked items need resolution`)
  }

  if (recs.length === 0) {
    recs.push("Project looks healthy - keep up the good work!")
  }

  return recs
}

export function formatWorkflowExport(exp: WorkflowExport): string {
  const lines = [
    `## SDD Workflow Export`,
    `**Project:** ${exp.project_id}`,
    `**Exported:** ${exp.exported_at}`,
    "",
    "### Summary",
    `- Nodes: ${exp.summary.total_nodes}`,
    `- Relationships: ${exp.summary.total_relationships}`,
    "",
    "#### Nodes by Type",
  ]

  for (const [type, count] of Object.entries(exp.summary.nodes_by_type)) {
    lines.push(`- ${type}: ${count}`)
  }

  lines.push("\n#### Status Distribution")
  for (const [status, count] of Object.entries(exp.summary.status_distribution)) {
    lines.push(`- ${status}: ${count}`)
  }

  if (exp.changes.length > 0) {
    lines.push("\n### Changes")
    for (const c of exp.changes) {
      lines.push(`- **${c.id}** (${c.status}): ${c.title}`)
    }
  }

  if (exp.blockers.length > 0) {
    lines.push("\n### Blockers")
    for (const b of exp.blockers) {
      lines.push(`- **${b.name}** (${b.node_type}): ${b.reason}`)
    }
  }

  if (exp.recommendations.length > 0) {
    lines.push("\n### Recommendations")
    for (const r of exp.recommendations) {
      lines.push(`- ${r}`)
    }
  }

  return lines.join("\n")
}
