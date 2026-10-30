import type { KnowledgeGraph, AnyNode } from "../domain/types.js"
import { MarkdownRepository, SyncReport } from "../persistence/markdown.js"

export function validateMarkdownSync(graph: KnowledgeGraph, projectDir: string): SyncReport {
  const mdRepo = new MarkdownRepository(projectDir)
  return mdRepo.validateSync(graph)
}

export function formatSyncReport(report: SyncReport): string {
  const lines = [
    "## Markdown Sync Validation Report",
    "",
    `**Graph Version:** ${report.graphVersion}`,
    `**Total Nodes:** ${report.totalNodes}`,
    `**Nodes with md_path:** ${report.nodesWithMdPath}`,
    `**Nodes with Markdown file:** ${report.nodesWithMarkdownFile}`,
    `**Nodes without Markdown file:** ${report.nodesWithoutMarkdownFile}`,
    `**Front-matter mismatches:** ${report.frontMatterMismatches.length}`,
    `**Orphan Markdown files:** ${report.orphanMarkdownFiles.length}`,
    `**Missing md_path:** ${report.missingMdPath.length}`,
    "",
  ]

  if (report.frontMatterMismatches.length > 0) {
    lines.push("### Front-matter Mismatches")
    for (const mismatch of report.frontMatterMismatches) {
      lines.push(`- **${mismatch.nodeId}**: ${mismatch.issue}`)
    }
    lines.push("")
  }

  if (report.orphanMarkdownFiles.length > 0) {
    lines.push("### Orphan Markdown Files (no corresponding node)")
    for (const nodeId of report.orphanMarkdownFiles) {
      lines.push(`- ${nodeId}`)
    }
    lines.push("")
  }

  if (report.missingMdPath.length > 0) {
    lines.push("### Nodes Missing md_path")
    for (const nodeId of report.missingMdPath) {
      lines.push(`- ${nodeId}`)
    }
    lines.push("")
  }

  const isClean = report.frontMatterMismatches.length === 0 &&
                  report.orphanMarkdownFiles.length === 0 &&
                  report.missingMdPath.length === 0 &&
                  report.nodesWithoutMarkdownFile === 0

  lines.push(`**Status:** ${isClean ? "✅ CLEAN" : "❌ ISSUES FOUND"}`)

  return lines.join("\n")
}

export function autoFixMarkdownSync(graph: KnowledgeGraph, projectDir: string): { fixed: number; errors: string[] } {
  const mdRepo = new MarkdownRepository(projectDir)
  const graphVersion = mdRepo.getGraphVersion(graph)
  const errors: string[] = []
  let fixed = 0

  // Fix missing md_path on nodes
  for (const node of graph.nodes) {
    if (!node.md_path) {
      node.md_path = mdRepo.getRelativeDocPath(node.id, graphVersion)
      fixed++
    }
  }

  // Create missing markdown files
  const syncResult = mdRepo.syncFromGraph(graph)
  fixed += syncResult.created + syncResult.updated

  // Note: We don't auto-delete orphan markdown files as they might contain valuable content
  // User should review and manually clean up

  return { fixed, errors }
}