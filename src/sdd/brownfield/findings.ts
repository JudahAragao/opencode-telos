import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { extname } from "node:path"
import type {
  AnyNode,
  FindingCategory,
  FindingEvidence,
  FindingNode,
  FindingStatus,
  KnowledgeGraph,
  SddPurpose,
} from "../domain/types.js"
import { addNode, addRelationship, getNode, updateNode } from "../graph/engine.js"
import { createTask, type TaskPriority } from "../tasks/board.js"
import type { BrownfieldAnalysis } from "./scanner.js"

export interface FindingInput {
  category: FindingCategory
  severity: "critical" | "high" | "medium" | "low"
  title: string
  observed_behavior: string
  expected_behavior?: string
  purpose: SddPurpose
  confidence?: number
  source_files?: string[]
  source_node_ids?: string[]
  evidence?: FindingEvidence[]
  remediation?: string
  target_behavior?: string
  fingerprint?: string
}

export interface FindingResolutionInput {
  findingId: string
  description: string
  status?: Extract<FindingStatus, "resolved" | "closed" | "accepted" | "wont_fix">
  changeId?: string
  taskId?: string
  targetNodeIds?: string[]
  evidence?: FindingEvidence[]
  actor?: string
}

export interface FindingScanResult {
  findings: FindingInput[]
  filesInspected: number
  detectors: string[]
}

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".java", ".rb", ".rs", ".php", ".cs",
])

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16)
}

export function findingFingerprint(input: Pick<FindingInput, "category" | "title" | "source_files" | "observed_behavior">): string {
  return stableHash([
    input.category,
    input.title.trim().toLowerCase(),
    (input.source_files ?? []).slice().sort().join(","),
    input.observed_behavior.trim().toLowerCase(),
  ].join("|"))
}

function findingId(fingerprint: string): string {
  return `FND-${fingerprint}`
}

function now(): string {
  return new Date().toISOString()
}

function statusHistory(finding: FindingNode): FindingNode["metadata"]["history"] {
  return Array.isArray(finding.metadata.history) ? finding.metadata.history : []
}

function sourceNodeForPath(graph: KnowledgeGraph, path: string): AnyNode | undefined {
  return graph.nodes.find((node) => {
    if (node.type !== "file") return false
    const metadata = node.metadata as Record<string, unknown>
    return metadata.path === path || node.name === path
  })
}

function ensureSourceFile(graph: KnowledgeGraph, path: string): AnyNode | undefined {
  const existing = sourceNodeForPath(graph, path)
  if (existing) return existing

  const id = `${graph.project_id}-FILE-${stableHash(path)}`
  if (getNode(graph, id)) return getNode(graph, id)
  const timestamp = now()
  const file = {
    id,
    type: "file" as const,
    name: path,
    description: `Source file observed during brownfield analysis: ${path}`,
    status: "APPROVED" as const,
    version: 1,
    metadata: { path, discovered_by: "brownfield_findings" },
    created_at: timestamp,
    updated_at: timestamp,
  }
  addNode(graph, file)
  try { addRelationship(graph, graph.project_id, id, "contains", { source: "brownfield_findings" }) } catch {}
  return file
}

export function upsertFinding(graph: KnowledgeGraph, input: FindingInput): FindingNode {
  const fingerprint = input.fingerprint ?? findingFingerprint(input)
  const existing = graph.nodes.find((node) =>
    node.type === "finding" && (node.metadata as Record<string, unknown>).fingerprint === fingerprint,
  ) as FindingNode | undefined

  const sourceFiles = [...new Set(input.source_files ?? [])]
  const sourceNodeIds = [...new Set(input.source_node_ids ?? [])]
  const evidence = input.evidence ?? []
  if (existing) {
    const metadata = existing.metadata
    const mergedEvidence = [...(metadata.evidence ?? []), ...evidence]
      .filter((item, index, all) => all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(item)) === index)
    const mergedFiles = [...new Set([...(metadata.source_files ?? []), ...sourceFiles])]
    const mergedNodes = [...new Set([...(metadata.source_node_ids ?? []), ...sourceNodeIds])]
    updateNode(graph, existing.id, {
      metadata: {
        ...metadata,
        evidence: mergedEvidence,
        source_files: mergedFiles,
        source_node_ids: mergedNodes,
        confidence: Math.max(metadata.confidence ?? 0, input.confidence ?? 0.5),
      },
    })
    return getNode(graph, existing.id) as FindingNode
  }

  const timestamp = now()
  const node: FindingNode = {
    id: findingId(fingerprint),
    type: "finding",
    name: input.title,
    description: input.observed_behavior,
    status: "open",
    version: 1,
    metadata: {
      fingerprint,
      category: input.category,
      severity: input.severity,
      title: input.title,
      observed_behavior: input.observed_behavior,
      expected_behavior: input.expected_behavior,
      purpose: input.purpose,
      confidence: input.confidence ?? 0.5,
      evidence,
      source_files: sourceFiles.slice(0, 50),
      source_node_ids: sourceNodeIds,
      remediation: input.remediation,
      target_behavior: input.target_behavior,
      history: [{ status: "open", at: timestamp, actor: "brownfield_scan" }],
    },
    created_at: timestamp,
    updated_at: timestamp,
  }
  addNode(graph, node)

  for (const path of sourceFiles) {
    const source = ensureSourceFile(graph, path)
    if (source) {
      try { addRelationship(graph, node.id, source.id, "detected_in", { source: "brownfield_findings", path }) } catch {}
    }
  }
  for (const sourceId of sourceNodeIds) {
    if (!getNode(graph, sourceId)) continue
    try { addRelationship(graph, node.id, sourceId, "detected_in", { source: "brownfield_findings" }) } catch {}
  }
  return node
}

export function createFindingTask(
  graph: KnowledgeGraph,
  finding: FindingNode,
  options: { purpose: SddPurpose; targetNodeId?: string; blocked?: boolean } = { purpose: "documentation" },
): AnyNode {
  const existing = graph.nodes.find((node) =>
    node.type === "task" && (node.metadata as Record<string, unknown>).finding_id === finding.id,
  )
  if (existing) return existing

  const metadataPriority = finding.metadata.severity as TaskPriority
  const targetName = options.targetNodeId ? getNode(graph, options.targetNodeId)?.name : undefined
  const task = createTask(graph, {
    name: options.purpose === "documentation"
      ? `Corrigir descoberta: ${finding.name}`
      : `Implement derived decision: ${targetName ?? finding.name}`,
    description: options.purpose === "documentation"
      ? finding.metadata.observed_behavior
      : finding.metadata.target_behavior ?? finding.metadata.observed_behavior,
    goal: options.purpose === "documentation"
      ? finding.metadata.remediation ?? "Fix the observed problem and add verification."
      : finding.metadata.target_behavior ?? "Implementar o comportamento definido no SDD alvo.",
    files: options.purpose === "documentation" ? finding.metadata.source_files : [],
    acceptance: [
      options.purpose === "documentation"
        ? "A causa da descoberta foi corrigida no sistema documentado."
        : "The target behaviour is implemented without reproducing the source system's problem.",
      "Verification evidence is recorded in the SDD.",
    ],
    priority: metadataPriority,
    status: options.blocked ? "blocked" : "todo",
    link_to: options.targetNodeId ?? finding.id,
    link_type: options.targetNodeId ? "implements" : "resolves",
    origin: options.purpose === "documentation" ? "documentation_finding" : "reverse_engineering_target",
    integration_status: "pending",
  })
  ;(task.metadata as Record<string, unknown>).finding_id = finding.id
  ;(task.metadata as Record<string, unknown>).purpose = options.purpose
  try { addRelationship(graph, finding.id, task.id, "tracked_by", { source: "brownfield_findings" }) } catch {}
  return task
}

export function resolveFinding(graph: KnowledgeGraph, input: FindingResolutionInput): FindingNode {
  const node = getNode(graph, input.findingId)
  if (!node || node.type !== "finding") throw new Error(`Finding ${input.findingId} not found`)
  const finding = node as FindingNode
  const timestamp = now()
  const status = input.status ?? "resolved"
  if ((status === "resolved" || status === "closed") && finding.metadata.purpose === "documentation" && !input.changeId && !input.taskId) {
    throw new Error("Documentation findings require a change_id or task_id before they can be marked resolved.")
  }
  if ((status === "resolved" || status === "closed") && finding.metadata.purpose === "reverse_engineering" && !(input.targetNodeIds?.length || input.changeId || input.taskId)) {
    throw new Error("Reverse-engineering findings require target_node_ids, change_id, or task_id before they can be marked resolved.")
  }
  const metadata = finding.metadata
  const resolutionEvidence = input.evidence ?? []
  const history = [...statusHistory(finding), {
    status,
    at: timestamp,
    reason: input.description,
    actor: input.actor ?? "sdd.findings",
  }]
  const resolved = updateNode(graph, finding.id, {
    status,
    metadata: {
      ...metadata,
      history,
      resolution: {
        description: input.description,
        change_id: input.changeId,
        task_id: input.taskId,
        evidence: resolutionEvidence,
        resolved_at: timestamp,
      },
    },
  }) as FindingNode

  for (const sourceId of [input.changeId, input.taskId, ...(input.targetNodeIds ?? [])].filter(Boolean) as string[]) {
    if (!getNode(graph, sourceId)) continue
    const source = getNode(graph, sourceId)!
    const type = source.type === "change" || source.type === "task" || source.type === "requirement" || source.type === "decision" || source.type === "constraint"
      ? "resolves"
      : "evidenced_by"
    try { addRelationship(graph, sourceId, finding.id, type, { source: "finding_resolution", description: input.description }) } catch {}
  }
  return resolved
}

export function transitionFinding(
  graph: KnowledgeGraph,
  findingId: string,
  status: FindingStatus,
  reason?: string,
  actor = "sdd.findings",
): FindingNode {
  const node = getNode(graph, findingId)
  if (!node || node.type !== "finding") throw new Error(`Finding ${findingId} not found`)
  const finding = node as FindingNode
  const history = [...statusHistory(finding), { status, at: now(), reason, actor }]
  return updateNode(graph, findingId, {
    status,
    metadata: { ...finding.metadata, history },
  }) as FindingNode
}

export function getFindings(graph: KnowledgeGraph, status?: FindingStatus): FindingNode[] {
  return graph.nodes.filter((node) => node.type === "finding" && (!status || node.status === status)) as FindingNode[]
}

export function formatFindingsReport(graph: KnowledgeGraph, purpose?: SddPurpose): string {
  const findings = getFindings(graph).filter((finding) => !purpose || finding.metadata.purpose === purpose)
  const counts = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.status] = (acc[finding.status] ?? 0) + 1
    return acc
  }, {})
  const lines = [
    "## Brownfield Findings",
    "",
    `Total: ${findings.length}`,
    `Open: ${counts.open ?? 0} | In progress: ${counts.in_progress ?? 0} | Resolved: ${counts.resolved ?? 0} | Accepted: ${counts.accepted ?? 0}`,
  ]
  for (const finding of findings.sort((a, b) => a.metadata.severity.localeCompare(b.metadata.severity))) {
    lines.push(`- **${finding.id}** [${finding.status}/${finding.metadata.severity}] ${finding.name}`)
    lines.push(`  - ${finding.metadata.observed_behavior}`)
    if (finding.metadata.resolution) lines.push(`  - Resolution: ${finding.metadata.resolution.description}`)
  }
  return lines.join("\n")
}

function sourceFilesFrom(brownfield: BrownfieldAnalysis): string[] {
  return brownfield.structure.files.filter((file) => CODE_EXTENSIONS.has(extname(file).toLowerCase()))
}

export function detectBrownfieldFindings(
  projectDir: string,
  brownfield: BrownfieldAnalysis,
  purpose: SddPurpose,
): FindingScanResult {
  const findings: FindingInput[] = []
  const sourceFiles = sourceFilesFrom(brownfield)
  const testFiles = brownfield.test_files
  const docs = brownfield.documentation_files
  const detectors = ["brownfield-structure", "source-patterns", "test-coverage", "documentation-coverage"]

  if (sourceFiles.length > 0 && testFiles.length === 0) {
    findings.push({
      category: "test_gap",
      severity: "high",
      title: "Executable code without tests detected",
      observed_behavior: "The project has code files, but the scanner found no automated tests.",
      expected_behavior: "Relevant behaviours should have unit, integration or end-to-end tests.",
      purpose,
      confidence: 0.88,
      remediation: "Add tests for the critical flows and record the acceptance scenarios.",
      target_behavior: "The new system should start with automated coverage for the critical flows.",
      source_files: sourceFiles,
      evidence: [{ kind: "scan", detector: "test-coverage", excerpt: `source_files=${sourceFiles.length}; test_files=0`, confidence: 0.88 }],
    })
  }

  if (sourceFiles.length > 0 && docs.length === 0) {
    findings.push({
      category: "documentation",
      severity: "low",
      title: "Project documentation not detected",
      observed_behavior: "The project has no detectable README, CHANGELOG or documentation directory.",
      expected_behavior: "Public behaviour and relevant decisions should be documented.",
      purpose,
      confidence: 0.82,
      remediation: "Create usage, architecture and operations documentation.",
      target_behavior: "The new system should have minimum documentation for operation and maintenance.",
      source_files: [],
      evidence: [{ kind: "scan", detector: "documentation-coverage", excerpt: "documentation_files=0", confidence: 0.82 }],
    })
  }

  for (const file of sourceFiles) {
    let content = ""
    try { content = readFileSync(`${projectDir}/${file}`, "utf-8") } catch { continue }

    const todo = content.match(/\b(TODO|FIXME|HACK)\b[^\n]*/i)?.[0]
    if (todo) findings.push({
      category: "quality",
      severity: /FIXME|HACK/i.test(todo) ? "medium" : "low",
      title: `Explicit TODO in ${file}`,
      observed_behavior: `The file contains a TODO annotation: ${todo.trim().slice(0, 180)}`,
      expected_behavior: "Relevant open items should be resolved or formalized in the SDD.",
      purpose,
      confidence: 0.95,
      remediation: "Resolve the open item and add a test or decision that justifies the implementation.",
      target_behavior: "The corresponding decision should be explicit in the new system's SDD.",
      source_files: [file],
      evidence: [{ kind: "file", path: file, detector: "source-patterns", excerpt: todo.trim().slice(0, 180), confidence: 0.95 }],
    })

    if (/\bdebugger\b|\bconsole\.(?:log|debug|trace)\s*\(/.test(content)) findings.push({
      category: "quality",
      severity: "low",
      title: `Debug log in ${file}`,
      observed_behavior: "The file contains debug output directly in production code.",
      expected_behavior: "Logs should use the system's observable and configurable strategy.",
      purpose,
      confidence: 0.78,
      remediation: "Replace the direct output with structured logging or remove it.",
      target_behavior: "The new system should use structured logging controlled per environment.",
      source_files: [file],
      evidence: [{ kind: "file", path: file, detector: "source-patterns", confidence: 0.78 }],
    })

    if (/\bany\b/.test(content) && /\.(?:ts|tsx)$/.test(file)) findings.push({
      category: "quality",
      severity: "medium",
      title: `Tipagem fraca em ${file}`,
      observed_behavior: "The TypeScript file uses the any type, weakening static checking.",
      expected_behavior: "Public contracts should have explicit types or a recorded justification.",
      purpose,
      confidence: 0.74,
      remediation: "Replace any with explicit types or record the architectural exception.",
      target_behavior: "The new system should keep typed contracts at public boundaries.",
      source_files: [file],
      evidence: [{ kind: "file", path: file, detector: "source-patterns", confidence: 0.74 }],
    })

    if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(content)) findings.push({
      category: "quality",
      severity: "high",
      title: `Silently discarded error in ${file}`,
      observed_behavior: "There is an empty catch block that discards failures without handling or telemetry.",
      expected_behavior: "Failures should be handled, propagated or logged with context.",
      purpose,
      confidence: 0.9,
      remediation: "Define error handling and a test for the failure scenario.",
      target_behavior: "The new system should have an explicit error handling policy.",
      source_files: [file],
      evidence: [{ kind: "file", path: file, detector: "source-patterns", confidence: 0.9 }],
    })

    if (/(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}["']/i.test(content)) findings.push({
      category: "security",
      severity: "critical",
      title: `Possible embedded secret in ${file}`,
      observed_behavior: "The file contains a string that looks like a credential or secret.",
      expected_behavior: "Secrets should come from secure storage or protected variables.",
      purpose,
      confidence: 0.86,
      remediation: "Remove the secret, rotate it and use secure configuration.",
      target_behavior: "The new system must not store credentials in source code.",
      source_files: [file],
      evidence: [{ kind: "file", path: file, detector: "source-patterns", confidence: 0.86 }],
    })
  }

  return { findings, filesInspected: sourceFiles.length, detectors }
}
