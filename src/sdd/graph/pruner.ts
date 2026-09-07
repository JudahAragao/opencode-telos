import type { KnowledgeGraph, FileNode, SymbolNode, TestNode, ChangeNode } from "../domain/types.js"
import { getNodesByType, removeNode } from "./engine.js"
import { existsSync, readFileSync } from "fs"
import { projectPath } from "../security/paths.js"
import { sddDebug } from "../log.js"

export interface PruneReport {
  removed_nodes: Array<{ id: string; type: string; name: string; reason: string }>
  deprecated_changes: string[]
  total_removed: number
  total_deprecated: number
  space_freed_estimate: string
}

/**
 * Prune obsolete nodes from the graph:
 * - FileNodes pointing to deleted files
 * - SymbolNodes pointing to non-existent symbols
 * - TestNodes for deleted test files
 * - Old completed ChangeNodes (>30 days)
 * - Duplicate relationships
 */
export function pruneGraph(graph: KnowledgeGraph, projectDir: string): PruneReport {
  const report: PruneReport = {
    removed_nodes: [],
    deprecated_changes: [],
    total_removed: 0,
    total_deprecated: 0,
    space_freed_estimate: "0 nodes",
  }

  // 1. Remove FileNodes for deleted files
  pruneDeadFileNodes(graph, projectDir, report)

  // 2. Remove SymbolNodes for deleted symbols
  pruneDeadSymbolNodes(graph, projectDir, report)

  // 3. Remove TestNodes for deleted test files
  pruneDeadTestNodes(graph, projectDir, report)

  // 4. Archive old completed ChangeNodes
  archiveOldChanges(graph, report)

  // 5. Remove duplicate relationships
  pruneDuplicateRelationships(graph, report)

  report.space_freed_estimate = `${report.total_removed} node(s) removed, ${report.total_deprecated} change(s) archived`
  return report
}

function pruneDeadFileNodes(graph: KnowledgeGraph, projectDir: string, report: PruneReport): void {
  const fileNodes = getNodesByType<FileNode>(graph, "file")
  for (const fileNode of fileNodes) {
    const path = fileNode.metadata.path
    if (!path) continue
    const fullPath = projectPath(projectDir, path)
    if (!existsSync(fullPath)) {
      report.removed_nodes.push({
        id: fileNode.id,
        type: "file",
        name: fileNode.name,
        reason: `File no longer exists: ${path}`,
      })
      try {
        removeNode(graph, fileNode.id)
        report.total_removed++
      } catch (error) { sddDebug("pruner", `Failed to remove file node ${fileNode.id}`, error) }
    }
  }
}

function pruneDeadSymbolNodes(graph: KnowledgeGraph, projectDir: string, report: PruneReport): void {
  const symbolNodes = getNodesByType<SymbolNode>(graph, "symbol")
  for (const symNode of symbolNodes) {
    const filePath = symNode.metadata.file_path
    if (!filePath) continue
    const fullPath = projectPath(projectDir, filePath)
    if (!existsSync(fullPath)) {
      report.removed_nodes.push({
        id: symNode.id,
        type: "symbol",
        name: symNode.name,
        reason: `Source file no longer exists: ${filePath}`,
      })
      try {
        removeNode(graph, symNode.id)
        report.total_removed++
      } catch (error) { sddDebug("pruner", `Failed to remove symbol node ${symNode.id}`, error) }
      continue
    }

    // Check if the symbol still exists in the file
    try {
      const content = readFileSync(fullPath, "utf-8")
      const name = symNode.name.split(".").pop() || symNode.name // Handle Class.method
      if (!content.includes(name)) {
        report.removed_nodes.push({
          id: symNode.id,
          type: "symbol",
          name: symNode.name,
          reason: `Symbol "${name}" no longer found in ${filePath}`,
        })
        try {
          removeNode(graph, symNode.id)
          report.total_removed++
        } catch (error) { sddDebug("pruner", `Failed to remove dead symbol ${symNode.id}`, error) }
      }
    } catch (error) { sddDebug("pruner", `Failed to read file for symbol check: ${filePath}`, error) }
  }
}

function pruneDeadTestNodes(graph: KnowledgeGraph, projectDir: string, report: PruneReport): void {
  const testNodes = getNodesByType<TestNode>(graph, "test")
  for (const testNode of testNodes) {
    const target = (testNode.metadata as any).target
    if (!target) continue
    const fullPath = projectPath(projectDir, target)
    if (!existsSync(fullPath)) {
      report.removed_nodes.push({
        id: testNode.id,
        type: "test",
        name: testNode.name,
        reason: `Test file no longer exists: ${target}`,
      })
      try {
        removeNode(graph, testNode.id)
        report.total_removed++
      } catch (error) { sddDebug("pruner", `Failed to remove test node ${testNode.id}`, error) }
    }
  }
}

function archiveOldChanges(graph: KnowledgeGraph, report: PruneReport): void {
  const now = Date.now()
  const ARCHIVE_DAYS = 30

  const changeNodes = getNodesByType<ChangeNode>(graph, "change")
  for (const change of changeNodes) {
    if (change.status !== "COMPLETED") continue
    const age = now - new Date(change.updated_at).getTime()
    if (age > ARCHIVE_DAYS * 24 * 60 * 60 * 1000) {
      change.status = "DEPRECATED"
      change.updated_at = new Date().toISOString()
      change.metadata = {
        ...change.metadata,
        auto_archived: true,
        archived_reason: `Auto-archived: completed ${Math.floor(age / (24 * 60 * 60 * 1000))} days ago`,
      }
      report.deprecated_changes.push(change.id)
      report.total_deprecated++
    }
  }
}

function pruneDuplicateRelationships(graph: KnowledgeGraph, report: PruneReport): void {
  const seen = new Set<string>()
  const toRemove: number[] = []

  for (let i = 0; i < graph.relationships.length; i++) {
    const rel = graph.relationships[i]
    const key = `${rel.from}||${rel.to}||${rel.type}`
    if (seen.has(key)) {
      toRemove.push(i)
      report.total_removed++
    } else {
      seen.add(key)
    }
  }

  // Remove in reverse order to maintain indices
  for (let i = toRemove.length - 1; i >= 0; i--) {
    graph.relationships.splice(toRemove[i], 1)
  }
}

/**
 * Format prune report as readable markdown.
 */
export function formatPruneReport(report: PruneReport): string {
  const lines = [
    "## Graph Pruning Report",
    "",
  ]

  if (report.total_removed === 0 && report.total_deprecated === 0) {
    lines.push("✅ Graph is clean. No obsolete nodes found.")
    return lines.join("\n")
  }

  if (report.removed_nodes.length > 0) {
    lines.push(`### Removed Nodes (${report.removed_nodes.length})`)
    const byType = new Map<string, typeof report.removed_nodes>()
    for (const node of report.removed_nodes) {
      const list = byType.get(node.type) || []
      list.push(node)
      byType.set(node.type, list)
    }
    for (const [type, nodes] of byType) {
      lines.push(`\n**${type}** (${nodes.length}):`)
      for (const node of nodes.slice(0, 10)) {
        lines.push(`- ${node.name}: ${node.reason}`)
      }
      if (nodes.length > 10) lines.push(`- ... and ${nodes.length - 10} more`)
    }
    lines.push("")
  }

  if (report.deprecated_changes.length > 0) {
    lines.push(`### Archived Changes (${report.deprecated_changes.length})`)
    lines.push(`Changes older than 30 days marked as DEPRECATED:`)
    for (const id of report.deprecated_changes.slice(0, 10)) {
      lines.push(`- ${id}`)
    }
    if (report.deprecated_changes.length > 10) {
      lines.push(`- ... and ${report.deprecated_changes.length - 10} more`)
    }
    lines.push("")
  }

  lines.push(`**Summary:** ${report.space_freed_estimate}`)
  return lines.join("\n")
}
