import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, rmSync } from "fs"
import { join, dirname, relative } from "path"
import type { AnyNode, KnowledgeGraph } from "../domain/types.js"
import { atomicWriteFile } from "../cache/atomic.js"

export interface MarkdownNode {
  frontMatter: NodeFrontMatter
  body: string
  filePath: string
  graphVersion: number
}

export interface NodeFrontMatter {
  id: string
  type: string
  name: string
  status: string
  version: number
  created_at: string
  updated_at: string
  graph_version: number
  md_path: string
}

const DOCS_DIR = "docs"
const VERSION_DIR_PREFIX = "v"
const MARKDOWN_EXTENSION = ".md"

export class MarkdownRepository {
  private projectDir: string
  private docsDir: string

  constructor(projectDir: string) {
    this.projectDir = projectDir
    this.docsDir = join(projectDir, ".sdd", DOCS_DIR)
  }

  ensureDocsDir(): void {
    if (!existsSync(this.docsDir)) {
      mkdirSync(this.docsDir, { recursive: true })
    }
  }

  getGraphVersion(graph: KnowledgeGraph): number {
    // Extract numeric version from graph.metadata.sdd_version or graph.version
    const versionStr = graph.metadata?.sdd_version || graph.version || "1.0.0"
    const match = versionStr.match(/(\d+)/)
    return match ? parseInt(match[1], 10) : 1
  }

  getVersionDir(graphVersion: number): string {
    return join(this.docsDir, `${VERSION_DIR_PREFIX}${graphVersion}`)
  }

  getVersionDirPath(graphVersion: number): string {
    return join(".sdd", DOCS_DIR, `${VERSION_DIR_PREFIX}${graphVersion}`)
  }

  getDocPath(nodeId: string, graphVersion: number): string {
    return join(this.getVersionDir(graphVersion), `${nodeId}${MARKDOWN_EXTENSION}`)
  }

  getRelativeDocPath(nodeId: string, graphVersion: number): string {
    return join(this.getVersionDirPath(graphVersion), `${nodeId}${MARKDOWN_EXTENSION}`)
  }

  getLatestVersionDir(): string | null {
    if (!existsSync(this.docsDir)) return null
    const entries = readdirSync(this.docsDir, { withFileTypes: true })
    const versionDirs = entries
      .filter((e) => e.isDirectory() && e.name.startsWith(VERSION_DIR_PREFIX))
      .map((e) => parseInt(e.name.slice(1), 10))
      .filter((v) => !isNaN(v))
      .sort((a, b) => b - a)
    return versionDirs.length > 0 ? join(this.docsDir, `${VERSION_DIR_PREFIX}${versionDirs[0]}`) : null
  }

  getLatestGraphVersion(): number {
    const dir = this.getLatestVersionDir()
    if (!dir) return 0
    const match = dir.match(new RegExp(`${VERSION_DIR_PREFIX}(\\d+)$`))
    return match ? parseInt(match[1], 10) : 0
  }

  read(nodeId: string, graphVersion?: number): MarkdownNode | null {
    const version = graphVersion || this.getLatestGraphVersion()
    if (version === 0) return null

    const filePath = this.getDocPath(nodeId, version)
    if (!existsSync(filePath)) {
      // Try to find in previous versions
      for (let v = version - 1; v >= 1; v--) {
        const prevPath = this.getDocPath(nodeId, v)
        if (existsSync(prevPath)) {
          const content = readFileSync(prevPath, "utf-8")
          const parsed = this.parse(content)
          return {
            frontMatter: parsed.frontMatter,
            body: parsed.body,
            filePath: prevPath,
            graphVersion: v,
          }
        }
      }
      return null
    }

    const content = readFileSync(filePath, "utf-8")
    const parsed = this.parse(content)
    return {
      frontMatter: parsed.frontMatter,
      body: parsed.body,
      filePath,
      graphVersion: version,
    }
  }

  readAtVersion(nodeId: string, graphVersion: number): MarkdownNode | null {
    const filePath = this.getDocPath(nodeId, graphVersion)
    if (!existsSync(filePath)) return null
    const content = readFileSync(filePath, "utf-8")
    const parsed = this.parse(content)
    return {
      frontMatter: parsed.frontMatter,
      body: parsed.body,
      filePath,
      graphVersion,
    }
  }

  write(node: AnyNode, body: string, graph: KnowledgeGraph): void {
    const graphVersion = this.getGraphVersion(graph)
    const versionDir = this.getVersionDir(graphVersion)
    
    if (!existsSync(versionDir)) {
      mkdirSync(versionDir, { recursive: true })
    }

    const filePath = this.getDocPath(node.id, graphVersion)
    const frontMatter = this.buildFrontMatter(node, graphVersion)
    const content = this.serialize(frontMatter, body)
    atomicWriteFile(filePath, content)
  }

  writeMandatory(node: AnyNode, graph: KnowledgeGraph, existingBody?: string): string {
    /** Write markdown for a node. If existingBody provided, merge changes; otherwise create from template. */
    const graphVersion = this.getGraphVersion(graph)
    let body: string

    if (existingBody) {
      // LLM requested update - merge intelligently
      body = this.mergeMarkdown(existingBody, node, graph)
    } else {
      // First creation or no existing body - use template
      body = this.buildInitialMarkdown(node, graphVersion)
    }

    this.write(node, body, graph)
    return body
  }

  mergeMarkdown(existingBody: string, node: AnyNode, graph: KnowledgeGraph): string {
    /** Merge strategy: preserve sections not mentioned in update request, update only modified sections. */
    // For now, return existing body - the LLM tool will handle the merge
    // This is a placeholder for future intelligent merge logic
    return existingBody
  }

  delete(nodeId: string, graphVersion?: number): void {
    const version = graphVersion || this.getLatestGraphVersion()
    if (version === 0) return
    const filePath = this.getDocPath(nodeId, version)
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
  }

  deleteAllVersions(nodeId: string): void {
    // Delete from all version directories
    if (!existsSync(this.docsDir)) return
    const entries = readdirSync(this.docsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith(VERSION_DIR_PREFIX)) {
        const filePath = join(this.docsDir, entry.name, `${nodeId}${MARKDOWN_EXTENSION}`)
        if (existsSync(filePath)) {
          unlinkSync(filePath)
        }
      }
    }
  }

  exists(nodeId: string, graphVersion?: number): boolean {
    const version = graphVersion || this.getLatestGraphVersion()
    if (version === 0) return false
    return existsSync(this.getDocPath(nodeId, version))
  }

  existsInAnyVersion(nodeId: string): boolean {
    if (!existsSync(this.docsDir)) return false
    const entries = readdirSync(this.docsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith(VERSION_DIR_PREFIX)) {
        const filePath = join(this.docsDir, entry.name, `${nodeId}${MARKDOWN_EXTENSION}`)
        if (existsSync(filePath)) return true
      }
    }
    return false
  }

  listAll(graphVersion?: number): string[] {
    const version = graphVersion || this.getLatestGraphVersion()
    if (version === 0) return []
    const versionDir = this.getVersionDir(version)
    if (!existsSync(versionDir)) return []
    const entries = readdirSync(versionDir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(MARKDOWN_EXTENSION))
      .map((e) => e.name.replace(MARKDOWN_EXTENSION, ""))
  }

  listAllVersions(): Map<number, string[]> {
    const result = new Map<number, string[]>()
    if (!existsSync(this.docsDir)) return result
    const entries = readdirSync(this.docsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith(VERSION_DIR_PREFIX)) {
        const version = parseInt(entry.name.slice(1), 10)
        if (!isNaN(version)) {
          const versionDir = join(this.docsDir, entry.name)
          const files = readdirSync(versionDir, { withFileTypes: true })
            .filter((e) => e.isFile() && e.name.endsWith(MARKDOWN_EXTENSION))
            .map((e) => e.name.replace(MARKDOWN_EXTENSION, ""))
          result.set(version, files)
        }
      }
    }
    return result
  }

  parse(content: string): { frontMatter: NodeFrontMatter; body: string } {
    const frontMatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/
    const match = content.match(frontMatterRegex)

    if (!match) {
      return {
        frontMatter: {
          id: "",
          type: "",
          name: "",
          status: "",
          version: 0,
          created_at: "",
          updated_at: "",
          graph_version: 0,
          md_path: "",
        },
        body: content,
      }
    }

    const frontMatterText = match[1]
    const body = match[2]

    const frontMatter: NodeFrontMatter = {
      id: "",
      type: "",
      name: "",
      status: "",
      version: 0,
      created_at: "",
      updated_at: "",
      graph_version: 0,
      md_path: "",
    }

    for (const line of frontMatterText.split("\n")) {
      const [key, ...valueParts] = line.split(":")
      const value = valueParts.join(":").trim()
      const trimmedKey = key.trim()

      switch (trimmedKey) {
        case "id":
          frontMatter.id = value.replace(/^["']|["']$/g, "")
          break
        case "type":
          frontMatter.type = value.replace(/^["']|["']$/g, "")
          break
        case "name":
          frontMatter.name = value.replace(/^["']|["']$/g, "")
          break
        case "status":
          frontMatter.status = value.replace(/^["']|["']$/g, "")
          break
        case "version":
          frontMatter.version = parseInt(value, 10)
          break
        case "created_at":
          frontMatter.created_at = value.replace(/^["']|["']$/g, "")
          break
        case "updated_at":
          frontMatter.updated_at = value.replace(/^["']|["']$/g, "")
          break
        case "graph_version":
          frontMatter.graph_version = parseInt(value, 10)
          break
        case "md_path":
          frontMatter.md_path = value.replace(/^["']|["']$/g, "")
          break
      }
    }

    return { frontMatter, body }
  }

  serialize(frontMatter: NodeFrontMatter, body: string): string {
    const lines = [
      "---",
      `id: "${frontMatter.id}"`,
      `type: "${frontMatter.type}"`,
      `name: "${frontMatter.name}"`,
      `status: "${frontMatter.status}"`,
      `version: ${frontMatter.version}`,
      `created_at: "${frontMatter.created_at}"`,
      `updated_at: "${frontMatter.updated_at}"`,
      `graph_version: ${frontMatter.graph_version}`,
      `md_path: "${frontMatter.md_path}"`,
      "---",
      "",
      body,
    ]
    return lines.join("\n")
  }

  buildFrontMatter(node: AnyNode, graphVersion: number): NodeFrontMatter {
    return {
      id: node.id,
      type: node.type,
      name: node.name,
      status: node.status,
      version: node.version,
      created_at: node.created_at,
      updated_at: node.updated_at,
      graph_version: graphVersion,
      md_path: this.getRelativeDocPath(node.id, graphVersion),
    }
  }

  buildInitialMarkdown(node: AnyNode, graphVersion: number): string {
    const sections = this.getTemplateSections(node.type)
    let body = `# ${node.type.charAt(0).toUpperCase() + node.type.slice(1)}: ${node.name}\n\n`

    if (node.description) {
      body += `## Overview\n${node.description}\n\n`
    }

    for (const section of sections) {
      body += `## ${section}\n\n<!-- TODO: Add ${section.toLowerCase()} details -->\n\n`
    }

    body += `## Relationships\n\n<!-- Auto-generated from graph -->\n\n`
    body += `## Implementation Files\n\n<!-- Auto-generated from codegen -->\n\n`
    body += `## History\n\n| Version | Date | Author | Change |\n|---------|------|--------|--------|\n| ${node.version} | ${node.updated_at.split("T")[0]} | System | Initial creation (graph v${graphVersion}) |\n`

    return body
  }

  private getTemplateSections(nodeType: string): string[] {
    const templates: Record<string, string[]> = {
      feature: [
        "Functional Requirements",
        "Business Rules",
        "Entities Involved",
        "API Endpoints",
        "Architecture Decisions (ADRs)",
        "Acceptance Criteria",
        "Tests",
      ],
      requirement: [
        "Description",
        "Acceptance Criteria",
        "Verification Scenarios",
        "API Contract",
        "Security Criteria",
        "Performance Criteria",
      ],
      entity: [
        "Fields",
        "Relationships",
        "Business Rules",
        "Indexes",
      ],
      endpoint: [
        "HTTP Method & Path",
        "Request Body",
        "Response Body",
        "Query Parameters",
        "Headers",
        "Error Responses",
        "Authentication",
        "Rate Limiting",
      ],
      change: [
        "Summary",
        "Motivation",
        "Affected Components",
        "Migration Plan",
        "Rollback Plan",
        "Testing Strategy",
      ],
      business_rule: [
        "Rule Text",
        "Scope",
        "Exceptions",
        "Related Entities",
      ],
      use_case: [
        "Actors",
        "Preconditions",
        "Postconditions",
        "Main Flow",
        "Alternative Flows",
        "Exceptions",
      ],
      flow: [
        "Steps",
        "Decision Points",
        "Parallel Paths",
        "Error Handling",
      ],
      architecture_component: [
        "Layer",
        "Technology",
        "Responsibilities",
        "Interfaces",
        "Dependencies",
      ],
      domain: [
        "Domain Description",
        "Key Concepts",
        "Ubiquitous Language",
        "Bounded Context",
      ],
      project: [
        "Project Description",
        "Tech Stack",
        "Architecture Overview",
        "Key Decisions",
      ],
    }

    return templates[nodeType] || ["Details"]
  }

  syncFromGraph(graph: KnowledgeGraph): { created: number; updated: number; skipped: number } {
    this.ensureDocsDir()
    const graphVersion = this.getGraphVersion(graph)
    const prevVersion = graphVersion - 1
    let created = 0
    let updated = 0
    let skipped = 0

    // Copy unchanged files from previous version to new version directory
    if (prevVersion >= 1) {
      this.copyUnchangedFromVersion(prevVersion, graphVersion, graph)
    }

    for (const node of graph.nodes) {
      const existing = this.read(node.id, graphVersion)
      const expectedPath = this.getRelativeDocPath(node.id, graphVersion)

      if (existing) {
        // Check if front-matter needs update (version mismatch)
        if (existing.frontMatter.version !== node.version || existing.frontMatter.md_path !== expectedPath) {
          this.write(node, existing.body, graph)
          updated++
        } else {
          skipped++
        }
      } else {
        // MANDATORY: Create new markdown file with initial template for every node
        const body = this.buildInitialMarkdown(node, graphVersion)
        this.write(node, body, graph)
        created++
      }
    }

    // Update graph version tracking
    this.writeGraphVersionMarker(graphVersion)

    return { created, updated, skipped }
  }

  private copyUnchangedFromVersion(fromVersion: number, toVersion: number, graph: KnowledgeGraph): void {
    const fromDir = this.getVersionDir(fromVersion)
    const toDir = this.getVersionDir(toVersion)
    
    if (!existsSync(fromDir)) return
    if (!existsSync(toDir)) {
      mkdirSync(toDir, { recursive: true })
    }

    const entries = readdirSync(fromDir, { withFileTypes: true })
    const graphNodeIds = new Set(graph.nodes.map(n => n.id))

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(MARKDOWN_EXTENSION)) {
        const nodeId = entry.name.replace(MARKDOWN_EXTENSION, "")
        // Only copy if node still exists in graph
        if (graphNodeIds.has(nodeId)) {
          const fromPath = join(fromDir, entry.name)
          const toPath = join(toDir, entry.name)
          
          // Check if target already exists (created in this sync)
          if (!existsSync(toPath)) {
            const content = readFileSync(fromPath, "utf-8")
            const parsed = this.parse(content)
            // Update front-matter graph_version
            const newFrontMatter = { ...parsed.frontMatter, graph_version: toVersion, md_path: this.getRelativeDocPath(nodeId, toVersion) }
            const newContent = this.serialize(newFrontMatter, parsed.body)
            atomicWriteFile(toPath, newContent)
          }
        }
      }
    }
  }

  private writeGraphVersionMarker(graphVersion: number): void {
    const markerPath = join(this.docsDir, `.graph-version`)
    atomicWriteFile(markerPath, String(graphVersion))
  }

  getGraphVersionFromMarker(): number {
    const markerPath = join(this.docsDir, `.graph-version`)
    if (!existsSync(markerPath)) return 0
    try {
      return parseInt(readFileSync(markerPath, "utf-8").trim(), 10)
    } catch {
      return 0
    }
  }

  validateSync(graph: KnowledgeGraph): SyncReport {
    const graphVersion = this.getGraphVersion(graph)
    const report: SyncReport = {
      totalNodes: graph.nodes.length,
      nodesWithMdPath: 0,
      nodesWithMarkdownFile: 0,
      nodesWithoutMarkdownFile: 0,
      frontMatterMismatches: [],
      orphanMarkdownFiles: [],
      missingMdPath: [],
      graphVersion,
    }

    const markdownFiles = new Set(this.listAll(graphVersion))

    for (const node of graph.nodes) {
      if (node.md_path) {
        report.nodesWithMdPath++
      } else {
        report.missingMdPath.push(node.id)
      }

      const expectedPath = this.getRelativeDocPath(node.id, graphVersion)
      if (markdownFiles.has(node.id)) {
        report.nodesWithMarkdownFile++
        const existing = this.read(node.id, graphVersion)
        if (existing) {
          if (existing.frontMatter.id !== node.id) {
            report.frontMatterMismatches.push({
              nodeId: node.id,
              issue: `front-matter id (${existing.frontMatter.id}) != node id (${node.id})`,
            })
          }
          if (existing.frontMatter.version !== node.version) {
            report.frontMatterMismatches.push({
              nodeId: node.id,
              issue: `front-matter version (${existing.frontMatter.version}) != node version (${node.version})`,
            })
          }
          if (existing.frontMatter.graph_version !== graphVersion) {
            report.frontMatterMismatches.push({
              nodeId: node.id,
              issue: `front-matter graph_version (${existing.frontMatter.graph_version}) != graph version (${graphVersion})`,
            })
          }
          if (existing.frontMatter.md_path !== expectedPath && existing.frontMatter.md_path !== node.md_path) {
            report.frontMatterMismatches.push({
              nodeId: node.id,
              issue: `front-matter md_path (${existing.frontMatter.md_path}) != expected (${expectedPath})`,
            })
          }
        }
      } else {
        report.nodesWithoutMarkdownFile++
      }
    }

    // Check for orphan markdown files in current version
    for (const fileNodeId of markdownFiles) {
      const node = graph.nodes.find((n) => n.id === fileNodeId)
      if (!node) {
        report.orphanMarkdownFiles.push(fileNodeId)
      }
    }

    return report
  }

  autoFixSync(graph: KnowledgeGraph): { fixed: number; errors: string[] } {
    const graphVersion = this.getGraphVersion(graph)
    const errors: string[] = []
    let fixed = 0

    // Fix missing md_path on nodes
    for (const node of graph.nodes) {
      if (!node.md_path) {
        node.md_path = this.getRelativeDocPath(node.id, graphVersion)
        fixed++
      }
    }

    // Create missing markdown files (MANDATORY)
    const syncResult = this.syncFromGraph(graph)
    fixed += syncResult.created + syncResult.updated

    return { fixed, errors }
  }

  // For LLM tools: get full markdown context for a node
  getNodeContext(nodeId: string, graph: KnowledgeGraph): { current: MarkdownNode | null; history: MarkdownNode[] } {
    const graphVersion = this.getGraphVersion(graph)
    const current = this.read(nodeId, graphVersion)
    const history: MarkdownNode[] = []

    // Collect history from all versions
    for (let v = 1; v <= graphVersion; v++) {
      const atVersion = this.readAtVersion(nodeId, v)
      if (atVersion) {
        history.push(atVersion)
      }
    }

    return { current, history }
  }
}

export interface SyncReport {
  totalNodes: number
  nodesWithMdPath: number
  nodesWithMarkdownFile: number
  nodesWithoutMarkdownFile: number
  frontMatterMismatches: Array<{ nodeId: string; issue: string }>
  orphanMarkdownFiles: string[]
  missingMdPath: string[]
  graphVersion: number
}