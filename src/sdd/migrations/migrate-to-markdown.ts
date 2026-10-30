import { createRepository } from "../persistence/repository.js"
import { MarkdownRepository } from "../persistence/markdown.js"
import type { KnowledgeGraph } from "../domain/types.js"
import { join } from "path"

export interface MigrationReport {
  projectDir: string
  totalNodes: number
  nodesWithMdPath: number
  nodesWithoutMdPath: number
  markdownFilesCreated: number
  markdownFilesUpdated: number
  markdownFilesSkipped: number
  errors: string[]
}

export function migrateToMarkdown(projectDir: string): MigrationReport {
  const repo = createRepository(projectDir)

  if (!repo.isInitialized()) {
    return {
      projectDir,
      totalNodes: 0,
      nodesWithMdPath: 0,
      nodesWithoutMdPath: 0,
      markdownFilesCreated: 0,
      markdownFilesUpdated: 0,
      markdownFilesSkipped: 0,
      errors: ["SDD not initialized in this project"],
    }
  }

  const graph = repo.loadGraph()
  const mdRepo = new MarkdownRepository(projectDir)

  let nodesWithMdPath = 0
  let nodesWithoutMdPath = 0

  // Ensure all nodes have md_path
  for (const node of graph.nodes) {
    if (node.md_path) {
      nodesWithMdPath++
    } else {
      node.md_path = `.sdd/docs/${node.id}.md`
      nodesWithoutMdPath++
    }
  }

  // Sync markdown files
  const syncResult = mdRepo.syncFromGraph(graph)

  // Save graph if md_path was updated
  if (nodesWithoutMdPath > 0) {
    repo.saveGraph(graph)
  }

  return {
    projectDir,
    totalNodes: graph.nodes.length,
    nodesWithMdPath,
    nodesWithoutMdPath,
    markdownFilesCreated: syncResult.created,
    markdownFilesUpdated: syncResult.updated,
    markdownFilesSkipped: syncResult.skipped,
    errors: [],
  }
}

export function formatMigrationReport(report: MigrationReport): string {
  const lines = [
    "## Markdown Migration Report",
    "",
    `**Project:** ${report.projectDir}`,
    `**Total Nodes:** ${report.totalNodes}`,
    `**Nodes with md_path:** ${report.nodesWithMdPath}`,
    `**Nodes without md_path (fixed):** ${report.nodesWithoutMdPath}`,
    "",
    `**Markdown Files Created:** ${report.markdownFilesCreated}`,
    `**Markdown Files Updated:** ${report.markdownFilesUpdated}`,
    `**Markdown Files Skipped:** ${report.markdownFilesSkipped}`,
    "",
  ]

  if (report.errors.length > 0) {
    lines.push("**Errors:**")
    for (const error of report.errors) {
      lines.push(`- ${error}`)
    }
  } else {
    lines.push("**Status:** ✅ Migration completed successfully")
  }

  return lines.join("\n")
}

// CLI entry point
if (import.meta.main) {
  const projectDir = process.argv[2] || process.cwd()
  const report = migrateToMarkdown(projectDir)
  console.log(formatMigrationReport(report))
}