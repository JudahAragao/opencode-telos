import type { KnowledgeGraph, AnyNode, NodeType } from "../domain/types.js"
import { getNodesByType } from "../graph/engine.js"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"

const PATTERNS_FILE = ".sdd/patterns.json"

export interface LearnedPatterns {
  metadata: {
    last_updated: string
    sample_size: number
  }
  node_defaults: Record<string, Record<string, unknown>>
  relationship_patterns: Array<{
    from_type: NodeType
    to_type: NodeType
    relationship_type: string
    frequency: number
  }>
  approval_history: Record<string, number>
  naming_conventions: Record<string, string>
}

/**
 * Analyze the graph to learn project patterns.
 * These patterns are used for smarter defaults in new nodes.
 */
export function learnPatterns(graph: KnowledgeGraph): LearnedPatterns {
  const patterns: LearnedPatterns = {
    metadata: {
      last_updated: new Date().toISOString(),
      sample_size: graph.nodes.length,
    },
    node_defaults: computeNodeDefaults(graph),
    relationship_patterns: computeRelationshipPatterns(graph),
    approval_history: computeApprovalHistory(graph),
    naming_conventions: computeNamingConventions(graph),
  }

  return patterns
}

function computeNodeDefaults(graph: KnowledgeGraph): Record<string, Record<string, unknown>> {
  const defaults: Record<string, Record<string, unknown>> = {}

  const byType = new Map<string, AnyNode[]>()
  for (const node of graph.nodes) {
    const list = byType.get(node.type) || []
    list.push(node)
    byType.set(node.type, list)
  }

  for (const [type, nodes] of byType) {
    if (nodes.length < 3) continue

    // Find most common metadata keys
    const keyCounts = new Map<string, Map<string, number>>()
    for (const node of nodes) {
      const meta = node.metadata as Record<string, unknown>
      for (const [key, value] of Object.entries(meta)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          if (!keyCounts.has(key)) keyCounts.set(key, new Map())
          const valStr = String(value)
          keyCounts.get(key)!.set(valStr, (keyCounts.get(key)!.get(valStr) || 0) + 1)
        }
      }
    }

    const typeDefaults: Record<string, unknown> = {}
    for (const [key, counts] of keyCounts) {
      // If a value appears in >60% of nodes, use it as default
      let maxCount = 0
      let maxVal = ""
      for (const [val, count] of counts) {
        if (count > maxCount) {
          maxCount = count
          maxVal = val
        }
      }
      if (maxCount >= nodes.length * 0.6) {
        typeDefaults[key] = maxVal
      }
    }

    if (Object.keys(typeDefaults).length > 0) {
      defaults[type] = typeDefaults
    }
  }

  return defaults
}

function computeRelationshipPatterns(graph: KnowledgeGraph): LearnedPatterns["relationship_patterns"] {
  const patternCounts = new Map<string, { from: NodeType; to: NodeType; type: string; count: number }>()

  for (const rel of graph.relationships) {
    const fromNode = graph.nodes.find(n => n.id === rel.from)
    const toNode = graph.nodes.find(n => n.id === rel.to)
    if (!fromNode || !toNode) continue

    const key = `${fromNode.type}||${toNode.type}||${rel.type}`
    const existing = patternCounts.get(key)
    if (existing) {
      existing.count++
    } else {
      patternCounts.set(key, {
        from: fromNode.type,
        to: toNode.type,
        type: rel.type,
        count: 1,
      })
    }
  }

  return [...patternCounts.values()]
    .filter(p => p.count >= 2) // Only patterns that appear at least twice
    .sort((a, b) => b.count - a.count)
    .slice(0, 50) // Top 50 patterns
    .map(p => ({
      from_type: p.from,
      to_type: p.to,
      relationship_type: p.type,
      frequency: p.count,
    }))
}

function computeApprovalHistory(graph: KnowledgeGraph): Record<string, number> {
  const history: Record<string, number> = {}
  for (const node of graph.nodes) {
    if (node.type !== "change") continue
    const meta = node.metadata as any
    if (meta.approval_level) {
      history[meta.approval_level] = (history[meta.approval_level] || 0) + 1
    }
  }
  return history
}

function computeNamingConventions(graph: KnowledgeGraph): Record<string, string> {
  const conventions: Record<string, string> = {}

  const byType = new Map<string, string[]>()
  for (const node of graph.nodes) {
    const list = byType.get(node.type) || []
    list.push(node.name)
    byType.set(node.type, list)
  }

  for (const [type, names] of byType) {
    if (names.length < 3) continue

    let pascalCase = 0, camelCase = 0, snakeCase = 0, kebabCase = 0
    for (const name of names) {
      if (/^[A-Z][a-zA-Z0-9]+$/.test(name)) pascalCase++
      else if (/^[a-z][a-zA-Z0-9]+$/.test(name)) camelCase++
      else if (/^[a-z][a-z0-9_]+$/.test(name)) snakeCase++
      else if (/^[a-z][a-z0-9-]+$/.test(name)) kebabCase++
    }

    const total = pascalCase + camelCase + snakeCase + kebabCase
    if (total === 0) continue

    if (pascalCase / total > 0.6) conventions[type] = "PascalCase"
    else if (camelCase / total > 0.6) conventions[type] = "camelCase"
    else if (snakeCase / total > 0.6) conventions[type] = "snake_case"
    else if (kebabCase / total > 0.6) conventions[type] = "kebab-case"
  }

  return conventions
}

/**
 * Get suggested defaults for a new node based on learned patterns.
 */
export function getSuggestedDefaults(
  patterns: LearnedPatterns,
  nodeType: NodeType,
): Record<string, unknown> {
  return patterns.node_defaults[nodeType] || {}
}

/**
 * Get suggested relationships for a new node based on learned patterns.
 */
export function getSuggestedRelationships(
  patterns: LearnedPatterns,
  nodeType: NodeType,
): Array<{ to_type: NodeType; relationship_type: string }> {
  return patterns.relationship_patterns
    .filter(p => p.from_type === nodeType || p.to_type === nodeType)
    .map(p => ({
      to_type: p.from_type === nodeType ? p.to_type : p.from_type,
      relationship_type: p.relationship_type,
    }))
    .slice(0, 5)
}

/**
 * Get suggested naming convention for a node type.
 */
export function getSuggestedNaming(
  patterns: LearnedPatterns,
  nodeType: NodeType,
): string | undefined {
  return patterns.naming_conventions[nodeType]
}

/**
 * Load learned patterns from disk.
 */
export function loadPatterns(projectDir: string): LearnedPatterns | null {
  const path = join(projectDir, PATTERNS_FILE)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return null
  }
}

/**
 * Save learned patterns to disk.
 */
export function savePatterns(projectDir: string, patterns: LearnedPatterns): void {
  const path = join(projectDir, PATTERNS_FILE)
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(patterns, null, 2), "utf-8")
}

/**
 * Format learned patterns as readable report.
 */
export function formatPatterns(patterns: LearnedPatterns): string {
  const lines = [
    "## Learned Patterns",
    `**Sample size:** ${patterns.metadata.sample_size} nodes`,
    `**Last updated:** ${patterns.metadata.last_updated}`,
    "",
  ]

  if (Object.keys(patterns.node_defaults).length > 0) {
    lines.push("### Node Defaults")
    for (const [type, defaults] of Object.entries(patterns.node_defaults)) {
      lines.push(`- **${type}:** ${JSON.stringify(defaults)}`)
    }
    lines.push("")
  }

  if (patterns.relationship_patterns.length > 0) {
    lines.push("### Relationship Patterns (top 10)")
    for (const p of patterns.relationship_patterns.slice(0, 10)) {
      lines.push(`- ${p.from_type} →[${p.relationship_type}]→ ${p.to_type} (×${p.frequency})`)
    }
    lines.push("")
  }

  if (Object.keys(patterns.naming_conventions).length > 0) {
    lines.push("### Naming Conventions")
    for (const [type, conv] of Object.entries(patterns.naming_conventions)) {
      lines.push(`- **${type}:** ${conv}`)
    }
  }

  return lines.join("\n")
}
