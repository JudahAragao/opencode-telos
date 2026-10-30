import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "fs"
import { join, dirname } from "path"
import type { AnyNode, KnowledgeGraph } from "../domain/types.js"
import { atomicWriteFile } from "../cache/atomic.js"

export interface MarkdownNode {
  frontMatter: NodeFrontMatter
  body: string
  filePath: string
}

export interface NodeFrontMatter {
  id: string
  type: string
  name: string
  status: string
  version: number
  created_at: string
  updated_at: string
  graph_version: string
  md_path: string
}

const DOCS_DIR = "docs"
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

  getDocPath(nodeId: string): string {
    return join(this.docsDir, `${nodeId}${MARKDOWN_EXTENSION}`)
  }

  getRelativeDocPath(nodeId: string): string {
    return join(".sdd", DOCS_DIR, `${nodeId}${MARKDOWN_EXTENSION}`)
  }

  read(nodeId: string): MarkdownNode | null {
    const filePath = this.getDocPath(nodeId)
    if (!existsSync(filePath)) return null

    const content = readFileSync(filePath, "utf-8")
    const parsed = this.parse(content)
    return {
      frontMatter: parsed.frontMatter,
      body: parsed.body,
      filePath,
    }
  }

  write(node: AnyNode, body: string): void {
    this.ensureDocsDir()
    const filePath = this.getDocPath(node.id)
    const frontMatter = this.buildFrontMatter(node)
    const content = this.serialize(frontMatter, body)
    atomicWriteFile(filePath, content)
  }

  delete(nodeId: string): void {
    const filePath = this.getDocPath(nodeId)
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
  }

  exists(nodeId: string): boolean {
    return existsSync(this.getDocPath(nodeId))
  }

  listAll(): string[] {
    if (!existsSync(this.docsDir)) return []
    const entries = readdirSync(this.docsDir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(MARKDOWN_EXTENSION))
      .map((e) => e.name.replace(MARKDOWN_EXTENSION, ""))
  }

  listAllWithPaths(): Array<{ nodeId: string; filePath: string }> {
    if (!existsSync(this.docsDir)) return []
    const entries = readdirSync(this.docsDir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(MARKDOWN_EXTENSION))
      .map((e) => ({
        nodeId: e.name.replace(MARKDOWN_EXTENSION, ""),
        filePath: join(this.docsDir, e.name),
      }))
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
          graph_version: "",
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
      graph_version: "",
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
          frontMatter.graph_version = value.replace(/^["']|["']$/g, "")
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
      `graph_version: "${frontMatter.graph_version}"`,
      `md_path: "${frontMatter.md_path}"`,
      "---",
      "",
      body,
    ]
    return lines.join("\n")
  }

  buildFrontMatter(node: AnyNode): NodeFrontMatter {
    return {
      id: node.id,
      type: node.type,
      name: node.name,
      status: node.status,
      version: node.version,
      created_at: node.created_at,
      updated_at: node.updated_at,
      graph_version: "1.0.0",
      md_path: node.md_path || this.getRelativeDocPath(node.id),
    }
  }

  buildInitialMarkdown(node: AnyNode): string {
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
    body += `## History\n\n| Version | Date | Author | Change |\n|---------|------|--------|--------|\n| ${node.version} | ${node.updated_at.split("T")[0]} | System | Initial creation |\n`

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
    let created = 0
    let updated = 0
    let skipped = 0

    for (const node of graph.nodes) {
      const existing = this.read(node.id)
      const expectedPath = this.getRelativeDocPath(node.id)

      if (existing) {
        // Check if front-matter needs update (version mismatch)
        if (existing.frontMatter.version !== node.version || existing.frontMatter.md_path !== expectedPath) {
          this.write(node, existing.body)
          updated++
        } else {
          skipped++
        }
      } else {
        // Create new markdown file with initial template
        const body = this.buildInitialMarkdown(node)
        this.write(node, body)
        created++
      }
    }

    return { created, updated, skipped }
  }

  validateSync(graph: KnowledgeGraph): SyncReport {
    const report: SyncReport = {
      totalNodes: graph.nodes.length,
      nodesWithMdPath: 0,
      nodesWithMarkdownFile: 0,
      nodesWithoutMarkdownFile: 0,
      frontMatterMismatches: [],
      orphanMarkdownFiles: [],
      missingMdPath: [],
    }

    const markdownFiles = new Set(this.listAll())

    for (const node of graph.nodes) {
      if (node.md_path) {
        report.nodesWithMdPath++
      } else {
        report.missingMdPath.push(node.id)
      }

      const expectedPath = this.getRelativeDocPath(node.id)
      if (markdownFiles.has(node.id)) {
        report.nodesWithMarkdownFile++
        const existing = this.read(node.id)
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

    // Check for orphan markdown files (files without corresponding node)
    for (const fileNodeId of markdownFiles) {
      const node = graph.nodes.find((n) => n.id === fileNodeId)
      if (!node) {
        report.orphanMarkdownFiles.push(fileNodeId)
      }
    }

    return report
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
}