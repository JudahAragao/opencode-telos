import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { createRepository, loadSddConfig, type GraphRepository } from "../sdd/persistence/repository.js"
import { getNeighbors } from "../sdd/graph/engine.js"
import {
  createGraph,
  addNode,
  getNode,
  addRelationship,
  removeRelationship,
  getRelationships,
  updateNode,
  removeNode,
  getNodeIndexed,
  getNodesByTypeIndexed,
  getNodesByStatusIndexed,
  getOutgoingIndexed,
  getIncomingIndexed,
  searchNodesIndexed,
  getGraphStatsIndexed,
} from "../sdd/graph/engine.js"
import { GraphIndices } from "../sdd/graph/index.js"
import { bfsOutgoing, bfsBoth, bfsIncoming, computeImpact, findPath, getSubgraph } from "../sdd/graph/traverse.js"
import { analyzeBriefing, generateDiscoveryQuestions, updateGraphFromAnswers, formatDiscoverySummary } from "../sdd/discovery/briefing.js"
import { createChange, classifyApprovalLevel, approveChange, completeChange, getPendingChanges, failChange, getChangeHistory, formatImpactReport } from "../sdd/changes/manager.js"
import { validateGraph, formatValidationResult } from "../sdd/validation/validator.js"
import { detectDrift, formatDriftReport } from "../sdd/drift/detector.js"
import { buildSddContextPack } from "./system-prompt.js"
import { generateProject, writeGeneratedFiles, detectTechStack } from "../sdd/codegen/generator.js"
import { enforceSddFirst, classifyChangeRequest, buildEnforcementPrompt, getSddEnforcementRules } from "../sdd/enforcement/interceptor.js"
import { isSddEnabled, setToggleState, getToggleState } from "../sdd/toggle/state.js"
import { validateAgainstConstitution, formatConstitutionResult } from "../sdd/constitution/validator.js"
import { extractPromises, getPromiseReport, verifyPromise, markPromiseViolated, formatPromiseReport } from "../sdd/promises/tracker.js"
import { findUnverifiablePromises } from "../sdd/promises/classifier.js"
import { calculateQualityScore, formatQualityReport } from "../sdd/quality/scorer.js"
import { generateHandoff, formatHandoffPack, saveSessionLog, computeGraphHealth } from "../sdd/session/handoff.js"
import { detectAntiPatterns, formatAntiPatterns } from "../sdd/patterns/anti-patterns.js"
import { detectAstClones, formatCloneReport } from "../sdd/patterns/ast-clones.js"
import { detectContradictions, formatContradictionReport } from "../sdd/patterns/contradictions.js"
import { calculateCoverage, formatCoverageReport } from "../sdd/coverage/tracker.js"
import { detectConfigDrift, formatConfigDriftReport } from "../sdd/patterns/config-drift.js"
import { exportWorkflow, formatWorkflowExport } from "../sdd/workflow/exporter.js"
import { generateShellHooks, formatShellHookResult } from "./shell-hooks.js"
import { scanExistingProject, formatBrownfieldAnalysis } from "../sdd/brownfield/scanner.js"
import { generateCicd, writeCicdFiles, formatCicdResults } from "../sdd/cicd/generators.js"
import { getSyncStatus, pullLatest, pushChanges, detectConflicts, mergeGraphs, acquireLock, releaseLock, formatSyncStatus, resolveConflict } from "../sdd/sync/git-sync.js"
import { createSnapshot, executeRollback, loadRollbackHistory, formatRollbackResult, formatRollbackHistory } from "../sdd/rollback/manager.js"
import { loadPermissions, checkPermission, checkChangeApproval, setRole, getUserRoleWithAuth, addAuditEntry, getAuditLog, formatPermissionCheck, formatAuditLog, detectRemote, formatRemoteStatus, savePermissions, getRequiredApprovals, getUserRole, fetchRemoteUser } from "../sdd/permissions/access.js"
import { analyzeCodebase } from "../code-intelligence/analyzer.js"
import { createMcpServer } from "../mcp/server.js"
import { SddDashboardServer } from "../server/server.js"
import { readJson } from "../sdd/persistence/yaml.js"
import type { KnowledgeGraph, AnyNode, NodeType, ConstitutionNode } from "../sdd/domain/types.js"
import { getCacheManager } from "../sdd/cache/manager.js"
import { markEnforced, markApproved, markValidated, markCompleted, resetWorkflowState } from "../sdd/enforcement/workflow-tracker.js"
import { validateSmart, type SmartValidationOptions } from "../sdd/validation/smart-validator.js"
import { validateExecutableProject, saveExecutableValidation, loadExecutableValidation, isExecutableValidationCurrent } from "../sdd/validation/executable.js"
import { getTelemetrySummary, recordFeedback, recordTelemetry } from "../sdd/monitoring/telemetry.js"
import { ValidationIndex } from "../sdd/validation/coverage-index.js"
import { detectAllSignals, formatDriftSignals } from "../sdd/drift/signals.js"
import { TransactionManager } from "../sdd/transactions/manager.js"
import {
  createGraphMutationTool,
  createGraphQueryTool,
  createTraverseTool,
  createPermissionsTool,
  createSnapshotTool,
  createSyncTool,
  createGraphAdminTool,
  createCodeQualityTool,
  createEnterpriseTool,
  createDriftWhitelistTool,
} from "./router/tools-composite.js"
import { createWorkflowTools } from "./workflows/tools-workflow.js"

// ── Validation Coverage Index (singleton per session) ──────────────
const validationIndex = new ValidationIndex()

function getRepo(directory: string): GraphRepository {
  return createRepository(directory)
}

function loadOrEmpty(directory: string): KnowledgeGraph {
  const repo = getRepo(directory)
  if (repo.isInitialized()) return repo.loadGraph()
  return createGraph("pending")
}

/**
 * Get cached tool response if available.
 * Returns null if not cached or cache is stale.
 */
function getCachedToolResponse(directory: string, toolName: string, args: Record<string, unknown>): string | null {
  try {
    const cacheMgr = getCacheManager(directory)
    const repo = getRepo(directory)
    if (!repo.isInitialized()) return null
    const graph = repo.loadGraph()
    return cacheMgr.getToolResponse(toolName, args, graph.metadata.updated_at)
  } catch {
    return null
  }
}

/**
 * Cache a tool response.
 */
function setCachedToolResponse(directory: string, toolName: string, args: Record<string, unknown>, response: string): void {
  try {
    const cacheMgr = getCacheManager(directory)
    const repo = getRepo(directory)
    if (!repo.isInitialized()) return
    const graph = repo.loadGraph()
    cacheMgr.setToolResponse(toolName, args, response, graph.metadata.updated_at)
  } catch {}
}

/**
 * Invalidate cache for specific node types after a mutation.
 */
export function invalidateCacheForMutation(directory: string, nodeTypes: string[], relTypes: string[] = []): void {
  try {
    const cacheMgr = getCacheManager(directory)
    cacheMgr.invalidatePartial(nodeTypes, relTypes)
  } catch {}
}

// Re-export for composite tools
export const invalidateCache = invalidateCacheForMutation


// ── Pagination helpers ───────────────────────────────────────────────
const DEFAULT_PAGE_SIZE = 30
const MAX_PAGE_SIZE = 100

function paginate<T>(items: T[], pageSize: number = DEFAULT_PAGE_SIZE): { page: T[]; total: number; hasMore: boolean } {
  const total = items.length
  const size = Math.min(pageSize, MAX_PAGE_SIZE)
  const hasMore = total > size
  return { page: items.slice(0, size), total, hasMore }
}

function truncateList(items: string[], maxItems: number = 20): string[] {
  if (items.length <= maxItems) return items
  return [...items.slice(0, maxItems), `... and ${items.length - maxItems} more`]
}

function formatTruncated(items: string[], label: string, maxItems: number = 20): string {
  if (items.length <= maxItems) return items.join("\n")
  return [...items.slice(0, maxItems), `\n... and ${items.length - maxItems} more ${label}`].join("\n")
}

export function createSddTools(): Record<string, ToolDefinition> {
  return {
    "sdd.initialize": tool({
      description:
        "Initialize the SDD Knowledge Graph for a project. Detects if SDD is already initialized. " +
        "Creates the .sdd/ directory structure and initial project node.",
      args: {
        project_name: tool.schema.string().describe("Name of the project"),
        description: tool.schema.string().optional().describe("Brief project description"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (repo.isInitialized()) {
          const graph = repo.loadGraph()
          return `SDD already initialized for project "${graph.project_id}". Graph has ${graph.nodes.length} nodes and ${graph.relationships.length} relationships.`
        }

        const projectId = args.project_name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
        repo.createProject(projectId, args.project_name, args.description)
        return `SDD initialized for project "${args.project_name}" (${projectId}).\n\nThe Knowledge Graph is ready. You can now use sdd.query_graph, sdd.add_node, and other SDD tools to build the specification.`
      },
    }),

    "sdd.inspect": tool({
      description:
        "Inspect the current state of the SDD Knowledge Graph. Shows stats, node counts by type, " +
        "and status distribution. Use this to understand the current project state.",
      args: {},
      async execute(_args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) {
          return "SDD is not initialized for this project. Use sdd.initialize first."
        }
        const indices = repo.getIndices()
        const stats = getGraphStatsIndexed(indices)

        // Sort by count descending, show top 15 types
        const sortedTypes = Object.entries(stats.by_type)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 15)

        const lines = [
          `## SDD Project: ${repo.loadGraph().project_id}`,
          `**Graph Version:** ${repo.loadGraph().version}`,
          `**SDD Version:** ${repo.loadGraph().metadata.sdd_version}`,
          `**Created:** ${repo.loadGraph().metadata.created_at}`,
          `**Updated:** ${repo.loadGraph().metadata.updated_at}`,
          "",
          "### Node Summary",
        ]
        for (const [type, count] of sortedTypes) {
          lines.push(`- ${type}: ${count}`)
        }
        if (Object.keys(stats.by_type).length > 15) {
          lines.push(`- ... and ${Object.keys(stats.by_type).length - 15} more types`)
        }
        lines.push(`\n**Total:** ${stats.total_nodes} nodes, ${stats.total_relationships} relationships`)

        return lines.join("\n")
      },
    }),

    "sdd.query_graph": tool({
      description:
        "Query the SDD Knowledge Graph. Search for nodes by text, type, or status. " +
        "Get details about specific nodes and their relationships.",
      args: {
        query: tool.schema.string().describe("Search query or node ID"),
        type: tool.schema.string().optional().describe("Filter by node type"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const indices = repo.getIndices()

        // Try exact ID match first — O(1) with index
        const exact = getNodeIndexed(indices, args.query)
        if (exact) {
          const outgoing = getOutgoingIndexed(indices, exact.id)
          const incoming = getIncomingIndexed(indices, exact.id)

          const lines = [
            `## Node: ${exact.id}`,
            `**Type:** ${exact.type}`,
            `**Name:** ${exact.name}`,
            `**Status:** ${exact.status}`,
            `**Version:** ${exact.version}`,
          ]
          if (exact.description) lines.push(`**Description:** ${exact.description}`)

          if (outgoing.length > 0) {
            lines.push("\n### Outgoing Relationships")
            for (const r of truncateList(outgoing.map(r => `- ${r.type} → ${r.to} (${indices.byId.get(r.to)?.name || "?"})`))) {
              lines.push(r)
            }
          }

          if (incoming.length > 0) {
            lines.push("\n### Incoming Relationships")
            for (const r of truncateList(incoming.map(r => `- ${r.type} ← ${r.from} (${indices.byId.get(r.from)?.name || "?"})`))) {
              lines.push(r)
            }
          }

          return lines.join("\n")
        }

        // Search by text — O(k) with inverted index instead of O(n×m)
        // For multi-word queries, use AND search (all tokens must match) for precision
        let results = searchNodesIndexed(indices, args.query, args.type as any)

        // If query has multiple words and OR search returned many results,
        // try AND search for more precise matches
        const queryWords = args.query.split(/\s+/).filter(w => w.length > 1)
        if (queryWords.length > 1 && results.length > 20) {
          const andResults = indices.searchIndex.searchAnd(new Set(queryWords.map(w => w.toLowerCase())))
          if (andResults.length > 0 && andResults.length < results.length) {
            results = andResults
              .map(id => indices.byId.get(id))
              .filter((n): n is AnyNode => n !== undefined && (!args.type || n.type === args.type))
          }
        }

        if (results.length === 0) return `No nodes found matching "${args.query}".`

        const lines = [`## Search Results for "${args.query}" (${results.length} found)\n`]
        for (const node of results.slice(0, 20)) {
          lines.push(`- **${node.id}** (${node.type}): ${node.name} [${node.status}]`)
        }
        if (results.length > 20) lines.push(`\n... and ${results.length - 20} more`)

        return lines.join("\n")
      },
    }),

    "sdd.add_node": tool({
      description:
        "Add a new node to the SDD Knowledge Graph. Supports all node types: " +
        "feature, requirement, business_rule, entity, architecture_component, task, test, etc.",
      args: {
        type: tool.schema.string().describe("Node type (feature, requirement, entity, etc.)"),
        name: tool.schema.string().describe("Node name"),
        description: tool.schema.string().optional().describe("Node description"),
        parent_id: tool.schema.string().optional().describe("Parent node ID to create containment relationship"),
        metadata_json: tool.schema.string().optional().describe("Additional metadata as JSON string"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized. Run sdd.initialize first."
        const graph = repo.loadGraph()

        // ── Pre-mutation validation: check for duplicate nodes ──
        const existingByName = graph.nodes.find(
          (n) => n.type === args.type && n.name.toLowerCase() === args.name.toLowerCase()
        )
        if (existingByName) {
          return [
            `⚠️ Node with type "${args.type}" and name "${args.name}" already exists:`,
            `- **ID:** ${existingByName.id}`,
            `- **Status:** ${existingByName.status}`,
            "",
            "Use `sdd.update_node` to modify the existing node, or choose a different name.",
          ].join("\n")
        }

        const nodeId = `${graph.project_id}-${args.type.toUpperCase().slice(0, 4)}-${String(graph.nodes.filter((n) => n.type === args.type).length + 1).padStart(3, "0")}`

        let metadata: Record<string, unknown> = {}
        if (args.metadata_json) {
          try {
            metadata = JSON.parse(args.metadata_json)
          } catch {
            return "Error: Invalid JSON in metadata_json"
          }
        }

        // Auto-populate required metadata fields based on node type
        const nodeType = args.type as NodeType
        if (nodeType === "business_rule" && !metadata.rule_text) {
          metadata.rule_text = args.description || args.name || ""
        }
        if (nodeType === "constraint" && !metadata.rule_text) {
          metadata.rule_text = args.description || args.name || ""
        }
        if (nodeType === "constraint" && !metadata.constraint_type) {
          metadata.constraint_type = "business"
        }
        if (nodeType === "entity" && !metadata.fields) {
          metadata.fields = []
        }
        if (nodeType === "endpoint" && !metadata.method) {
          metadata.method = "GET"
          metadata.path = "/"
        }
        if (nodeType === "database" && !metadata.engine) {
          metadata.engine = "postgresql"
        }
        if (nodeType === "architecture_component" && !metadata.layer) {
          metadata.layer = "backend"
        }

        const node: AnyNode = {
          id: nodeId,
          type: args.type as NodeType,
          name: args.name,
          description: args.description,
          status: "DRAFT",
          version: 1,
          metadata,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as AnyNode

        addNode(graph, node)

        if (args.parent_id) {
          try {
            addRelationship(graph, args.parent_id, nodeId, "contains")
          } catch (e) {
            // Parent might not exist, just log
          }
        }

        repo.saveGraph(graph)
        invalidateCacheForMutation(ctx.directory, [args.type], ["contains"])
        return `Node created: **${nodeId}** (${args.type}): ${args.name}`
      },
    }),

    "sdd.add_relationship": tool({
      description:
        "Add a relationship between two nodes in the SDD Knowledge Graph. Prevents cycles and self-loops.",
      args: {
        from_id: tool.schema.string().describe("Source node ID"),
        to_id: tool.schema.string().describe("Target node ID"),
        type: tool.schema.string().describe("Relationship type (contains, depends_on, implements, etc.)"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        // ── Pre-mutation: warn about orphan creation ──
        const fromNode = graph.nodes.find(n => n.id === args.from_id)
        const toNode = graph.nodes.find(n => n.id === args.to_id)
        if (fromNode && toNode) {
          const fromRels = graph.relationships.filter(r => r.from === args.from_id || r.to === args.from_id)
          const toRels = graph.relationships.filter(r => r.from === args.to_id || r.to === args.to_id)
          const warnings: string[] = []
          if (fromRels.length === 0) {
            warnings.push(`Source "${fromNode.name}" currently has no relationships — this will be its first connection.`)
          }
          if (toRels.length === 0) {
            warnings.push(`Target "${toNode.name}" currently has no relationships — this will be its first connection.`)
          }
        }

        try {
          addRelationship(graph, args.from_id, args.to_id, args.type as any)
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, [], [args.type])
          return `Relationship created: ${args.from_id} --[${args.type}]--> ${args.to_id}`
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

    "sdd.analyze_impact": tool({
      description:
        "Perform impact analysis for a change request. Traverses the Knowledge Graph " +
        "to find all affected nodes, features, entities, APIs, and tests.",
      args: {
        node_id: tool.schema.string().describe("Node ID to analyze impact for"),
        depth: tool.schema.number().optional().describe("Maximum traversal depth (default: 3)"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const indices = repo.getIndices()

        const node = getNodeIndexed(indices, args.node_id)
        if (!node) return `Node ${args.node_id} not found.`

        const depth = args.depth || 3
        const impact = computeImpact(graph, args.node_id, depth)
        const { computeImpactActions } = await import("../sdd/graph/traverse.js")
        const actions = computeImpactActions(graph, args.node_id, depth)

        const lines = [
          `## Impact Analysis: ${args.node_id}`,
          `**Node:** ${node.name} (${node.type})`,
          `**Depth:** ${depth}`,
          "",
          "### Direct Impact",
        ]

        if (impact.direct.length === 0) {
          lines.push("- No direct impact")
        } else {
          for (const n of impact.direct.slice(0, 15)) {
            lines.push(`- **${n.id}** (${n.type}): ${n.name}`)
          }
          if (impact.direct.length > 15) lines.push(`- ... and ${impact.direct.length - 15} more`)
        }

        lines.push("\n### Indirect Impact")
        if (impact.indirect.length === 0) {
          lines.push("- No indirect impact")
        } else {
          for (const n of impact.indirect.slice(0, 15)) {
            lines.push(`- **${n.id}** (${n.type}): ${n.name}`)
          }
          if (impact.indirect.length > 15) lines.push(`- ... and ${impact.indirect.length - 15} more`)
        }

        // Concrete actions
        if (actions.length > 0) {
          lines.push("\n### 🎯 Recommended Actions")
          const highPriority = actions.filter(a => a.priority === "high")
          const medPriority = actions.filter(a => a.priority === "medium")

          if (highPriority.length > 0) {
            lines.push("\n**High Priority:**")
            for (const a of highPriority.slice(0, 10)) {
              const files = a.target_files.length > 0 ? ` → ${a.target_files.join(", ")}` : ""
              lines.push(`- ${a.description}${files}`)
            }
          }
          if (medPriority.length > 0) {
            lines.push("\n**Medium Priority:**")
            for (const a of medPriority.slice(0, 10)) {
              lines.push(`- ${a.description}`)
            }
          }
        }

        return lines.join("\n")
      },
    }),

    "sdd.create_change": tool({
      description:
        "Create a Change node in the SDD Knowledge Graph. Represents a modification " +
        "to the system specification. Automatically performs impact analysis.",
      args: {
        title: tool.schema.string().describe("Change title"),
        reason: tool.schema.string().describe("Reason for the change"),
        affected_node_ids: tool.schema.string().optional().describe("Comma-separated list of affected node IDs"),
        new_nodes_json: tool.schema.string().optional().describe("JSON array of new nodes to create"),
        modified_nodes_json: tool.schema.string().optional().describe('JSON array of {id, updates} for modified nodes'),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        const affectedIds = args.affected_node_ids
          ? args.affected_node_ids.split(",").map((s) => s.trim())
          : []

        let newNodes: Partial<AnyNode>[] = []
        if (args.new_nodes_json) {
          try { newNodes = JSON.parse(args.new_nodes_json) } catch { return "Invalid JSON in new_nodes_json" }
        }

        let modifiedNodes: Array<{ id: string; updates: Partial<AnyNode> }> = []
        if (args.modified_nodes_json) {
          try { modifiedNodes = JSON.parse(args.modified_nodes_json) } catch { return "Invalid JSON in modified_nodes_json" }
        }

        const change = createChange(graph, {
          title: args.title,
          reason: args.reason,
          affected_node_ids: affectedIds,
          new_nodes: newNodes,
          modified_nodes: modifiedNodes,
          removed_node_ids: [],
          affected_files: [],
          affected_tests: [],
          implementation_tasks: [],
        })

        repo.saveGraph(graph)
        invalidateCacheForMutation(ctx.directory, ["change"], ["created_by"])

        // Create a transaction to track this change lifecycle
        const txManager = new TransactionManager(ctx.directory)
        const tx = txManager.createTransaction(change.id)

        const approvalLevel = classifyApprovalLevel(
          {
            title: args.title,
            reason: args.reason,
            affected_node_ids: affectedIds,
            new_nodes: newNodes,
            modified_nodes: modifiedNodes,
            removed_node_ids: [],
            affected_files: [],
            affected_tests: [],
            implementation_tasks: [],
          },
          graph,
        )

        return [
          `Change created: **${change.id}**: ${args.title}`,
          `**Approval Level:** ${approvalLevel}`,
          `**Status:** ${change.status}`,
          `**Transaction:** ${tx.id}`,
          "",
          approvalLevel === "APPROVAL"
            ? "⚠️ This change requires explicit approval before implementation."
            : approvalLevel === "REVIEW"
              ? "This change should be reviewed before implementation."
              : "This change can proceed automatically.",
        ].join("\n")
      },
    }),

    "sdd.discover": tool({
      description:
        "Analyze a user briefing and return structured discovery questions for missing information. " +
        "Use this when the user provides a project description or feature request that needs elaboration. " +
        "For each question returned, you MUST use the `question` tool to ask the user. " +
        "Pass each question's `question`, `header`, and `options` directly to the `question` tool. " +
        "If file references (@) are found, read those files first to extract additional context.",
      args: {
        briefing: tool.schema.string().describe("User briefing or feature description to analyze"),
      },
      async execute(args, _ctx) {
        const analysis = analyzeBriefing(args.briefing)
        let questions = generateDiscoveryQuestions(analysis)

        // Adaptive discovery: filter out questions already answered by graph
        try {
          const repo = getRepo(_ctx.directory)
          if (repo.isInitialized()) {
            const graph = repo.loadGraph()
            const { filterAlreadyAnswered, generateGapQuestions } = await import("../sdd/discovery/adaptive.js")
            const filteredQuestions = filterAlreadyAnswered(questions, graph)
            const gapQuestions = generateGapQuestions(graph)
            questions = [...filteredQuestions, ...gapQuestions]
          }
        } catch {}

        // Build the prompt for the agent
        const lines: string[] = []
        lines.push("## Briefing Analysis\n")
        lines.push(formatDiscoverySummary(analysis))

        if (analysis.file_references.length > 0) {
          lines.push("")
          lines.push("### Arquivos Referenciados")
          lines.push("Leia os seguintes arquivos para extrair contexto adicional:")
          for (const ref of analysis.file_references) {
            lines.push(`- \`${ref.path}\``)
          }
        }

        if (questions.length === 0) {
          lines.push("")
          lines.push("### Briefing suficiente para prosseguir.")
          lines.push("Não há perguntas pendentes. Você pode prosseguir com a especificação.")
        } else {
          lines.push("")
          lines.push("### Perguntas para o usuário")
          lines.push("")
          lines.push("Para CADA pergunta abaixo, use a ferramenta `question` com os dados exatos fornecidos.")
          lines.push("NÃO gere as perguntas como texto livre — use sempre a ferramenta `question`.")
          lines.push("")
          for (let i = 0; i < questions.length; i++) {
            const q = questions[i]
            lines.push(`#### ${i + 1}. ${q.header}`)
            lines.push(`- **question:** ${q.question}`)
            lines.push(`- **header:** ${q.header}`)
            lines.push(`- **options:**`)
            for (const opt of q.options) {
              lines.push(`  - label: "${opt.label}" — ${opt.description}`)
            }
            if (q.multiple) lines.push(`- **multiple:** true`)
            lines.push("")
          }

          lines.push("### Formato de chamada")
          lines.push("```")
          lines.push("question(questions=[{")
          lines.push('  question: "...",')
          lines.push('  header: "...",')
          lines.push("  options: [{ label: \"...\", description: \"...\" }]")
          lines.push("}])")
          lines.push("```")
        }

        lines.push("")
        lines.push("### Após coletar as respostas")
        lines.push("Chame `sdd.update_from_answers` com um JSON mapeando cada pergunta para a resposta do usuário.")
        lines.push(`\n\`\`\`json\n${JSON.stringify(Object.fromEntries(questions.map(q => [q.question, ""])), null, 2)}\n\`\`\``)

        return lines.join("\n")
      },
    }),

    "sdd.update_from_answers": tool({
      description:
        "Update the Knowledge Graph based on user answers to discovery questions. " +
        "This processes answers and creates/updates relevant nodes.",
      args: {
        answers_json: tool.schema
          .string()
          .describe('JSON object mapping questions to answers, e.g. {"How will users login?": "Google OAuth"}'),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        let answers: Record<string, string>
        try {
          answers = JSON.parse(args.answers_json)
        } catch {
          return "Invalid JSON in answers_json"
        }

        updateGraphFromAnswers(graph, answers)
        repo.saveGraph(graph)
        invalidateCacheForMutation(ctx.directory, ["feature", "requirement", "entity", "endpoint", "business_rule"], ["satisfies", "depends_on", "implements"])

        return `Graph updated with ${Object.keys(answers).length} answers. Use sdd.query_graph to inspect changes.`
      },
    }),

    "sdd.validate": tool({
      description:
        "Validate the SDD Knowledge Graph for structural integrity, semantic correctness, " +
        "and completeness. Uses smart validation to only check affected subsystems when possible.",
      args: {},
      async execute(_args, ctx) {
        const startedAt = Date.now()
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        // Check analysis cache
        const cacheMgr = getCacheManager(ctx.directory)
        const cached = cacheMgr.getAnalysisResult("validate", graph.metadata.updated_at ? new Date(graph.metadata.updated_at).getTime() : 0, graph.nodes.length)
        if (cached) {
          recordTelemetry(ctx.directory, {
            name: "graph_validation",
            duration_ms: Date.now() - startedAt,
            tokens_estimate: Math.ceil(String(cached).length / 4),
            cache_hit: true,
          })
          return cached as string
        }

        // Use smart validation with the coverage index for incremental validation
        const smartOptions: SmartValidationOptions = {
          coverageIndex: validationIndex,
          // A user-requested validation is always a full authoritative check.
          // Incremental validation is reserved for callers that provide a
          // concrete dirty-node set.
          validateAll: true,
          policy: loadSddConfig(ctx.directory).validation,
        }

        const smartResult = validateSmart(graph, new Set(), smartOptions)
        const formatted = formatValidationResult(smartResult)

        if (smartResult.valid) {
          markValidated()
        }

        // Cache the result
        cacheMgr.setAnalysisResult("validate", formatted, graph.metadata.updated_at ? new Date(graph.metadata.updated_at).getTime() : 0, graph.nodes.length)
        recordTelemetry(ctx.directory, {
          name: "graph_validation",
          duration_ms: Date.now() - startedAt,
          tokens_estimate: Math.ceil(formatted.length / 4),
          cache_hit: false,
          metadata: { valid: smartResult.valid, errors: smartResult.errors.length, warnings: smartResult.warnings.length },
        })

        return formatted
      },
    }),

    "sdd.detect_drift": tool({
      description:
        "Detect SDD drift - find discrepancies between the specification and the codebase.",
      args: {},
      async execute(_args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        // Check analysis cache
        const cacheMgr = getCacheManager(ctx.directory)
        const cached = cacheMgr.getAnalysisResult("drift", graph.metadata.updated_at ? new Date(graph.metadata.updated_at).getTime() : 0, graph.nodes.length)
        if (cached) return cached as string

        const result = detectDrift(graph, ctx.directory)
        const formatted = formatDriftReport(result)

        // Cache the result
        cacheMgr.setAnalysisResult("drift", formatted, graph.metadata.updated_at ? new Date(graph.metadata.updated_at).getTime() : 0, graph.nodes.length)

        return formatted
      },
    }),

    "sdd.check_migrations": tool({
      description:
        "Check if SDD data needs migration. Analyzes graph.yaml vs graph.db sync, " +
        "missing fields, structural issues, and drift whitelist integrity.",
      args: {
        auto_fix: tool.schema.boolean().optional().describe("If true, automatically run pending migrations (default: false)").default(false),
      },
      async execute(args, ctx) {
        const { hasPendingMigrations, runMigrations, getMigrations } = await import("../sdd/migrations/index.js")
        const { existsSync, statSync } = await import("fs")
        const { join } = await import("path")

        const lines: string[] = []
        const issues: string[] = []
        
        // 1. Check pending migrations
        const pending = hasPendingMigrations(ctx.directory)
        const allMigrations = getMigrations()
        lines.push(`## Migration Status`)
        lines.push(`- Pending migrations: ${pending ? "YES" : "No"}`)
        lines.push(`- Total registered: ${allMigrations.length}`)
        
        // 2. Check graph.yaml vs graph.db sync
        const yamlPath = join(ctx.directory, ".sdd", "graph.yaml")
        const dbPath = join(ctx.directory, ".sdd", "graph.db")
        
        if (existsSync(yamlPath) && existsSync(dbPath)) {
          const yamlStat = statSync(yamlPath)
          const dbStat = statSync(dbPath)
          
          if (dbStat.mtimeMs < yamlStat.mtimeMs) {
            issues.push("graph.db is older than graph.yaml — needs sync")
            lines.push(`- ⚠️ graph.db stale (YAML is newer)`)
          } else {
            lines.push(`- ✅ graph.db is up to date`)
          }
        } else if (existsSync(yamlPath)) {
          lines.push(`- ℹ️ Only graph.yaml exists (no SQLite)`)
        }
        
        // 3. Check for missing priority fields
        try {
          const repo = createRepository(ctx.directory)
          if (repo.isInitialized()) {
            const graph = repo.loadGraph()
            let missingPriority = 0
            let missingFields = 0
            
            for (const node of graph.nodes) {
              const meta = node.metadata as Record<string, unknown>
              if (!meta.priority && (node.type === "test" || node.type === "requirement")) {
                missingPriority++
              }
              if (!node.type || !node.name || !node.status) {
                missingFields++
              }
            }
            
            if (missingPriority > 0) {
              issues.push(`${missingPriority} nodes missing priority field`)
              lines.push(`- ⚠️ ${missingPriority} nodes without priority`)
            } else {
              lines.push(`- ✅ All nodes have priority`)
            }
            
            if (missingFields > 0) {
              issues.push(`${missingFields} nodes with missing required fields`)
              lines.push(`- ⚠️ ${missingFields} nodes with missing fields`)
            } else {
              lines.push(`- ✅ All nodes have required fields`)
            }
          }
        } catch {
          lines.push(`- ℹ️ Could not analyze graph structure`)
        }
        
        // 4. Check drift whitelist
        const whitelistPath = join(ctx.directory, ".sdd", "drift-whitelist.json")
        if (existsSync(whitelistPath)) {
          try {
            const whitelist = JSON.parse(require("fs").readFileSync(whitelistPath, "utf-8"))
            if (!whitelist.entries || !Array.isArray(whitelist.entries)) {
              issues.push("drift-whitelist.json is corrupted")
              lines.push(`- ⚠️ Whitelist corrupted`)
            } else {
              lines.push(`- ✅ Whitelist valid (${whitelist.entries.length} entries)`)
            }
          } catch {
            issues.push("drift-whitelist.json parse error")
            lines.push(`- ⚠️ Whitelist parse error`)
          }
        }
        
        lines.push("")
        
        // Summary
        if (issues.length === 0) {
          lines.push("✅ **No migrations needed.**")
        } else {
          lines.push(`⚠️ **${issues.length} issue(s) detected:**`)
          for (const issue of issues) {
            lines.push(`- ${issue}`)
          }
          lines.push("")
          
          if (args.auto_fix) {
            lines.push("🔄 Running migrations...")
            const results = runMigrations(ctx.directory)
            const successful = results.filter(r => r.success)
            lines.push(`✅ ${successful.length} migration(s) completed.`)
          } else {
            lines.push("Run with `auto_fix: true` to apply fixes, or call `sdd.run_migrations` to execute.")
          }
        }
        
        return lines.join("\n")
      },
    }),

    "sdd.run_migrations": tool({
      description:
        "Execute all pending SDD migrations to fix data issues.",
      args: {},
      async execute(_args, ctx) {
        const { runMigrations, hasPendingMigrations } = await import("../sdd/migrations/index.js")
        
        if (!hasPendingMigrations(ctx.directory)) {
          return "✅ No pending migrations."
        }
        
        const results = runMigrations(ctx.directory)
        const lines: string[] = []
        
        for (const result of results) {
          const icon = result.success ? "✅" : "❌"
          lines.push(`${icon} ${result.message}`)
          if (result.files_modified?.length) {
            lines.push(`   Modified: ${result.files_modified.join(", ")}`)
          }
        }
        
        return lines.join("\n") || "✅ All migrations completed."
      },
    }),

    "sdd.get_context": tool({
      description:
        "Build a context pack for a specific node. Returns all relevant nodes, " +
        "relationships, and files for focused work.",
      args: {
        node_id: tool.schema.string().describe("Node ID to build context for"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const indices = repo.getIndices()

        // Build focused subgraph: target node + depth-1 neighbors
        const target = indices.byId.get(args.node_id)
        if (!target) return `Node ${args.node_id} not found.`

        // Use getNeighbors for richer neighbor data with direction info
        const neighbors = getNeighbors(graph, args.node_id, "both")
        const neighborIds = new Set(neighbors.map(n => n.id))
        const subgraphNodeIds = new Set([args.node_id, ...neighborIds])

        const subgraphNodes = [...subgraphNodeIds]
          .map(id => indices.byId.get(id))
          .filter((n): n is AnyNode => n !== undefined)

        const subgraphRels = graph.relationships.filter(
          r => subgraphNodeIds.has(r.from) && subgraphNodeIds.has(r.to)
        )

        // Also include cross-boundary relationships for context
        const boundaryRels = graph.relationships.filter(
          r => (subgraphNodeIds.has(r.from) && !subgraphNodeIds.has(r.to)) ||
                (!subgraphNodeIds.has(r.from) && subgraphNodeIds.has(r.to))
        ).slice(0, 10)

        const lines = [
          `## Context Pack: ${target.id}`,
          `**Type:** ${target.type}`,
          `**Name:** ${target.name}`,
          `**Status:** ${target.status}`,
        ]
        if (target.description) lines.push(`**Description:** ${target.description}`)

        if (target.metadata && Object.keys(target.metadata).length > 0) {
          const metaStr = JSON.stringify(target.metadata, null, 2)
          if (metaStr.length < 500) {
            lines.push(`\n### Metadata\n\`\`\`\n${metaStr}\n\`\`\``)
          } else {
            lines.push(`\n### Metadata (truncated)\n\`\`\`\n${metaStr.slice(0, 500)}...\n\`\`\``)
          }
        }

        if (subgraphRels.length > 0) {
          lines.push(`\n### Internal Relationships (${subgraphRels.length})`)
          for (const r of subgraphRels.slice(0, 20)) {
            const from = indices.byId.get(r.from)
            const to = indices.byId.get(r.to)
            lines.push(`- ${from?.name || r.from} →[${r.type}]→ ${to?.name || r.to}`)
          }
          if (subgraphRels.length > 20) lines.push(`- ... and ${subgraphRels.length - 20} more`)
        }

        if (boundaryRels.length > 0) {
          lines.push(`\n### External Connections (${boundaryRels.length})`)
          for (const r of boundaryRels) {
            const from = indices.byId.get(r.from)
            const to = indices.byId.get(r.to)
            const isOut = subgraphNodeIds.has(r.from)
            if (isOut) {
              lines.push(`- ${from?.name || r.from} →[${r.type}]→ ${to?.name || r.to}`)
            } else {
              lines.push(`- ${from?.name || r.from} →[${r.type}]← ${to?.name || r.to}`)
            }
          }
        }

        // Add the standard context pack
        lines.push("")
        lines.push(buildSddContextPack(graph, args.node_id))

        return lines.join("\n")
      },
    }),

    "sdd.approve_change": tool({
      description: "Approve a pending change in the SDD graph.",
      args: {
        change_id: tool.schema.string().describe("Change node ID (e.g., CHG-001)"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        // ENFORCEMENT: prevent self-approval
        const changeNode = graph.nodes.find(
          (n) => n.type === "change" && n.id === args.change_id,
        )
        if (changeNode) {
          const creator = changeNode.created_by || (changeNode.metadata as Record<string, unknown>)?.created_by as string
          const approver = process.env.USER || process.env.USERNAME || "current"
          if (creator && creator === approver) {
            addAuditEntry(
              ctx.directory,
              approver,
              "sdd.approve_change",
              args.change_id,
              "denied",
              "Self-approval prevented",
            )
            return [
              `## SDD BLOCKED: Self-approval prevented`,
              "",
              `Change ${args.change_id} was created by **${creator}**.`,
              `You cannot approve your own Change.`,
              "",
              "A different user or an admin must approve this Change.",
              "Use `sdd.check_change_approval` to verify approval requirements.",
            ].join("\n")
          }
        }

        try {
          approveChange(graph, args.change_id)
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change"], ["approved_by"])
          markApproved()

          // Advance transaction to SPEC_UPDATED
          try {
            const txManager = new TransactionManager(ctx.directory)
            const txs = txManager.getTransactionsForChange(args.change_id)
            if (txs.length > 0) {
              txManager.advanceStatus(txs[0].id, "SPEC_UPDATED")
            }
          } catch {}

          return `Change ${args.change_id} approved.`
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

    "sdd.complete_change": tool({
      description: "Mark a change as completed in the SDD graph. Checks pending promises on affected nodes before completing.",
      args: {
        change_id: tool.schema.string().describe("Change node ID"),
        force: tool.schema.boolean().optional().describe("Force completion even with pending promises"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        try {
          if (!args.force) {
            const execution = loadExecutableValidation(ctx.directory, args.change_id)
            if (!execution?.verified || !execution.passed || !isExecutableValidationCurrent(ctx.directory, execution)) {
              return `## Change ${args.change_id} Completion BLOCKED\n\nRun sdd.verify_implementation successfully after the last code change. Use force=true only for an explicit override.`
            }
          }
          const { completeChangeWithPromiseCheck } = await import("../sdd/changes/manager.js")
          const result = completeChangeWithPromiseCheck(graph, args.change_id, args.force)

          if (!result.completed) {
            const lines = [
              `## Change ${args.change_id} Completion BLOCKED`,
              "",
              `**Reason:** ${result.result.reason}`,
              "",
              "### Pending Promises",
            ]
            for (const p of result.result.pending_promises) {
              lines.push(`- **${p.id}** (${p.source_node_id}): ${p.description}`)
            }
            lines.push("")
            lines.push("Use `sdd.promises` to verify these promises before completing the change.")
            lines.push("Or use `force=true` to override (not recommended).")
            repo.saveGraph(graph)
            invalidateCacheForMutation(ctx.directory, ["change"], [])
            return lines.join("\n")
          }

          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change"], ["completed"])
          markCompleted()

          // Advance transaction to COMPLETED
          try {
            const txManager = new TransactionManager(ctx.directory)
            const txs = txManager.getTransactionsForChange(args.change_id)
            if (txs.length > 0) {
              txManager.advanceStatus(txs[0].id, "COMPLETED")
            }
          } catch {}

          return `Change ${args.change_id} completed.`
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

    "sdd.verify_implementation": tool({
      description: "Run declared formatter, lint, typecheck, tests and git diff checks after implementation. A successful report is required before completing a Change.",
      args: {
        change_id: tool.schema.string().describe("Approved Change node ID being verified"),
      },
      async execute(args, ctx) {
        const startedAt = Date.now()
        const result = validateExecutableProject(ctx.directory)
        saveExecutableValidation(ctx.directory, args.change_id, result)
        recordTelemetry(ctx.directory, {
          name: "executable_verification",
          duration_ms: Date.now() - startedAt,
          metadata: { change_id: args.change_id, passed: result.passed, verified: result.verified },
        })
        const lines = [`## Executable Verification: ${result.passed && result.verified ? "PASSED" : "BLOCKED"}`]
        for (const check of result.checks) lines.push(`- ${check.status.toUpperCase()}: ${check.name}${check.output ? ` — ${check.output.slice(0, 300)}` : ""}`)
        if (!result.verified) lines.push("No executable verification script was available; configure project scripts before completing the Change.")
        return lines.join("\n")
      },
    }),

    "sdd.record_feedback": tool({
      description: "Record a local human correction for an extracted fact, classification, or test-requirement link.",
      args: {
        category: tool.schema.string().describe("discovery, classification, coverage, drift, or generation"),
        expected: tool.schema.string().describe("Correct result"),
        actual: tool.schema.string().describe("Observed incorrect result"),
        node_id: tool.schema.string().optional().describe("Related graph node"),
      },
      async execute(args, ctx) {
        recordFeedback(ctx.directory, { ...args })
        return "Feedback recorded locally. Future evaluation reports can use this correction category."
      },
    }),

    "sdd.telemetry": tool({
      description: "Show local performance, estimated token, and cache telemetry. No data is sent externally.",
      args: {},
      async execute(_args, ctx) {
        const summary = getTelemetrySummary(ctx.directory)
        return [
          "## Local Telemetry",
          `- Events: ${summary.events}`,
          `- Total duration: ${summary.total_duration_ms}ms`,
          `- Estimated context tokens: ${summary.estimated_tokens}`,
          `- Cache hit rate: ${(summary.cache_hit_rate * 100).toFixed(1)}%`,
        ].join("\n")
      },
    }),

    "sdd.fail_change": tool({
      description: "Mark a change as FAILED with a reason. Use when a change cannot be completed.",
      args: {
        change_id: tool.schema.string().describe("Change node ID"),
        reason: tool.schema.string().describe("Reason for failure"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        try {
          failChange(graph, args.change_id, args.reason)
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change"], [])
          addAuditEntry(ctx.directory, process.env.USER || "system", "sdd.fail_change", args.change_id, "denied", args.reason)
          return `Change ${args.change_id} marked as FAILED.\nReason: ${args.reason}`
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

    "sdd.change_history": tool({
      description: "View the full history of all changes in the SDD graph, ordered by creation date.",
      args: {
        limit: tool.schema.number().optional().describe("Max changes to show (default: 20)"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const history = getChangeHistory(graph)

        if (history.length === 0) return "No changes found in history."

        const limit = args.limit || 20
        const lines = [`## Change History (${history.length} total)\n`]
        for (const change of history.slice(-limit).reverse()) {
          const statusIcon = change.status === "COMPLETED" ? "✅" : change.status === "FAILED" ? "❌" : change.status === "APPROVED" ? "🟢" : "⏳"
          lines.push(`- ${statusIcon} **${change.id}:** ${change.name} [${change.status}]`)
          lines.push(`  Approval: ${change.metadata.approval_level} | Created: ${change.created_at}`)
          if (change.metadata.affected_nodes.length > 0) {
            lines.push(`  Affected: ${change.metadata.affected_nodes.length} node(s)`)
          }
        }
        if (history.length > limit) {
          lines.push(`\n... and ${history.length - limit} older changes`)
        }
        return lines.join("\n")
      },
    }),

    "sdd.impact_report": tool({
      description: "Generate a detailed impact report for a specific change, showing affected nodes, files, and new/modified/removed items.",
      args: {
        change_id: tool.schema.string().describe("Change node ID"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        return formatImpactReport(graph, args.change_id)
      },
    }),

    "sdd.pending_changes": tool({
      description: "List all pending changes in the SDD graph. Detects stale changes older than 7 days.",
      args: {},
      async execute(_args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const pending = getPendingChanges(graph)

        if (pending.length === 0) return "No pending changes."

        const lines = [`## Pending Changes (${pending.length})\n`]
        const changeLines = pending.map(change =>
          `- **${change.id}:** ${change.name} [${change.status}] (approval: ${change.metadata.approval_level})`
        )
        lines.push(...truncateList(changeLines, 15))

        // Detect stale changes
        const now = Date.now()
        const staleThreshold = 7 * 24 * 60 * 60 * 1000
        const staleChanges = pending.filter(
          (c) => now - new Date(c.created_at).getTime() > staleThreshold
        )

        if (staleChanges.length > 0) {
          lines.push("")
          lines.push(`### ⚠️ Stale Changes (${staleChanges.length})`)
          lines.push("These changes have been pending for over 7 days:")
          for (const c of staleChanges.slice(0, 5)) {
            const age = Math.floor((now - new Date(c.created_at).getTime()) / (24 * 60 * 60 * 1000))
            lines.push(`- **${c.id}**: ${c.name} (${age} days old)`) 
          }
          lines.push("")
          lines.push("Consider completing or archiving stale changes to keep the graph clean.")
        }

        return lines.join("\n")
      },
    }),

    "sdd.list_nodes": tool({
      description: "List all nodes of a specific type in the SDD graph.",
      args: {
        type: tool.schema.string().describe("Node type to list"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const indices = repo.getIndices()
        const nodes = getNodesByTypeIndexed(indices, args.type as NodeType)

        if (nodes.length === 0) return `No nodes of type "${args.type}" found.`

        const { page, total, hasMore } = paginate(nodes)
        const lines = [`## ${args.type} Nodes (${total}${hasMore ? ", showing " + page.length : ""})\n`]
        for (const node of page) {
          lines.push(`- **${node.id}:** ${node.name} [${node.status}]`)
        }
        if (hasMore) lines.push(`\nUse pagination or filter to see more.`)
        return lines.join("\n")
      },
    }),

    "sdd.find_path": tool({
      description: "Find the relationship path between two nodes in the graph.",
      args: {
        from_id: tool.schema.string().describe("Source node ID"),
        to_id: tool.schema.string().describe("Target node ID"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const path = findPath(graph, args.from_id, args.to_id)

        if (!path) return `No path found between ${args.from_id} and ${args.to_id}.`

        const lines = [`## Path: ${args.from_id} → ${args.to_id}\n`]
        for (let i = 0; i < path.length; i++) {
          const node = path[i]
          const arrow = i < path.length - 1 ? " →" : ""
          lines.push(`${i + 1}. **${node.id}** (${node.type}): ${node.name}${arrow}`)
        }
        return lines.join("\n")
      },
    }),

    "sdd.generate_code": tool({
      description:
        "Generate project code from the SDD Knowledge Graph. Creates actual project files " +
        "(backend routes, models, services, controllers, frontend components, database schema, tests) " +
        "based on the specification in the graph. " +
        "If the detected tech stack is not in the built-in template set, returns a specification prompt " +
        "that you should use to generate the code yourself using your knowledge of the specified technologies.",
      args: {
        target_dir: tool.schema.string().optional().describe("Target directory for generated code (defaults to project dir)"),
        force: tool.schema.boolean().optional().describe("Force regeneration even if validation fails"),
        overwrite_existing: tool.schema.boolean().optional().describe("Replace conflicting generated files after review; creates backups"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized. Run sdd.initialize first."
        const graph = repo.loadGraph()

        // ENFORCEMENT: require approved Change before generating code
        const { getWorkflowState } = await import("../sdd/enforcement/workflow-tracker.js")
        const wfState = getWorkflowState()
        if (!wfState.enforced) {
          return [
            "## SDD BLOCKED: No workflow active",
            "",
            "Cannot generate code without an active SDD workflow.",
            "",
            "1. Run sdd.enforce to classify the change and create a Change node",
            "2. Update the specification",
            "3. Run sdd.approve_change",
            "4. THEN run sdd.generate_code",
          ].join("\n")
        }

        // ENFORCEMENT: verify approved Change exists in graph
        const approvedChanges = graph.nodes.filter(
          (n) => n.type === "change" && n.status === "APPROVED",
        )
        if (approvedChanges.length === 0 && !args.force) {
          return [
            "## SDD BLOCKED: No approved Change node",
            "",
            "Cannot generate code without an approved Change node in the graph.",
            "",
            "1. Run sdd.enforce to create a Change node",
            "2. Run sdd.approve_change to approve it",
            "3. THEN run sdd.generate_code",
            "",
            "Or use force=true to override (not recommended).",
          ].join("\n")
        }

        // Validate before generating
        const validation = validateGraph(graph)
        if (!validation.valid && !args.force) {
          return [
            "Cannot generate code: SDD validation failed.",
            "",
            formatValidationResult(validation),
            "",
            "Fix the specification first, or use force=true to override.",
          ].join("\n")
        }

        // Detect stack
        const stack = detectTechStack(graph)
        const stackDesc = [stack.frontend, stack.backend, stack.database].filter(Boolean).join(" + ") || "unknown"

        // Generate
        const targetDir = args.target_dir || ctx.directory
        const plan = generateProject(graph, stack)

        // If no files were generated (spec prompt mode), tell the agent to generate code itself
        if (plan.files.length === 0) {
          return [
            `## Code Generation: Custom Stack`,
            `**Detected stack:** ${stackDesc}`,
            `**Built-in templates:** Not available for this stack`,
            "",
            "### Specification",
            plan.summary,
            "",
            "### Action Required",
            "The detected tech stack does not have built-in code templates.",
            "Use the specification above to generate the project code using your knowledge.",
            "Create the files directly — follow the conventions of the specified technologies.",
          ].join("\n")
        }

        // Write files (template mode)
        const result = writeGeneratedFiles(targetDir, plan, {
          overwrite: args.overwrite_existing === true,
          backup: true,
        })

        const lines = [
          plan.summary,
          "",
          `### Write Results`,
          `- Files written: ${result.written}`,
          `- Files created: ${result.created}`,
          `- Unchanged files: ${result.unchanged}`,
        ]

        if (result.conflicts.length > 0) {
          lines.push(`- Conflicts (not overwritten): ${result.conflicts.length}`)
          for (const conflict of result.conflicts) lines.push(`  - ${conflict}`)
          lines.push("Review the diff and call again with overwrite_existing=true only for an approved replacement.")
        }
        if (result.backups.length > 0) lines.push(`- Backups created: ${result.backups.length}`)

        if (result.errors.length > 0) {
          lines.push(`- Errors: ${result.errors.length}`)
          for (const err of result.errors) {
            lines.push(`  - ${err}`)
          }
        }

        // Update graph with file nodes
        const now = new Date().toISOString()
        for (const file of plan.files) {
          const fileId = `${graph.project_id}-FILE-${file.path.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 30)}`
          try {
            addNode(graph, {
              id: fileId,
              type: "file",
              name: file.path,
              description: file.description,
              status: "IMPLEMENTED",
              version: 1,
              metadata: { path: file.path, language: "typescript" },
              created_at: now,
              updated_at: now,
            })
          } catch {
            // Node might already exist
          }
        }

        repo.saveGraph(graph)
        invalidateCacheForMutation(ctx.directory, ["file"], ["implements"])

        return lines.join("\n")
      },
    }),

    "sdd.enforce": tool({
      description:
        "Enforce SDD-first workflow. Classifies a user request, creates a Change node, " +
        "validates the SDD, and determines if implementation can proceed. " +
        "MUST be called before any code modification.",
      args: {
        request_description: tool.schema.string().describe("What the user wants to do"),
        affected_entities: tool.schema.string().optional().describe("Comma-separated entity names affected"),
        affected_files: tool.schema.string().optional().describe("Comma-separated file paths affected"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) {
          return [
            "## SDD Enforcement: BLOCKED",
            "",
            "SDD is not initialized for this project.",
            "You MUST run sdd.initialize first before making any changes.",
            "",
            "Ask the user: 'Should I initialize the SDD for this project?'",
          ].join("\n")
        }

        const graph = repo.loadGraph()
        const request = classifyChangeRequest(args.request_description)

        const affectedEntities = args.affected_entities
          ? args.affected_entities.split(",").map((s) => s.trim())
          : []

        const affectedFiles = args.affected_files
          ? args.affected_files.split(",").map((s) => s.trim())
          : []

        // Smart batch: for AUTO-level changes, execute full cycle in one call
        const { enforceSmartBatch } = await import("../sdd/enforcement/interceptor.js")
        const result = enforceSmartBatch(graph, request, affectedEntities, affectedFiles)

        repo.saveGraph(graph)
        invalidateCacheForMutation(ctx.directory, ["change"], ["created_by"])

        if (result.auto_completed) {
          if (result.change_id) markEnforced(result.change_id)
          return [
            `## SDD Enforcement: AUTO-COMPLETED ✅`,
            `**Request Type:** ${request.type}`,
            `**Description:** ${request.description}`,
            `**Change ID:** ${result.change_id}`,
            `**Validation:** PASSED`,
            ``,
            `This is a low-risk change. The SDD cycle has been completed automatically.`,
            `You may proceed with implementation.`,
          ].join("\n")
        }

        if (result.allowed && result.change_id) {
          markEnforced(result.change_id)
        }

        return buildEnforcementPrompt(request, result)
      },
    }),

    "sdd.enforce_rules": tool({
      description:
        "Returns the SDD enforcement rules. Use this to understand the mandatory workflow.",
      args: {},
      async execute() {
        return getSddEnforcementRules()
      },
    }),

    "sdd.full_cycle": tool({
      description:
        "Execute a complete SDD change cycle: analyze request → update spec → validate → " +
        "generate/implement code → validate implementation → sync graph. " +
        "This is the main tool for processing user change requests.",
      args: {
        request: tool.schema.string().describe("What the user wants to change"),
        auto_approve: tool.schema.boolean().optional().describe("Skip approval for non-architecture changes"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) {
          return "SDD not initialized. Run sdd.initialize first."
        }

        const graph = repo.loadGraph()
        const lines: string[] = []
        const request = classifyChangeRequest(args.request)

        lines.push(`## Full Cycle: ${request.type}`)
        lines.push(`**Request:** ${args.request}\n`)

        // Step 1: Enforce SDD-first
        lines.push("### Step 1: SDD Enforcement")
        const enforcement = enforceSddFirst(graph, request)

        if (!enforcement.allowed) {
          lines.push(`❌ **BLOCKED:** ${enforcement.reason}`)
          if (enforcement.blocking_reasons) {
            for (const r of enforcement.blocking_reasons) lines.push(`- ${r}`)
          }
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change"], [])
          return lines.join("\n")
        }

        lines.push(`✅ **APPROVED:** Change ${enforcement.change_id}`)
        lines.push(enforcement.impact_summary || "")

        // Step 2: Validate SDD
        lines.push("\n### Step 2: SDD Validation")
        const validation = validateGraph(graph)
        if (validation.valid) {
          lines.push("✅ SDD validation passed")
        } else {
          lines.push(`❌ SDD validation failed: ${validation.errors.length} errors`)
          for (const e of validation.errors) lines.push(`- [${e.code}] ${e.message}`)
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change"], [])
          return lines.join("\n")
        }

        // Step 3: Generate code plan
        lines.push("\n### Step 3: Code Generation Plan")
        const plan = generateProject(graph)
        lines.push(`Generated plan: ${plan.files.length} files to create/update`)

        // Step 4: Write code
        lines.push("\n### Step 4: Implementation")
        const writeResult = writeGeneratedFiles(ctx.directory, plan)
        lines.push(`Files written: ${writeResult.written}`)
        if (writeResult.errors.length > 0) {
          lines.push(`Errors: ${writeResult.errors.length}`)
          for (const err of writeResult.errors) lines.push(`  - ${err}`)
        }

        // Step 5: Validate implementation
        lines.push("\nStep 5: Post-Implementation Validation")
        const postValidation = validateGraph(graph)
        if (postValidation.valid) {
          lines.push("✅ Post-implementation SDD validation passed")
        } else {
          lines.push(`⚠️ Post-implementation warnings: ${postValidation.warnings.length}`)
        }

        // Step 5b: execute the project's declared verification pipeline.
        lines.push("\n### Step 5b: Executable Verification")
        const execution = validateExecutableProject(ctx.directory)
        if (enforcement.change_id) saveExecutableValidation(ctx.directory, enforcement.change_id, execution)
        lines.push(execution.passed && execution.verified
          ? "✅ Formatter/lint/typecheck/tests passed"
          : "❌ Executable verification is incomplete or failed; Change will not be completed")

        // Step 6: Complete change (with promise check)
        if (enforcement.change_id) {
          lines.push("\n### Step 6: Change Completion")
          try {
            if (!execution.passed || !execution.verified) {
              lines.push("⚠️ Completion blocked: executable verification did not pass")
              repo.saveGraph(graph)
              return lines.join("\n")
            }
            const { completeChangeWithPromiseCheck } = await import("../sdd/changes/manager.js")
            const completionResult = completeChangeWithPromiseCheck(graph, enforcement.change_id)
            if (completionResult.completed) {
              lines.push(`✅ Change ${enforcement.change_id} completed`)
            } else {
              lines.push(`⚠️ Change ${enforcement.change_id} completion BLOCKED`)
              lines.push(`**Reason:** ${completionResult.result.reason}`)
              if (completionResult.result.pending_promises.length > 0) {
                lines.push("")
                lines.push("### Pending Promises")
                for (const p of completionResult.result.pending_promises) {
                  lines.push(`- **${p.id}**: ${p.description}`)
                }
              }
            }
          } catch (e) {
            lines.push(`⚠️ Could not complete change: ${e}`)
          }
        }

        repo.saveGraph(graph)
        invalidateCacheForMutation(ctx.directory, ["change"], [])

        lines.push("\n### Summary")
        lines.push(`- Change: ${enforcement.change_id}`)
        lines.push(`- Files generated: ${writeResult.written}`)
        lines.push(`- SDD valid: ${postValidation.valid}`)
        lines.push(`- Status: COMPLETED`)

        return lines.join("\n")
      },
    }),

    "sdd.toggle": tool({
      description:
        "Enable or disable SDD enforcement. When disabled, code changes can be made freely " +
        "without going through the SDD workflow. When enabled, all changes must follow the " +
        "SDD-first process (spec before code).",
      args: {
        enabled: tool.schema.boolean().optional().describe("true to enable, false to disable. Omit to toggle."),
      },
      async execute(args, ctx) {
        const current = isSddEnabled(ctx.directory)
        const newState = args.enabled !== undefined ? args.enabled : !current
        const state = setToggleState(ctx.directory, newState)

        if (!state.enabled) {
          resetWorkflowState()
        }

        const status = state.enabled ? "🟢 ENABLED" : "🔴 DISABLED"
        const lines = [
          `## SDD Enforcement: ${status}`,
          "",
          state.enabled
            ? "All code changes must now go through the SDD workflow (spec before code)."
            : "SDD enforcement is off. You can make code changes freely.",
          "",
          `Changed at: ${state.changed_at}`,
          "",
          "Commands: `/sdd on`, `/sdd off`, `/sdd status`",
        ]

        return lines.join("\n")
      },
    }),

    "sdd.constitution": tool({
      description:
        "View or update the project constitution. The constitution defines high-level principles " +
        "that govern ALL specifications. Every principle is checked during validation.",
      args: {
        action: tool.schema.string().describe("Action: 'view', 'add', 'remove'"),
        rule: tool.schema.string().optional().describe("Principle rule text (for add). E.g., 'Never use var, always use const'"),
        severity: tool.schema.string().optional().describe("Severity: 'must', 'should', or 'may' (default: must)"),
        scope: tool.schema.string().optional().describe("Scope regex to limit which nodes are checked (optional)"),
        principle_id: tool.schema.string().optional().describe("Principle ID to remove (for remove)"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized. Run sdd.initialize first."
        const graph = repo.loadGraph()

        if (args.action === "view") {
          const result = validateAgainstConstitution(graph)
          return formatConstitutionResult(result)
        }

        if (args.action === "add") {
          if (!args.rule) return "Error: 'rule' is required for add action."

          const existing = graph.nodes.find((n) => n.type === "constitution") as ConstitutionNode | undefined
          const now = new Date().toISOString()

          if (existing) {
            const principles = existing.metadata.principles || []
            const newId = `P-${String(principles.length + 1).padStart(3, "0")}`
            principles.push({
              id: newId,
              rule: args.rule,
              severity: (args.severity as "must" | "should" | "may") || "must",
              scope: args.scope,
            })
            existing.metadata.principles = principles
            existing.updated_at = now
          } else {
            const nodeId = `${graph.project_id}-CONSTITUTION`
            addNode(graph, {
              id: nodeId,
              type: "constitution",
              name: "Project Constitution",
              description: "High-level principles governing the project specification",
              status: "APPROVED",
              version: 1,
              metadata: {
                principles: [{
                  id: "P-001",
                  rule: args.rule,
                  severity: (args.severity as "must" | "should" | "may") || "must",
                  scope: args.scope,
                }],
              },
              created_at: now,
              updated_at: now,
            } as ConstitutionNode)
          }

          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["constitution"], ["validates"])
          return `Principle added: "${args.rule}" [${args.severity || "must"}]`
        }

        if (args.action === "remove") {
          if (!args.principle_id) return "Error: 'principle_id' is required for remove action."

          const existing = graph.nodes.find((n) => n.type === "constitution") as ConstitutionNode | undefined
          if (!existing) return "No constitution found."

          const principles = existing.metadata.principles || []
          const idx = principles.findIndex((p) => p.id === args.principle_id)
          if (idx === -1) return `Principle ${args.principle_id} not found.`

          const removed = principles.splice(idx, 1)[0]
          existing.updated_at = new Date().toISOString()
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["constitution"], ["validates"])
          return `Principle removed: "${removed.rule}"`
        }

        return "Invalid action. Use 'view', 'add', or 'remove'."
      },
    }),

    "sdd.promises": tool({
      description:
        "View and manage specification promises. Promises are verifiable assertions extracted " +
        "from requirements (acceptance_criteria) and business rules. Each promise tracks whether " +
        "it has been fulfilled, violated, or is still pending.",
      args: {
        action: tool.schema.string().describe("Action: 'report', 'list', 'verify', 'violate', 'unverifiable'"),
        promise_id: tool.schema.string().optional().describe("Promise ID (for verify/violate)"),
        evidence: tool.schema.string().optional().describe("Evidence of fulfillment (for verify)"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        if (args.action === "report") {
          const report = getPromiseReport(graph)
          return formatPromiseReport(report)
        }

        if (args.action === "list") {
          const promises = extractPromises(graph)
          if (promises.length === 0) return "No promises found. Add requirements with acceptance_criteria or business rules."

          const lines = [`## All Promises (${promises.length})\n`]
          for (const p of promises) {
            const status = p.status === "fulfilled" ? "✅" : p.status === "violated" ? "❌" : "⏳"
            lines.push(`- ${status} **${p.id}** (${p.source_node_id}): ${p.description}`)
          }
          return lines.join("\n")
        }

        if (args.action === "verify") {
          if (!args.promise_id) return "Error: 'promise_id' is required for verify."
          if (!args.evidence) return "Error: 'evidence' is required for verify."

          const result = verifyPromise(graph, args.promise_id, args.evidence)
          if (!result) return `Promise ${args.promise_id} not found.`
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["requirement", "business_rule"], ["promises"])
          return `Promise ${args.promise_id} marked as FULFILLED.\nEvidence: ${args.evidence}`
        }

        if (args.action === "violate") {
          if (!args.promise_id) return "Error: 'promise_id' is required for violate."

          const result = markPromiseViolated(graph, args.promise_id)
          if (!result) return `Promise ${args.promise_id} not found.`
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["requirement", "business_rule"], ["promises"])
          return `Promise ${args.promise_id} marked as VIOLATED.`
        }

        if (args.action === "unverifiable") {
          const allPromises = extractPromises(graph)
          const pendingPromises = allPromises.filter(p => p.status === "pending")
          const unverifiable = findUnverifiablePromises(pendingPromises, graph)

          if (unverifiable.length === 0) {
            return "All pending promises are verifiable. No infrastructure gaps detected."
          }

          const lines = [`## Unverifiable Promises (${unverifiable.length})\n`]
          lines.push("These promises cannot be verified because the required infrastructure is missing from the graph:\n")
          for (const item of unverifiable) {
            lines.push(`- **${item.id}**: ${item.description}`)
            lines.push(`  **Missing:** ${item.reason}`)
          }
          lines.push("")
          lines.push("Add the missing infrastructure nodes (architecture components, files, etc.) to make these promises verifiable.")
          return lines.join("\n")
        }

        return "Invalid action. Use 'report', 'list', 'verify', 'violate', or 'unverifiable'."
      },
    }),

    "sdd.quality": tool({
      description:
        "Calculate and display the project quality score (0-100%) with trend analysis. " +
        "Factors: validation, drift, promises, completeness, constitution compliance, test coverage.",
      args: {},
      async execute(_args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        // Check analysis cache
        const cacheMgr = getCacheManager(ctx.directory)
        const cached = cacheMgr.getAnalysisResult("quality", graph.metadata.updated_at ? new Date(graph.metadata.updated_at).getTime() : 0, graph.nodes.length)
        if (cached) return cached as string

        const report = calculateQualityScore(graph, ctx.directory)
        const formatted = formatQualityReport(report)

        // Cache the result
        cacheMgr.setAnalysisResult("quality", formatted, graph.metadata.updated_at ? new Date(graph.metadata.updated_at).getTime() : 0, graph.nodes.length)

        return formatted
      },
    }),

    "sdd.session_handoff": tool({
      description:
        "Generate a session handoff pack. Shows the current SDD state including active changes, " +
        "pending promises, quality score, recent decisions, and blocked items.",
      args: {},
      async execute(_args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const handoff = generateHandoff(graph, ctx.directory)
        saveSessionLog(ctx.directory, "session_handoff")
        return formatHandoffPack(handoff)
      },
    }),

    "sdd.anti_patterns": tool({
      description:
        "Detect anti-patterns in the spec graph: god nodes, circular dependencies, " +
        "speculation, skipped steps, missing tests, empty nodes.",
      args: {},
      async execute(_args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const result = detectAntiPatterns(graph)
        const formatted = formatAntiPatterns(result)
        // Truncate if too long
        if (formatted.length > 3000) {
          return formatted.slice(0, 3000) + "\n\n... (truncated, " + formatted.length + " chars total)"
        }
        return formatted
      },
    }),

    "sdd.clone_detection": tool({
      description:
        "Detect code clones (duplicate code blocks) across the project source files. " +
        "Returns groups of similar code blocks with risk assessment.",
      args: {},
      async execute(_args, ctx) {
        const report = detectAstClones(ctx.directory)
        return formatCloneReport(report)
      },
    }),

    "sdd.contradictions": tool({
      description:
        "Detect contradictions in the spec graph: conflicting requirements, " +
        "contradictory business rules, clashing designs, cross-type conflicts.",
      args: {},
      async execute(_args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const report = detectContradictions(graph)
        const formatted = formatContradictionReport(report)
        // Truncate if too long
        if (formatted.length > 3000) {
          return formatted.slice(0, 3000) + "\n\n... (truncated, " + formatted.length + " chars total)"
        }
        return formatted
      },
    }),

    "sdd.coverage": tool({
      description:
        "Calculate test coverage for requirements. Shows which requirements " +
        "are fully covered, partially covered, or have no tests at all.",
      args: {},
      async execute(_args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const report = calculateCoverage(graph)
        return formatCoverageReport(report)
      },
    }),

    "sdd.config_drift": tool({
      description:
        "Detect configuration drift: version mismatches, deprecated settings, " +
        "missing configs, lock file inconsistencies.",
      args: {},
      async execute(_args, ctx) {
        const report = detectConfigDrift(ctx.directory)
        return formatConfigDriftReport(report)
      },
    }),

    "sdd.workflow_export": tool({
      description:
        "Export the current SDD workflow state as a structured report. " +
        "Includes summary, changes, decisions, blockers, and recommendations.",
      args: {},
      async execute(_args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const exportData = exportWorkflow(graph)
        return formatWorkflowExport(exportData)
      },
    }),

    "sdd.install_hooks": tool({
      description:
        "Install Git shell hooks for SDD integration (pre-commit, post-checkout, post-merge).",
      args: {
        hooks: tool.schema.array(tool.schema.string()).describe("Hooks to install: pre-commit, post-checkout, post-merge"),
      },
      async execute(args, ctx) {
        const hooks = (args.hooks as string[]) || ["pre-commit"]
        const created = generateShellHooks({ projectDir: ctx.directory, hooks })
        return formatShellHookResult(created)
      },
    }),

    "sdd.brownfield_scan": tool({
      description:
        "Scan an existing (brownfield) project to understand its structure, " +
        "entry points, config files, test files, and frameworks.",
      args: {},
      async execute(_args, ctx) {
        const analysis = scanExistingProject(ctx.directory)
        return formatBrownfieldAnalysis(analysis)
      },
    }),

    "sdd.generate_cicd": tool({
      description:
        "Generate CI/CD configuration files for the project. Supports GitHub Actions, GitLab CI, Jenkins, and Docker.",
      args: {
        platform: tool.schema.enum(["github", "gitlab", "jenkins", "docker", "all"]).describe("CI/CD platform"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        const config = {
          platform: (args.platform as "github" | "gitlab" | "jenkins" | "docker" | "all") || "all",
          projectDir: ctx.directory,
          graph,
        }

        const results = generateCicd(config)
        writeCicdFiles(results)
        return formatCicdResults(results)
      },
    }),

    "sdd.sync_status": tool({
      description: "Check the sync status with remote repository (branch, ahead/behind, dirty state).",
      args: {},
      async execute(_args, ctx) {
        const status = getSyncStatus(ctx.directory)
        return formatSyncStatus(status)
      },
    }),

    "sdd.sync_pull": tool({
      description: "Pull latest changes from remote repository and sync SDD graph.",
      args: {},
      async execute(_args, ctx) {
        const acquired = acquireLock(ctx.directory, "current")
        if (!acquired) return "Error: Another sync operation is in progress. Wait or clear the lock."

        try {
          const result = pullLatest(ctx.directory)
          return result.details
        } finally {
          releaseLock(ctx.directory)
        }
      },
    }),

    "sdd.sync_push": tool({
      description: "Push SDD changes to remote repository.",
      args: {
        message: tool.schema.string().describe("Commit message"),
      },
      async execute(args, ctx) {
        const acquired = acquireLock(ctx.directory, "current")
        if (!acquired) return "Error: Another sync operation is in progress."

        try {
          const result = pushChanges(ctx.directory, args.message || "SDD updates")
          return result.details
        } finally {
          releaseLock(ctx.directory)
        }
      },
    }),

    "sdd.create_snapshot": tool({
      description: "Create a snapshot of the current SDD state before making changes.",
      args: {
        change_id: tool.schema.string().describe("Change ID to snapshot"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        const snapshot = createSnapshot(graph, args.change_id, ctx.directory)
        return `Snapshot created: ${snapshot.id} for change ${args.change_id}`
      },
    }),

    "sdd.rollback": tool({
      description: "Rollback a change using git revert, snapshot restore, or backup restore (tries all methods).",
      args: {
        change_id: tool.schema.string().describe("Change ID to rollback"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        const result = executeRollback(graph, args.change_id, ctx.directory)
        if (result.success) {
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change"], ["rollback"])
        }
        return formatRollbackResult(result)
      },
    }),

    "sdd.rollback_history": tool({
      description: "View the history of rollback operations.",
      args: {},
      async execute(_args, ctx) {
        const history = loadRollbackHistory(ctx.directory)
        return formatRollbackHistory(history)
      },
    }),

    "sdd.set_role": tool({
      description: "Set a user's role (admin, architect, developer, viewer).",
      args: {
        user: tool.schema.string().describe("Username"),
        role: tool.schema.enum(["admin", "architect", "developer", "viewer"]).describe("Role to assign"),
      },
      async execute(args, ctx) {
        setRole(ctx.directory, args.user, args.role as "admin" | "architect" | "developer" | "viewer")
        return `Role set: ${args.user} → ${args.role}`
      },
    }),

    "sdd.check_permission": tool({
      description: "Check if a user has a specific permission.",
      args: {
        user: tool.schema.string().describe("Username"),
        permission: tool.schema.string().describe("Permission to check"),
      },
      async execute(args, ctx) {
        const role = getUserRoleWithAuth(ctx.directory, args.user)
        const allowed = checkPermission(role, args.permission as any, ctx.directory)
        addAuditEntry(ctx.directory, args.user, "check_permission", args.permission, allowed ? "allowed" : "denied")
        return formatPermissionCheck(args.user, role, args.permission as any, allowed)
      },
    }),

    "sdd.audit_log": tool({
      description: "View the audit log of permission checks and actions.",
      args: {
        user: tool.schema.string().optional().describe("Filter by user"),
        limit: tool.schema.number().optional().describe("Limit entries"),
      },
      async execute(args, ctx) {
        const entries = getAuditLog(ctx.directory, {
          user: args.user,
          limit: args.limit || 20,
        })
        return formatAuditLog(entries)
      },
    }),

    "sdd.remote_status": tool({
      description: "Check the status of remote GitHub/GitLab integration for authentication.",
      args: {},
      async execute(_args, ctx) {
        const remote = detectRemote(ctx.directory)
        return formatRemoteStatus(remote)
      },
    }),

    "sdd.bug_fix": tool({
      description: "Workflow completo de bug fix com aprovação automática.",
      args: {
        description: tool.schema.string().describe("Descrição do bug"),
        files: tool.schema.array(tool.schema.string()).describe("Arquivos afetados"),
        severity: tool.schema.enum(["critical", "high", "medium", "low"]).describe("Severidade do bug"),
      },
      async execute(args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { createBugFixChange, getBugFixInstructions } = await import("../sdd/workflows/bug-fix.js")
        const { change, bugFix } = createBugFixChange(graph, {
          id: `bugfix-${Date.now()}`,
          description: args.description,
          files: args.files,
          severity: args.severity as any,
        })
        
        const repo = getRepo(ctx.directory)
        if (repo.isInitialized()) {
          const graph = repo.loadGraph()
          graph.nodes.push(change, bugFix)
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change"], [])
        }
        
        return getBugFixInstructions(bugFix)
      },
    }),

    "sdd.hotfix": tool({
      description: "Documentar hotfix retroativamente (post-hoc).",
      args: {
        description: tool.schema.string().describe("Descrição do incidente"),
        files: tool.schema.array(tool.schema.string()).describe("Arquivos modificados"),
        urgency: tool.schema.enum(["critical", "high", "medium"]).describe("Urgência"),
      },
      async execute(args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { createHotfixChange, getHotfixInstructions } = await import("../sdd/workflows/hotfix.js")
        const { change, hotfix } = createHotfixChange(graph, {
          id: `hotfix-${Date.now()}`,
          description: args.description,
          files: args.files,
          urgency: args.urgency as any,
        })
        
        hotfix.metadata.fix_applied = true
        hotfix.metadata.post_hoc_documented = true
        change.status = "COMPLETED"
        
        const repo = getRepo(ctx.directory)
        if (repo.isInitialized()) {
          const graph = repo.loadGraph()
          graph.nodes.push(change, hotfix)
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change"], [])
        }
        
        return getHotfixInstructions(hotfix)
      },
    }),

    "sdd.refactoring": tool({
      description: "Workflow de refactoring com verificação de dependências.",
      args: {
        target: tool.schema.string().describe("Módulo alvo"),
        description: tool.schema.string().describe("Descrição do refactoring"),
        type: tool.schema.enum(["extract", "rename", "move", "simplify", "restructure"]).describe("Tipo de refactoring"),
        files: tool.schema.array(tool.schema.string()).describe("Arquivos envolvidos"),
      },
      async execute(args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { createRefactoringChange, getRefactoringInstructions } = await import("../sdd/workflows/refactoring.js")
        const { change, refactoring } = createRefactoringChange(graph, {
          id: `refactor-${Date.now()}`,
          target_module: args.target,
          description: args.description,
          refactoring_type: args.type as any,
          files: args.files,
        })
        
        const repo = getRepo(ctx.directory)
        if (repo.isInitialized()) {
          const graph = repo.loadGraph()
          graph.nodes.push(change, refactoring)
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change"], [])
        }
        
        return getRefactoringInstructions(refactoring)
      },
    }),

    "sdd.deprecate": tool({
      description: "Deprecar feature com plano de migração.",
      args: {
        target: tool.schema.string().describe("Feature a deprecar"),
        removal_date: tool.schema.string().describe("Data de remoção (YYYY-MM-DD)"),
        migration_guide: tool.schema.string().optional().describe("Guia de migração"),
        endpoints: tool.schema.array(tool.schema.string()).describe("Endpoints afetados"),
      },
      async execute(args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { createDeprecationChange, getDeprecationInstructions } = await import("../sdd/workflows/deprecation.js")
        const { change, deprecation } = createDeprecationChange(graph, {
          id: `deprecate-${Date.now()}`,
          target_feature: args.target,
          description: `Deprecating ${args.target}`,
          removal_date: args.removal_date,
          migration_guide: args.migration_guide,
          affected_endpoints: args.endpoints,
        })
        
        const repo = getRepo(ctx.directory)
        if (repo.isInitialized()) {
          const graph = repo.loadGraph()
          graph.nodes.push(change, deprecation)
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change", "feature"], ["deprecated"])
        }
        
        return getDeprecationInstructions(deprecation)
      },
    }),

    "sdd.create_migration": tool({
      description: "Criar migração de dados com rollback.",
      args: {
        source: tool.schema.string().describe("Schema de origem"),
        target: tool.schema.string().describe("Schema alvo"),
        description: tool.schema.string().describe("Descrição da migração"),
        transformations: tool.schema.array(tool.schema.string()).optional().describe("Transformações de dados"),
      },
      async execute(args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { createMigrationChange, getMigrationInstructions } = await import("../sdd/workflows/data-migration.js")
        const { change, migration } = createMigrationChange(graph, {
          id: `migration-${Date.now()}`,
          source_schema: args.source,
          target_schema: args.target,
          description: args.description,
          data_transformations: args.transformations,
        })
        
        const repo = getRepo(ctx.directory)
        if (repo.isInitialized()) {
          const graph = repo.loadGraph()
          graph.nodes.push(change, migration)
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change", "entity"], [])
        }
        
        return getMigrationInstructions(migration)
      },
    }),

    "sdd.create_experiment": tool({
      description: "Criar experimento A/B.",
      args: {
        hypothesis: tool.schema.string().describe("Hipótese do experimento"),
        variants: tool.schema.array(tool.schema.object({
          name: tool.schema.string(),
          description: tool.schema.string(),
          traffic_percentage: tool.schema.number(),
        })).describe("Variantes do experimento"),
        metric: tool.schema.string().describe("Métrica primária"),
        duration: tool.schema.number().describe("Duração em dias"),
      },
      async execute(args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { createExperimentChange, getExperimentInstructions } = await import("../sdd/workflows/ab-testing.js")
        const { change, experiment } = createExperimentChange(graph, {
          id: `experiment-${Date.now()}`,
          hypothesis: args.hypothesis,
          variants: args.variants as any,
          primary_metric: args.metric,
          duration_days: args.duration,
        })
        
        const repo = getRepo(ctx.directory)
        if (repo.isInitialized()) {
          const graph = repo.loadGraph()
          graph.nodes.push(change, experiment)
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change"], [])
        }
        
        return getExperimentInstructions(experiment)
      },
    }),

    "sdd.create_flag": tool({
      description: "Criar feature flag.",
      args: {
        name: tool.schema.string().describe("Nome da flag"),
        description: tool.schema.string().describe("Descrição da flag"),
        rollout: tool.schema.number().describe("Porcentagem de rollout (0-100)"),
        audience: tool.schema.string().optional().describe("Público-alvo"),
      },
      async execute(args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { createFeatureFlagChange, getFeatureFlagInstructions } = await import("../sdd/workflows/feature-flags.js")
        const { change, featureFlag } = createFeatureFlagChange(graph, {
          id: `flag-${Date.now()}`,
          flag_name: args.name,
          description: args.description,
          rollout_percentage: args.rollout,
          target_audience: args.audience,
        })
        
        const repo = getRepo(ctx.directory)
        if (repo.isInitialized()) {
          const graph = repo.loadGraph()
          graph.nodes.push(change, featureFlag)
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change", "feature"], [])
        }
        
        return getFeatureFlagInstructions(featureFlag)
      },
    }),

    "sdd.create_tenant": tool({
      description: "Adicionar multi-tenancy ao sistema.",
      args: {
        name: tool.schema.string().describe("Nome do tenant"),
        type: tool.schema.enum(["shared_database", "dedicated_database", "shared_schema"]).describe("Tipo de tenant"),
        isolation: tool.schema.enum(["row", "schema", "database"]).describe("Nível de isolamento"),
      },
      async execute(args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { createTenantChange, getTenantInstructions } = await import("../sdd/workflows/multi-tenancy.js")
        const { change, tenant } = createTenantChange(graph, {
          id: `tenant-${Date.now()}`,
          tenant_name: args.name,
          tenant_type: args.type as any,
          isolation_level: args.isolation as any,
        })
        
        const repo = getRepo(ctx.directory)
        if (repo.isInitialized()) {
          const graph = repo.loadGraph()
          graph.nodes.push(change, tenant)
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change", "entity"], [])
        }
        
        return getTenantInstructions(tenant)
      },
    }),

    "sdd.onboard_developer": tool({
      description: "Gerar guia de onboarding para novo desenvolvedor.",
      args: {
        developer_name: tool.schema.string().optional().describe("Nome do desenvolvedor"),
      },
      async execute(args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { generateOnboardingGuide } = await import("../sdd/workflows/onboarding.js")
        return generateOnboardingGuide(graph, {
          id: `onboarding-${Date.now()}`,
          developer_name: args.developer_name,
        })
      },
    }),

    "sdd.security_audit": tool({
      description: "Realizar auditoria de segurança do projeto.",
      args: {},
      async execute(_args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { performSecurityAudit, formatSecurityAudit } = await import("../sdd/analysis/security.js")
        const result = performSecurityAudit(graph)
        return formatSecurityAudit(result)
      },
    }),

    "sdd.analyze_scalability": tool({
      description: "Analisar escalabilidade do projeto.",
      args: {},
      async execute(_args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { analyzeScalability, formatScalabilityAnalysis } = await import("../sdd/analysis/scalability.js")
        const result = analyzeScalability(graph)
        return formatScalabilityAnalysis(result)
      },
    }),

    "sdd.check_compliance": tool({
      description: "Verificar compliance com padrão regulatory.",
      args: {
        standard: tool.schema.enum(["GDPR", "LGPD", "HIPAA", "SOC2", "PCI_DSS", "ISO27001"]).describe("Padrão de compliance"),
      },
      async execute(args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { checkCompliance, formatComplianceCheck } = await import("../sdd/analysis/compliance.js")
        const result = checkCompliance(graph, args.standard)
        return formatComplianceCheck(result)
      },
    }),

    "sdd.setup_monitoring": tool({
      description: "Configurar monitoramento do projeto.",
      args: {},
      async execute(_args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { setupMonitoring, formatMonitoringSetup } = await import("../sdd/monitoring/setup.js")
        const result = setupMonitoring(graph)
        return formatMonitoringSetup(result)
      },
    }),

    "sdd.generate_dashboard": tool({
      description: "Gerar configuração de dashboard de monitoramento.",
      args: {
        type: tool.schema.enum(["overview", "api", "database", "security"]).describe("Tipo de dashboard"),
      },
      async execute(args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { generateDashboardConfig, formatDashboardConfig } = await import("../sdd/monitoring/setup.js")
        const config = generateDashboardConfig(graph, args.type as any)
        return formatDashboardConfig(config)
      },
    }),

    "sdd.report_incident": tool({
      description: "Reportar incidente.",
      args: {
        title: tool.schema.string().describe("Título do incidente"),
        severity: tool.schema.enum(["SEV1", "SEV2", "SEV3", "SEV4"]).describe("Severidade"),
        impact: tool.schema.string().describe("Impacto do incidente"),
      },
      async execute(args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { createIncident, getIncidentInstructions } = await import("../sdd/incidents/manager.js")
        const incident = createIncident(graph, {
          id: `incident-${Date.now()}`,
          title: args.title,
          severity: args.severity as any,
          impact: args.impact,
        })
        
        const repo = getRepo(ctx.directory)
        if (repo.isInitialized()) {
          const graph = repo.loadGraph()
          graph.nodes.push(incident)
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change"], [])
        }
        
        return getIncidentInstructions(incident)
      },
    }),

    "sdd.create_sla": tool({
      description: "Criar SLA (Acordo de Nível de Serviço).",
      args: {
        name: tool.schema.string().describe("Nome do SLA"),
        metric: tool.schema.string().describe("Métrica a ser monitorada"),
        target: tool.schema.number().describe("Meta desejada"),
        period: tool.schema.string().describe("Período de medição"),
      },
      async execute(args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { createSLA, getSLAInstructions } = await import("../sdd/sla/tracker.js")
        const sla = createSLA(graph, {
          id: `sla-${Date.now()}`,
          name: args.name,
          metric: args.metric,
          target: args.target,
          period: args.period,
        })
        
        const repo = getRepo(ctx.directory)
        if (repo.isInitialized()) {
          const graph = repo.loadGraph()
          graph.nodes.push(sla)
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change"], [])
        }
        
        return getSLAInstructions(sla)
      },
    }),

    "sdd.estimate_cost": tool({
      description: "Estimar custos do projeto.",
      args: {},
      async execute(_args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { estimateCost, formatCostEstimate } = await import("../sdd/cost/estimator.js")
        const result = estimateCost(graph)
        return formatCostEstimate(result)
      },
    }),

    "sdd.generate_docs": tool({
      description: "Gerar documentação do projeto.",
      args: {
        type: tool.schema.enum(["api", "user_guide", "developer_guide", "architecture"]).describe("Tipo de documentação"),
        language: tool.schema.string().optional().describe("Idioma da documentação"),
      },
      async execute(args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { generateDocumentation } = await import("../sdd/documentation/generator.js")
        return generateDocumentation(graph, {
          type: args.type as any,
          language: args.language,
        })
      },
    }),

    "sdd.knowledge_transfer": tool({
      description: "Gerar documento de transferência de conhecimento.",
      args: {},
      async execute(_args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { generateKnowledgeTransfer, formatKnowledgeTransfer } = await import("../sdd/knowledge/transfer.js")
        const data = generateKnowledgeTransfer(graph)
        return formatKnowledgeTransfer(data)
      },
    }),

    "sdd.disaster_recovery_plan": tool({
      description: "Criar plano de disaster recovery.",
      args: {},
      async execute(_args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { generateDisasterRecoveryPlan, formatDisasterRecoveryPlan } = await import("../sdd/disaster/recovery.js")
        const plan = generateDisasterRecoveryPlan(graph)
        return formatDisasterRecoveryPlan(plan)
      },
    }),

    "sdd.analyze_complexity": tool({
      description: "Analisar complexidade ciclomática e cognitiva do código.",
      args: {
        file: tool.schema.string().describe("Caminho do arquivo para analisar"),
      },
      async execute(args, ctx) {
        const { readFileSync } = await import("fs")
        const { join } = await import("path")
        const filePath = join(ctx.directory, args.file)
        const code = readFileSync(filePath, "utf-8")
        const { analyzeComplexity, formatComplexityReport } = await import("../sdd/code-quality/complexity.js")
        const report = analyzeComplexity(code, args.file)
        return formatComplexityReport(report)
      },
    }),

    "sdd.code_metrics": tool({
      description: "Calcular métricas de código (linhas, aninhamento, parâmetros).",
      args: {
        file: tool.schema.string().describe("Caminho do arquivo para analisar"),
      },
      async execute(args, ctx) {
        const { readFileSync } = await import("fs")
        const { join } = await import("path")
        const filePath = join(ctx.directory, args.file)
        const code = readFileSync(filePath, "utf-8")
        const { analyzeMetrics, formatMetricsReport } = await import("../sdd/code-quality/metrics.js")
        const report = analyzeMetrics(code, args.file)
        return formatMetricsReport(report)
      },
    }),

    "sdd.detect_smells": tool({
      description: "Detectar code smells (God Class, Feature Envy, Switch Statements, etc).",
      args: {
        file: tool.schema.string().describe("Caminho do arquivo para analisar"),
      },
      async execute(args, ctx) {
        const { readFileSync } = await import("fs")
        const { join } = await import("path")
        const filePath = join(ctx.directory, args.file)
        const code = readFileSync(filePath, "utf-8")
        const { detectCodeSmells, formatCodeSmellReport } = await import("../sdd/code-quality/smells.js")
        const report = detectCodeSmells(code, args.file)
        return formatCodeSmellReport(report)
      },
    }),

    "sdd.analyze_dependencies": tool({
      description: "Analisar dependências, detectar ciclos e medir acoplamento.",
      args: {},
      async execute(_args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { analyzeDependencies, formatDependencyReport } = await import("../sdd/code-quality/dependencies.js")
        const report = analyzeDependencies(graph)
        return formatDependencyReport(report)
      },
    }),

    "sdd.verify_usage": tool({
      description: "Verificar se código é realmente usado/importado no projeto.",
      args: {},
      async execute(_args, ctx) {
        const graph = loadOrEmpty(ctx.directory)
        const { trackUsage, formatUsageReport } = await import("../sdd/code-quality/usage-tracker.js")
        const { readdirSync, readFileSync, statSync } = await import("fs")
        const { join } = await import("path")

        const sourceFiles = new Map<string, string>()
        const sourceExtensions = [".ts", ".tsx", ".js", ".jsx"]

        function scanDir(dir: string, relativePath: string = ""): void {
          let entries: string[]
          try {
            entries = readdirSync(dir)
          } catch {
            return
          }

          for (const entry of entries) {
            if (["node_modules", ".sdd", "dist", "build", ".git", ".opencode"].includes(entry)) continue

            const fullPath = join(dir, entry)
            const relPath = relativePath ? `${relativePath}/${entry}` : entry

            try {
              const stat = statSync(fullPath)
              if (stat.isDirectory()) {
                scanDir(fullPath, relPath)
              } else if (sourceExtensions.some(ext => entry.endsWith(ext))) {
                try {
                  const content = readFileSync(fullPath, "utf-8")
                  sourceFiles.set(relPath, content)
                } catch {}
              }
            } catch {}
          }
        }

        scanDir(ctx.directory)
        const report = trackUsage(graph, sourceFiles)
        return formatUsageReport(report)
      },
    }),

    "sdd.find_dead_code": tool({
      description: "🔍 READ-ONLY: Detectar código não utilizado (imports não usados, funções mortas). NÃO deleta arquivos.",
      args: {
        file: tool.schema.string().describe("Caminho do arquivo para analisar"),
      },
      async execute(args, ctx) {
        const { readFileSync } = await import("fs")
        const { join } = await import("path")
        const filePath = join(ctx.directory, args.file)
        const code = readFileSync(filePath, "utf-8")
        const { analyzeImports, formatImportAnalysis } = await import("../sdd/code-quality/import-analyzer.js")
        const analysis = analyzeImports(code, args.file)
        return formatImportAnalysis(analysis)
      },
    }),

    "sdd.remove_dead_code": tool({
      description: "Remover código morto com aprovação SDD (CRIA ChangeNode, NÃO deleta diretamente).",
      args: {
        file: tool.schema.string().describe("Caminho do arquivo para limpar"),
        dry_run: tool.schema.boolean().optional().describe("Apenas simular (não deletar)"),
      },
      async execute(args, ctx) {
        const { readFileSync, existsSync } = await import("fs")
        const { join } = await import("path")
        const filePath = join(ctx.directory, args.file)
        
        if (!existsSync(filePath)) {
          return `❌ Arquivo não encontrado: ${args.file}`
        }

        const code = readFileSync(filePath, "utf-8")
        const { analyzeImports } = await import("../sdd/code-quality/import-analyzer.js")
        const analysis = analyzeImports(code, args.file)

        const unusedImports = analysis.issues.filter(i => i.type === 'unused_import')
        
        if (unusedImports.length === 0) {
          return `✅ Nenhum import não utilizado encontrado em ${args.file}`
        }

        if (args.dry_run) {
          return [
            `🔍 **Dry Run** - Nenhuma alteração será feita`,
            "",
            `**Arquivo:** ${args.file}`,
            `**Imports não utilizados:** ${unusedImports.length}`,
            "",
            "### Imports para remover:",
            ...unusedImports.map(i => `- Linha ${i.line}: ${i.message}`),
            "",
            "Execute sem dry_run para criar o ChangeNode e solicitar aprovação.",
          ].join("\n")
        }

        const graph = loadOrEmpty(ctx.directory)
        
        const changeNodeId = `change-remove-dead-${Date.now()}`
        const affectedNodes: string[] = []
        
        const fileNodeId = graph.nodes.find(n => 
          n.type === "file" && (n.metadata as any).path === args.file
        )?.id

        if (fileNodeId) {
          affectedNodes.push(fileNodeId)
        }

        const changeNode = {
          id: changeNodeId,
          type: "change" as const,
          name: `Remover código morto de ${args.file}`,
          status: "PROPOSED" as const,
          version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          metadata: {
            title: `Remover código morto de ${args.file}`,
            reason: `${unusedImports.length} imports não utilizados detectados`,
            approval_level: "REVIEW" as const,
            affected_nodes: affectedNodes,
            affected_relationships: [],
            new_nodes: [],
            removed_nodes: [],
            modified_nodes: [],
            affected_files: [args.file],
            affected_tests: [],
            implementation_tasks: [],
            origin: "dead_code_detection",
          },
        }

        graph.nodes.push(changeNode)

        const repo = createRepository(ctx.directory)
        if (repo.isInitialized()) {
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change"], [])
        }

        return [
          `📋 **ChangeNode criado para remoção de código morto**`,
          "",
          `**ID:** ${changeNodeId}`,
          `**Arquivo:** ${args.file}`,
          `**Imports para remover:** ${unusedImports.length}`,
          "",
          "### Próximos passos:",
          "1. Use `sdd.approve_change` para aprovar a remoção",
          "2. Após aprovação, o hook permitirá a edição do arquivo",
          "3. Remova manualmente os imports listados acima",
          "",
          "⚠️ **NENHUMA alteração foi feita ainda.** Aguarde aprovação.",
        ].join("\n")
      },
    }),

    "sdd.parse_symbols": tool({
      description: "Extrair símbolos (funções, classes, interfaces) do código fonte.",
      args: {
        file: tool.schema.string().describe("Caminho do arquivo para analisar"),
      },
      async execute(args, ctx) {
        const { readFileSync } = await import("fs")
        const { join } = await import("path")
        const filePath = join(ctx.directory, args.file)
        const code = readFileSync(filePath, "utf-8")
        const { parseSymbols, formatSymbolParseResult } = await import("../sdd/code-quality/symbol-parser.js")
        const result = parseSymbols(code, args.file)
        return formatSymbolParseResult(result)
      },
    }),

    "sdd.plan_implementation": tool({
      description: "Planejar implementação conectando código a spec nodes (feature/entity/component).",
      args: {
        feature_id: tool.schema.string().describe("ID da feature ou entity no grafo"),
        files: tool.schema.string().describe("Lista de arquivos separados por vírgula"),
      },
      async execute(args, ctx) {
        const repo2 = getRepo(ctx.directory)
        const graph = loadOrEmpty(ctx.directory)
        const indices = repo2.isInitialized() ? repo2.getIndices() : null
        const { parseSymbols, convertToSymbolNodes } = await import("../sdd/code-quality/symbol-parser.js")
        const { readFileSync } = await import("fs")
        const { join } = await import("path")

        const fileList = args.files.split(",").map(f => f.trim())
        const featureNode = indices ? indices.byId.get(args.feature_id) : graph.nodes.find(n => n.id === args.feature_id)

        if (!featureNode) {
          return `❌ Feature/Entity não encontrada: ${args.feature_id}\n\nCrie o nó primeiro com sdd.discover ou sdd.update_from_answers.`
        }

        const newNodes: string[] = []
        const newRelationships: Array<{id: string, from: string, to: string, type: string, metadata: Record<string, unknown>}> = []

        for (const file of fileList) {
          const fullPath = join(ctx.directory, file)
          let code: string
          try {
            code = readFileSync(fullPath, "utf-8")
          } catch {
            continue
          }

          const fileNodeId = `file-${file.replace(/[^a-zA-Z0-9]/g, "-")}`
          const fileNode = {
            id: fileNodeId,
            type: "file" as const,
            name: file,
            status: "DRAFT" as const,
            version: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            metadata: { path: file },
          }

          graph.nodes.push(fileNode)
          newNodes.push(fileNodeId)

          newRelationships.push({
            id: `rel-${fileNodeId}-${args.feature_id}`,
            from: args.feature_id,
            to: fileNodeId,
            type: "implements" as const,
            metadata: {},
          })

          const symbolResult = parseSymbols(code, file)
          const symbolNodes = convertToSymbolNodes(symbolResult)

          for (const symNode of symbolNodes) {
            graph.nodes.push(symNode)
            newNodes.push(symNode.id)

            newRelationships.push({
              id: `rel-${fileNodeId}-${symNode.id}`,
              from: fileNodeId,
              to: symNode.id,
              type: "contains" as const,
              metadata: {},
            })

            newRelationships.push({
              id: `rel-${args.feature_id}-${symNode.id}`,
              from: args.feature_id,
              to: symNode.id,
              type: "defines" as const,
              metadata: {},
            })
          }
        }

        for (const rel of newRelationships) {
          graph.relationships.push(rel as any)
        }

        const repo = createRepository(ctx.directory)
        if (repo.isInitialized()) {
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["file", "symbol"], ["implements", "contains", "defines"])
        }

        return [
          `✅ Implementação planejada para: ${featureNode.name}`,
          "",
          `**Arquivos criados no grafo:** ${fileList.length}`,
          `**Símbolos extraídos:** ${newNodes.length - fileList.length}`,
          `**Relacionamentos criados:** ${newRelationships.length}`,
          "",
          "### Próximos passos",
          "1. Use sdd.verify_usage para garantir que o código é usado",
          "2. Use sdd.find_dead_code para detectar imports não utilizados",
          "3. Use sdd.analyze_dependencies para verificar acoplamento",
        ].join("\n")
      },
    }),

    "sdd.update_node": tool({
      description: "Update an existing node in the SDD Knowledge Graph. Updates fields and increments version.",
      args: {
        node_id: tool.schema.string().describe("Node ID to update"),
        name: tool.schema.string().optional().describe("New name"),
        description: tool.schema.string().optional().describe("New description"),
        status: tool.schema.string().optional().describe("New status (DRAFT, APPROVED, IMPLEMENTING, IMPLEMENTED, BLOCKED)"),
        metadata_json: tool.schema.string().optional().describe("Additional metadata as JSON string"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        const updates: Partial<AnyNode> = {}
        if (args.name) updates.name = args.name
        if (args.description !== undefined) updates.description = args.description
        if (args.status) updates.status = args.status as AnyNode["status"]
        if (args.metadata_json) {
          try {
            updates.metadata = { ...getNode(graph, args.node_id)?.metadata, ...JSON.parse(args.metadata_json) }
          } catch {
            return "Error: Invalid JSON in metadata_json"
          }
        }

        try {
          const updated = updateNode(graph, args.node_id, updates)
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, [updated.type], [])
          return `Node updated: **${updated.id}** (${updated.type}): ${updated.name} [v${updated.version}]`
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

    "sdd.remove_node": tool({
      description: "Remove a node and all its relationships from the SDD Knowledge Graph.",
      args: {
        node_id: tool.schema.string().describe("Node ID to remove"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        const node = getNode(graph, args.node_id)
        if (!node) return `Node ${args.node_id} not found.`
        const relCount = getRelationships(graph, args.node_id).length

        try {
          removeNode(graph, args.node_id)
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, [node.type], [])
          return `Node removed: **${args.node_id}** (${node.type}): ${node.name}\nRemoved ${relCount} associated relationship(s).`
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

    "sdd.remove_relationship": tool({
      description: "Remove a specific relationship between two nodes.",
      args: {
        from_id: tool.schema.string().describe("Source node ID"),
        to_id: tool.schema.string().describe("Target node ID"),
        type: tool.schema.string().describe("Relationship type"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        removeRelationship(graph, args.from_id, args.to_id, args.type as any)
        repo.saveGraph(graph)
        invalidateCacheForMutation(ctx.directory, [], [args.type])
        return `Relationship removed: ${args.from_id} --[${args.type}]--> ${args.to_id}`
      },
    }),

    "sdd.traverse_outgoing": tool({
      description: "Traverse the graph following outgoing edges from a node (BFS). Returns reachable nodes and distances.",
      args: {
        node_id: tool.schema.string().describe("Starting node ID"),
        max_depth: tool.schema.number().optional().describe("Maximum traversal depth (default: 5)"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const indices = repo.getIndices()

        const node = getNodeIndexed(indices, args.node_id)
        if (!node) return `Node ${args.node_id} not found.`

        const depth = args.max_depth || 5
        const result = bfsOutgoing(graph, args.node_id, { max_depth: depth, include_start: true })

        const lines = [
          `## Outgoing Traverse: ${args.node_id}`,
          `**Node:** ${node.name} (${node.type})`,
          `**Max Depth:** ${depth}`,
          `**Reachable Nodes:** ${result.nodes.length}`,
          "",
          "### Nodes by Distance",
        ]

        const maxShow = 30
        let shown = 0
        for (const [id, dist] of result.distances) {
          if (shown >= maxShow) {
            lines.push(`- ... and ${result.distances.size - maxShow} more`)
            break
          }
          const n = indices.byId.get(id)
          if (n) { lines.push(`- **${id}** (depth ${dist}): ${n.name} (${n.type})`); shown++ }
        }

        return lines.join("\n")
      },
    }),

    "sdd.traverse_incoming": tool({
      description: "Traverse the graph following incoming edges to a node (BFS). Finds what depends on this node.",
      args: {
        node_id: tool.schema.string().describe("Starting node ID"),
        max_depth: tool.schema.number().optional().describe("Maximum traversal depth (default: 5)"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const indices = repo.getIndices()

        const node = getNodeIndexed(indices, args.node_id)
        if (!node) return `Node ${args.node_id} not found.`

        const depth = args.max_depth || 5
        const result = bfsIncoming(graph, args.node_id, { max_depth: depth, include_start: true })

        const lines = [
          `## Incoming Traverse: ${args.node_id}`,
          `**Node:** ${node.name} (${node.type})`,
          `**Max Depth:** ${depth}`,
          `**Dependents Found:** ${result.nodes.length}`,
          "",
          "### Nodes by Distance",
        ]

        const maxShow = 30
        let shown = 0
        for (const [id, dist] of result.distances) {
          if (shown >= maxShow) {
            lines.push(`- ... and ${result.distances.size - maxShow} more`)
            break
          }
          const n = indices.byId.get(id)
          if (n) { lines.push(`- **${id}** (depth ${dist}): ${n.name} (${n.type})`); shown++ }
        }

        return lines.join("\n")
      },
    }),

    "sdd.traverse_both": tool({
      description: "Traverse the graph in both directions from a node (BFS). Returns the full neighborhood.",
      args: {
        node_id: tool.schema.string().describe("Starting node ID"),
        max_depth: tool.schema.number().optional().describe("Maximum traversal depth (default: 3)"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const indices = repo.getIndices()

        const node = getNodeIndexed(indices, args.node_id)
        if (!node) return `Node ${args.node_id} not found.`

        const depth = args.max_depth || 3
        const result = bfsBoth(graph, args.node_id, { max_depth: depth, include_start: true })

        const lines = [
          `## Bidirectional Traverse: ${args.node_id}`,
          `**Node:** ${node.name} (${node.type})`,
          `**Max Depth:** ${depth}`,
          `**Connected Nodes:** ${result.nodes.length}`,
          "",
          "### Nodes by Distance",
        ]

        const maxShow = 30
        let shown = 0
        for (const [id, dist] of result.distances) {
          if (shown >= maxShow) {
            lines.push(`- ... and ${result.distances.size - maxShow} more`)
            break
          }
          const n = indices.byId.get(id)
          if (n) { lines.push(`- **${id}** (depth ${dist}): ${n.name} (${n.type})`); shown++ }
        }

        return lines.join("\n")
      },
    }),

    "sdd.get_subgraph": tool({
      description: "Extract a subgraph containing only the specified nodes and their internal relationships.",
      args: {
        node_ids: tool.schema.string().describe("Comma-separated list of node IDs"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        const ids = args.node_ids.split(",").map(s => s.trim())
        const subgraph = getSubgraph(graph, ids)

        const lines = [
          `## Subgraph`,
          `**Nodes:** ${subgraph.nodes.length}`,
          `**Relationships:** ${subgraph.relationships.length}`,
          "",
          "### Nodes",
        ]

        const nodePage = paginate(subgraph.nodes)
        for (const n of nodePage.page) {
          lines.push(`- **${n.id}** (${n.type}): ${n.name} [${n.status}]`)
        }
        if (nodePage.hasMore) lines.push(`\n... and ${nodePage.total - nodePage.page.length} more nodes`)

        if (subgraph.relationships.length > 0) {
          lines.push("\n### Relationships")
          const relPage = paginate(subgraph.relationships)
          for (const r of relPage.page) {
            lines.push(`- ${r.from} --[${r.type}]--> ${r.to}`)
          }
          if (relPage.hasMore) lines.push(`\n... and ${relPage.total - relPage.page.length} more relationships`)
        }

        return lines.join("\n")
      },
    }),

    "sdd.count_nodes": tool({
      description: "Count nodes by type in the SDD Knowledge Graph.",
      args: {},
      async execute(_args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const indices = repo.getIndices()

        const lines = ["## Node Counts by Type\n"]
        const sorted = [...indices.byType.entries()]
          .sort(([, a], [, b]) => b.length - a.length)
        for (const [type, nodes] of sorted) {
          lines.push(`- **${type}:** ${nodes.length}`)
        }
        lines.push(`\n**Total:** ${indices.totalNodes} nodes`)
        return lines.join("\n")
      },
    }),

    "sdd.get_nodes_by_status": tool({
      description: "List all nodes with a specific status.",
      args: {
        status: tool.schema.enum(["DRAFT", "PROPOSED", "APPROVED", "IMPLEMENTING", "IMPLEMENTED", "VERIFIED", "DEPRECATED", "CONFLICT", "DRIFTED", "BLOCKED", "todo", "ready", "in_progress", "blocked"]).describe("Status to filter by"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const indices = repo.getIndices()

        const nodes = getNodesByStatusIndexed(indices, args.status)
        if (nodes.length === 0) return `No nodes with status "${args.status}".`

        const { page, total, hasMore } = paginate(nodes)
        const lines = [`## Nodes with status "${args.status}" (${total}${hasMore ? ", showing " + page.length : ""})\n`]
        for (const node of page) {
          lines.push(`- **${node.id}** (${node.type}): ${node.name}`)
        }
        if (hasMore) lines.push(`\nUse pagination or filter to see more.`)
        return lines.join("\n")
      },
    }),

    "sdd.detect_sync_conflicts": tool({
      description: "Detect conflicts between local and remote SDD graphs. Requires a remote graph file path.",
      args: {
        remote_graph_path: tool.schema.string().describe("Path to the remote graph YAML file"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        const conflicts = detectConflicts(graph, args.remote_graph_path)

        if (conflicts.length === 0) return "No sync conflicts detected."

        const lines = [
          `## Sync Conflicts (${conflicts.length})`,
          "",
        ]

        for (const c of conflicts) {
          lines.push(`- **Node:** ${c.node_id}`)
          lines.push(`  **Field:** ${c.field}`)
          lines.push(`  **Local:** ${JSON.stringify(c.local_value)}`)
          lines.push(`  **Remote:** ${JSON.stringify(c.remote_value)}`)
          lines.push("")
        }

        lines.push("Use `sdd.merge_graphs` to resolve conflicts.")
        return lines.join("\n")
      },
    }),

    "sdd.merge_graphs": tool({
      description: "Merge local and remote graphs using a merge strategy.",
      args: {
        remote_graph_path: tool.schema.string().describe("Path to the remote graph YAML file"),
        auto_resolve: tool.schema.boolean().optional().describe("Auto-resolve using field priorities (default: false)"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        try {
          const remoteGraph = readJson<KnowledgeGraph>(args.remote_graph_path)

          // Detect conflicts first using resolveConflict for detailed reporting
          const conflicts = detectConflicts(graph, args.remote_graph_path)
          const resolvedConflicts = conflicts.map(c => resolveConflict(c, "local"))

          const strategy = {
            auto_resolve: args.auto_resolve ?? false,
            field_priorities: {} as Record<string, "local" | "remote">,
          }

          const merged = mergeGraphs(graph, remoteGraph, strategy)

          repo.saveGraph(merged)
          invalidateCacheForMutation(ctx.directory, [...new Set(merged.nodes.map(n => n.type))], [...new Set(merged.relationships.map(r => r.type))])

          const nodeCount = merged.nodes.length - graph.nodes.length
          const lines = [
            `## Graph Merge Complete`,
            `- **Local nodes:** ${graph.nodes.length}`,
            `- **Remote nodes:** ${remoteGraph.nodes.length}`,
            `- **Merged nodes:** ${merged.nodes.length}`,
            `- **New nodes added:** ${nodeCount}`,
          ]

          if (resolvedConflicts.length > 0) {
            lines.push("")
            lines.push(`### Conflicts Resolved (${resolvedConflicts.length})`)
            for (const c of resolvedConflicts.slice(0, 10)) {
              lines.push(`- **${c.node_id}** (${c.field}): resolved as ${c.resolution}`)
            }
            if (resolvedConflicts.length > 10) {
              lines.push(`- ... and ${resolvedConflicts.length - 10} more`)
            }
          }

          return lines.join("\n")
        } catch (e) {
          return `Error merging graphs: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

    "sdd.load_permissions_config": tool({
      description: "View the current permissions configuration (roles, approval requirements).",
      args: {},
      async execute(_args, ctx) {
        const config = loadPermissions(ctx.directory)
        const lines = [
          "## Permissions Configuration",
          "",
          "### Roles",
        ]

        for (const role of config.roles) {
          lines.push(`\n**${role.role}** (max approvals: ${role.max_approvals}):`)
          for (const perm of role.permissions) {
            lines.push(`  - ${perm}`)
          }
        }

        lines.push("\n### Approval Requirements")
        for (const [type, count] of Object.entries(config.approval_requirements)) {
          lines.push(`- **${type}:** ${count} approval(s)`)
        }

        return lines.join("\n")
      },
    }),

    "sdd.check_change_approval": tool({
      description: "Check if a user has the required approval permission for a specific change type.",
      args: {
        change_type: tool.schema.string().describe("Change type (feature, requirement, architecture_component, constraint, decision, constitution)"),
        user: tool.schema.string().describe("Username to check"),
      },
      async execute(args, ctx) {
        const role = getUserRoleWithAuth(ctx.directory, args.user)
        const approved = checkChangeApproval(args.change_type, role, ctx.directory)
        const required = getRequiredApprovals(args.change_type, ctx.directory)

        return [
          `## Change Approval Check`,
          `**User:** ${args.user} (${role})`,
          `**Change Type:** ${args.change_type}`,
          `**Required Approvals:** ${required}`,
          `**Has Permission:** ${approved ? "✅ YES" : "❌ NO"}`,
        ].join("\n")
      },
    }),

    "sdd.save_permissions_config": tool({
      description: "Save a custom permissions configuration.",
      args: {
        config_json: tool.schema.string().describe("PermissionConfig as JSON (roles, approval_requirements)"),
      },
      async execute(args, ctx) {
        try {
          const config = JSON.parse(args.config_json)
          savePermissions(ctx.directory, config)
          return "✅ Permissions configuration saved."
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

    "sdd.get_user_role": tool({
      description: "Get a user's role, checking local config and remote (GitHub/GitLab) permissions.",
      args: {
        user: tool.schema.string().describe("Username"),
      },
      async execute(args, ctx) {
        const role = getUserRoleWithAuth(ctx.directory, args.user)
        const localRole = getUserRole(ctx.directory, args.user)
        const remoteUser = fetchRemoteUser(ctx.directory, args.user)

        const lines = [
          `## User Role: ${args.user}`,
          `**Effective Role:** ${role}`,
          `**Local Role:** ${localRole}`,
        ]

        if (remoteUser) {
          lines.push(`**Remote Provider:** ${remoteUser.login}`)
          lines.push(`**Remote Permissions:** admin=${remoteUser.permissions.admin}, push=${remoteUser.permissions.push}, pull=${remoteUser.permissions.pull}`)
        }

        return lines.join("\n")
      },
    }),

    "sdd.analyze_codebase": tool({
      description: "Analyze the project codebase and create FileNode/SymbolNode entries in the Knowledge Graph.",
      args: {},
      async execute(_args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."

        const graph = repo.loadGraph()
        const result = analyzeCodebase(graph, ctx.directory)
        repo.saveGraph(graph)
        invalidateCacheForMutation(ctx.directory, ["file", "symbol"], ["contains"])

        return [
          `## Codebase Analysis Complete`,
          `**Files Analyzed:** ${result.files_analyzed}`,
          `**Symbols Found:** ${result.symbols_found}`,
          "",
          "FileNode and SymbolNode entries have been added to the Knowledge Graph.",
          "Use `sdd.query_graph` to inspect the new nodes.",
        ].join("\n")
      },
    }),

    "sdd.start_dashboard": tool({
      description: "Start the SDD Knowledge Graph dashboard server with a 3D visualization UI.",
      args: {},
      async execute(_args, ctx) {
        const dashboard = new SddDashboardServer(ctx.directory)
        try {
          const port = await dashboard.start()
          return [
            `## SDD Dashboard Started`,
            `**URL:** http://127.0.0.1:${port}`,
            "",
            "Open the URL in a browser to view the Knowledge Graph visualization.",
            "The dashboard auto-refreshes every 5 seconds.",
          ].join("\n")
        } catch (e) {
          return `Error starting dashboard: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

    "sdd.mcp_server_info": tool({
      description: "Get MCP server configuration and available tools for the SDD project.",
      args: {},
      async execute(_args, ctx) {
        const mcp = createMcpServer(ctx.directory)
        const tools = mcp.getTools()

        const lines = [
          `## SDD MCP Server`,
          `**Name:** ${mcp.config.name}`,
          `**Version:** ${mcp.config.version}`,
          `**Description:** ${mcp.config.description}`,
          "",
          `### Available MCP Tools (${tools.length})`,
        ]

        for (const t of tools) {
          lines.push(`- **${t.name}:** ${t.description}`)
        }

        return lines.join("\n")
      },
    }),

    "sdd.handle_mcp_tool": tool({
      description: "Execute an MCP tool call against the SDD MCP server.",
      args: {
        tool_name: tool.schema.string().describe("MCP tool name (sdd_get_quality, sdd_get_drift, sdd_get_validation, sdd_get_handoff)"),
      },
      async execute(args, ctx) {
        const mcp = createMcpServer(ctx.directory)
        const result = await mcp.handleToolCall(args.tool_name, {})
        if ("error" in result) return `Error: ${result.error}`
        const content = (result as { content: Array<{ type: string; text: string }> }).content
        return content?.map(c => c.text).join("\n") || "No output"
      },
    }),

    "sdd.toggle_status": tool({
      description: "Check the current SDD toggle status.",
      args: {},
      async execute(_args, ctx) {
        const state = getToggleState(ctx.directory)
        const status = state.enabled ? "🟢 ON" : "🔴 OFF"
        return [
          `## SDD Toggle Status`,
          `**Status:** ${status}`,
          `**Last Changed:** ${state.changed_at}`,
          "",
          "Commands: `/sdd on`, `/sdd off`, `/sdd status`",
        ].join("\n")
      },
    }),

    "sdd.list_snapshots": tool({
      description: "List all SDD snapshots available for rollback.",
      args: {},
      async execute(_args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."

        const snapshots = repo.listSnapshots()
        if (snapshots.length === 0) return "No snapshots found."

        const lines = [`## Snapshots (${snapshots.length})\n`]
        for (const snap of snapshots) {
          lines.push(`- ${snap}`)
        }
        return lines.join("\n")
      },
    }),

    "sdd.build_graph": tool({
      description:
        "Build a complete SDD Knowledge Graph from a project briefing. " +
        "Analyzes the briefing text and automatically creates ALL necessary nodes: " +
        "features, entities, endpoints, business rules, architecture components, " +
        "decisions, and requirements. Then connects them with relationships. " +
        "This is the PRIMARY tool for bootstrapping a project specification. " +
        "Use this INSTEAD of generating markdown documentation files. " +
        "PROVIDE analysis_json WHEN POSSIBLE: The agent should analyze the briefing using its own intelligence "
        + "and pass a structured JSON with features, entities, endpoints, businessRules, architectureComponents, "
        + "decisions, requirements, relationships, domains, and techStack. This produces FAR richer graphs "
        + "than regex-based extraction. Without analysis_json, falls back to regex (lower quality).",
      args: {
        briefing: tool.schema.string().describe("Complete project briefing text to analyze and build graph from"),
        analysis_json: tool.schema.string().optional().describe(
          'Structured analysis JSON from LLM. Schema: { features: [{name, description, priority, phase?}], ' +
          'entities: [{name, description, fields: [{name, type, required?, unique?}]}], ' +
          'endpoints: [{method, path, description, relatedEntity?}], ' +
          'businessRules: [{name, description, relatedFeature?}], ' +
          'architectureComponents: [{name, layer, technology, description}], ' +
          'decisions: [{title, context, decision, consequences}], ' +
          'requirements: [{name, description, type, priority, acceptanceCriteria: [string]}], ' +
          'relationships: [{from, to, type}], domains: [string], techStack: {layer: technology} }. '
          + 'The agent MUST analyze the briefing deeply and provide this for maximum graph quality.'
        ),
        force: tool.schema.boolean().optional().describe("Force rebuild even if graph already has nodes"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) {
          // Auto-initialize if not done yet
          const projectId = "project"
          repo.createProject(projectId, "Project", "Auto-initialized from briefing")
        }

        const graph = repo.loadGraph()

        // Check if graph already has significant content
        if (!args.force && graph.nodes.length > 20) {
          const indices = repo.getIndices()
          const hasFeatures = indices.byType.has("feature")
          const hasEntities = indices.byType.has("entity")
          if (hasFeatures && hasEntities) {
            return [
              "## Graph Already Populated",
              `Graph has ${graph.nodes.length} nodes with features and entities.`,
              "",
              "Use `force=true` to rebuild from scratch, or use individual tools to add/update nodes.",
              "Use `sdd.inspect` to see current graph state.",
            ].join("\n")
          }
        }

        // Import analysis and graph builder
        const { analyzeBriefingDeep, formatDeepAnalysis } = await import("../sdd/discovery/briefing-analyzer.js")
        const { buildGraphFromAnalysis } = await import("../sdd/discovery/graph-builder.js")

        // Use LLM-provided analysis if available, otherwise fall back to regex
        let analysis
        let analysisSource: string = "unknown"
        if (args.analysis_json) {
          try {
            analysis = JSON.parse(args.analysis_json)
            // Validate required fields
            if (!analysis.features || !Array.isArray(analysis.features)) throw new Error("Missing or invalid 'features' array")
            if (!analysis.entities || !Array.isArray(analysis.entities)) throw new Error("Missing or invalid 'entities' array")
            if (!analysis.endpoints || !Array.isArray(analysis.endpoints)) throw new Error("Missing or invalid 'endpoints' array")
            if (!analysis.businessRules || !Array.isArray(analysis.businessRules)) throw new Error("Missing or invalid 'businessRules' array")
            if (!analysis.architectureComponents || !Array.isArray(analysis.architectureComponents)) throw new Error("Missing or invalid 'architectureComponents' array")
            if (!analysis.decisions || !Array.isArray(analysis.decisions)) throw new Error("Missing or invalid 'decisions' array")
            if (!analysis.requirements || !Array.isArray(analysis.requirements)) throw new Error("Missing or invalid 'requirements' array")
            // Ensure optional fields have defaults
            if (!analysis.relationships) analysis.relationships = []
            if (!analysis.domains) analysis.domains = []
            if (!analysis.techStack) analysis.techStack = {}
            analysisSource = "LLM (intelligent extraction)"
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e)
            return "Error parsing analysis_json: " + errMsg + "\n\nFalling back to regex-based analysis."
          }
        }

        if (!analysis) {
          analysis = analyzeBriefingDeep(args.briefing)
          analysisSource = "regex (automatic extraction — lower quality)"
        }

        const buildResult = buildGraphFromAnalysis(graph, analysis)

        // Save the graph
        repo.saveGraph(graph)
        invalidateCacheForMutation(ctx.directory, [...new Set(graph.nodes.map(n => n.type))], [...new Set(graph.relationships.map(r => r.type))])

        // Build comprehensive response
        const lines = [
          buildResult.summary,
          "",
          `**Analysis source:** ${analysisSource}`,
          "",
          "### Analysis Preview",
          formatDeepAnalysis(analysis),
          "",
          "### What happened",
          "All specification data has been stored in the Knowledge Graph (.sdd/).",
          "Do NOT create markdown files for this specification.",
          "Use sdd.query_graph, sdd.inspect, and sdd.get_context to read the specification.",
        ]

        return lines.join("\n")
      },
    }),

    // ── NEW TOOLS: Drift Signals, Graph Pruning, Conventions ────────

    "sdd.drift_signals": tool({
      description:
        "Detect advanced drift signals: mutant duplicates (near-identical files), " +
        "architecture violations, pattern fragmentation, and temporal volatility.",
      args: {},
      async execute(_args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const signals = detectAllSignals(graph, ctx.directory)
        return formatDriftSignals(signals)
      },
    }),

    "sdd.graph_health": tool({
      description:
        "Analyze graph health using indices: orphan nodes, disconnected components, " +
        "god nodes, type distribution, and relationship density.",
      args: {},
      async execute(_args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const indices: GraphIndices = repo.getIndices()

        const lines = ["## Graph Health Report\n"]

        // Type distribution
        lines.push("### Type Distribution")
        const sortedTypes = [...indices.byType.entries()]
          .sort(([, a], [, b]) => b.length - a.length)
        for (const [type, nodes] of sortedTypes.slice(0, 10)) {
          lines.push(`- **${type}:** ${nodes.length}`)
        }
        if (sortedTypes.length > 10) lines.push(`- ... and ${sortedTypes.length - 10} more types`)
        lines.push("")

        // Orphan nodes (no relationships)
        const orphanCount = graph.nodes.filter(
          n => !graph.relationships.some(r => r.from === n.id || r.to === n.id)
        ).length
        lines.push(`### Orphan Nodes: ${orphanCount}`)

        // God nodes (high connectivity)
        const relCounts = new Map<string, number>()
        for (const rel of graph.relationships) {
          relCounts.set(rel.from, (relCounts.get(rel.from) || 0) + 1)
          relCounts.set(rel.to, (relCounts.get(rel.to) || 0) + 1)
        }
        const godThreshold = Math.max(20, graph.nodes.length * 0.15)
        const godNodes = [...relCounts.entries()]
          .filter(([, count]) => count > godThreshold)
          .map(([id, count]) => ({ id, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5)

        if (godNodes.length > 0) {
          lines.push("")
          lines.push("### God Nodes (high connectivity)")
          for (const gn of godNodes) {
            const node = indices.byId.get(gn.id)
            lines.push(`- **${node?.name || gn.id}** (${node?.type || "?"}): ${gn.count} relationships`)
          }
        }

        // Relationship density
        const avgRels = graph.nodes.length > 0
          ? (graph.relationships.length / graph.nodes.length).toFixed(2)
          : "0"
        lines.push("")
        lines.push(`### Relationship Density: ${avgRels} rels/node`)
        lines.push(`**Total:** ${graph.nodes.length} nodes, ${graph.relationships.length} relationships`)

        return lines.join("\n")
      },
    }),

    "sdd.graph_health_detail": tool({
      description:
        "Detailed graph health analysis using computeGraphHealth: stale changes, cycles, " +
        "god nodes, orphan changes, and draft endpoints. Provides actionable health indicators.",
      args: {},
      async execute(_args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const health = computeGraphHealth(graph)

        const lines = ["## Detailed Graph Health Report\n"]

        // Stale changes
        lines.push(`### Stale Changes: ${health.staleChanges}`)
        if (health.staleChangeIds.length > 0) {
          for (const id of health.staleChangeIds.slice(0, 10)) {
            lines.push(`- ${id}`)
          }
          if (health.staleChangeIds.length > 10) lines.push(`- ... and ${health.staleChangeIds.length - 10} more`)
        } else {
          lines.push("No stale changes.")
        }
        lines.push("")

        // Cycles
        lines.push(`### Cycles Detected: ${health.cyclesDetected}`)
        if (health.cyclesDetected > 0) {
          lines.push("⚠️ Circular dependencies detected in the graph.")
        } else {
          lines.push("No cycles detected.")
        }
        lines.push("")

        // God nodes
        lines.push(`### God Nodes: ${health.godNodes.length}`)
        if (health.godNodes.length > 0) {
          for (const gn of health.godNodes.slice(0, 5)) {
            lines.push(`- **${gn.name}** (${gn.id}): ${gn.relCount} relationships`)
          }
          if (health.godNodes.length > 5) lines.push(`- ... and ${health.godNodes.length - 5} more`)
        } else {
          lines.push("No god nodes detected.")
        }
        lines.push("")

        // Orphan changes
        lines.push(`### Orphan Changes: ${health.orphanChanges}`)
        if (health.orphanChanges > 0) {
          lines.push("⚠️ Some changes are not connected to any feature or entity.")
        }
        lines.push("")

        // Draft endpoints
        lines.push(`### Draft Endpoints: ${health.draftEndpoints}`)
        if (health.draftEndpoints > 0) {
          lines.push("⚠️ Some endpoints are still in DRAFT status.")
        }

        return lines.join("\n")
      },
    }),

    "sdd.graph_prune": tool({
      description:
        "Prune obsolete nodes from the SDD graph: dead file references, orphaned symbols, " +
        "old completed changes, and duplicate relationships.",
      args: {},
      async execute(_args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const { pruneGraph, formatPruneReport } = await import("../sdd/graph/pruner.js")
        const report = pruneGraph(graph, ctx.directory)
        repo.saveGraph(graph)
        invalidateCacheForMutation(ctx.directory, [...new Set(graph.nodes.map(n => n.type))], [...new Set(graph.relationships.map(r => r.type))])
        return formatPruneReport(report)
      },
    }),

    "sdd.migrate_storage": tool({
      description:
        "Migrate SDD storage between YAML and SQLite backends. " +
        "SQLite is recommended for projects with 1000+ nodes.",
      args: {
        target: tool.schema.enum(["yaml", "sqlite"]).describe("Target storage backend"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."

        const currentType = repo.getStorageType()
        if (currentType === args.target) {
          return `Already using ${args.target} storage.`
        }

        const graph = repo.loadGraph()
        const newRepo = repo.migrateTo(args.target as "yaml" | "sqlite", ctx.directory)

        return [
          `## Storage Migration Complete`,
          `- **From:** ${currentType}`,
          `- **To:** ${args.target}`,
          `- **Nodes:** ${graph.nodes.length}`,
          `- **Relationships:** ${graph.relationships.length}`,
        ].join("\n")
      },
    }),

    "sdd.detect_conventions": tool({
      description:
        "Detect project coding conventions (naming, imports, async patterns, structure) " +
        "by analyzing existing source files.",
      args: {},
      async execute(_args, ctx) {
        const { detectConventions, formatConventions } = await import("../sdd/code-quality/conventions.js")
        const conventions = detectConventions(ctx.directory)
        return formatConventions(conventions)
      },
    }),

    "sdd.learn_patterns": tool({
      description:
        "Analyze the SDD graph to learn project patterns: common node defaults, " +
        "relationship patterns, naming conventions, and approval history.",
      args: {
        action: tool.schema.enum(["learn", "show", "suggest"]).describe("learn: analyze graph, show: display patterns, suggest: get suggestions for new node"),
        node_type: tool.schema.string().optional().describe("Node type for suggestions (with action=suggest)"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const { learnPatterns, formatPatterns, loadPatterns, savePatterns, getSuggestedDefaults, getSuggestedRelationships, getSuggestedNaming } = await import("../sdd/patterns/learner.js")

        if (args.action === "learn") {
          const patterns = learnPatterns(graph)
          savePatterns(ctx.directory, patterns)
          return formatPatterns(patterns)
        }

        if (args.action === "show") {
          const patterns = loadPatterns(ctx.directory)
          if (!patterns) return "No patterns learned yet. Run with action=learn first."
          return formatPatterns(patterns)
        }

        if (args.action === "suggest") {
          if (!args.node_type) return "node_type is required for suggest action."
          const patterns = loadPatterns(ctx.directory)
          if (!patterns) return "No patterns learned yet. Run with action=learn first."
          const defaults = getSuggestedDefaults(patterns, args.node_type as any)
          const rels = getSuggestedRelationships(patterns, args.node_type as any)
          const naming = getSuggestedNaming(patterns, args.node_type as any)
          const lines = [
            `## Suggestions for ${args.node_type}`,
            "",
            "### Default Metadata",
            Object.keys(defaults).length > 0 ? JSON.stringify(defaults, null, 2) : "No defaults learned.",
            "",
            "### Suggested Relationships",
          ]
          for (const r of rels) {
            lines.push(`- →[${r.relationship_type}]→ ${r.to_type}`)
          }
          if (naming) {
            lines.push("")
            lines.push(`### Naming Convention: ${naming}`)
          }
          return lines.join("\n")
        }

        return "Invalid action. Use 'learn', 'show', or 'suggest'."
      },
    }),

    "sdd.cache_stats": tool({
      description:
        "Show cache statistics: hit rates, sizes, invalidation count. " +
        "Useful for debugging cache performance.",
      args: {},
      async execute(_args, ctx) {
        const cacheMgr = getCacheManager(ctx.directory)
        const stats = cacheMgr.getStats()
        const lines = [
          "## Cache Statistics",
          "",
          "### Tool Response Cache",
          `- Size: ${stats.toolCacheSize} entries`,
          `- Hit rate: ${stats.hitRate}`,
          `- Hits: ${stats.toolHits} | Misses: ${stats.toolMisses}`,
          "",
          "### Analysis Cache",
          `- Size: ${stats.analysisCacheSize} entries`,
          `- Hit rate: ${stats.analysisHitRate}`,
          `- Hits: ${stats.analysisHits} | Misses: ${stats.analysisMisses}`,
          "",
          `### Invalidation Count: ${stats.invalidations}`,
          "",
          "### Repository Info",
        ]

        const repo = getRepo(ctx.directory)
        if (repo.isInitialized()) {
          lines.push(`- Storage type: ${repo.getStorageType()}`)
          lines.push(`- Node count: ${repo.getNodeCount()}`)
          lines.push(`- Relationship count: ${repo.getRelationshipCount()}`)
        } else {
          lines.push("- SDD not initialized")
        }

        return lines.join("\n")
      },
    }),

    // ── Drift Whitelist Tools ───────────────────────────────────────

    "sdd.whitelist_drift": tool({
      description:
        "Add a file or pattern to the drift whitelist. Whitelisted files will NOT be reported as drift. " +
        "Use this to suppress false positives for legitimate architectural decisions.",
      args: {
        file_path: tool.schema.string().describe("File path or pattern (e.g., 'src/validators/*') to whitelist"),
        reason: tool.schema.string().describe("Why this file is whitelisted (e.g., 'Unified schema.sql pattern')"),
      },
      async execute(args, ctx) {
        const { addToDriftWhitelist, loadDriftWhitelist } = await import("../sdd/drift/exclusion.js")
        addToDriftWhitelist(ctx.directory, args.file_path, args.reason)
        const whitelist = loadDriftWhitelist(ctx.directory)
        return [
          `✅ File whitelisted: \`${args.file_path}\``,
          `**Reason:** ${args.reason}`,
          `**Total whitelisted:** ${whitelist.entries.length} files/patterns`,
        ].join("\n")
      },
    }),

    "sdd.unwhitelist_drift": tool({
      description: "Remove a file from the drift whitelist.",
      args: {
        file_path: tool.schema.string().describe("File path to remove from whitelist"),
      },
      async execute(args, ctx) {
        const { removeFromDriftWhitelist } = await import("../sdd/drift/exclusion.js")
        removeFromDriftWhitelist(ctx.directory, args.file_path)
        return `✅ Removed from whitelist: \`${args.file_path}\``
      },
    }),

    "sdd.list_whitelist": tool({
      description: "List all files/patterns in the drift whitelist.",
      args: {},
      async execute(_args, ctx) {
        const { loadDriftWhitelist } = await import("../sdd/drift/exclusion.js")
        const whitelist = loadDriftWhitelist(ctx.directory)

        if (whitelist.entries.length === 0) {
          return "Whitelist is empty. Use `sdd.whitelist_drift` to add entries."
        }

        const lines = [`## Drift Whitelist (${whitelist.entries.length})\n`]
        for (const entry of whitelist.entries) {
          lines.push(`- **${entry.file_path}** — ${entry.reason}`)
          if (entry.added_by) lines.push(`  Added by: ${entry.added_by}`)
          lines.push(`  Added at: ${entry.added_at}`)
          lines.push("")
        }
        return lines.join("\n")
      },
    }),

    // ── Auto-Link Tests ─────────────────────────────────────────────

    "sdd.auto_link_tests": tool({
      description:
        "Automatically link orphan tests to requirements based on name matching, " +
        "import analysis, and file relationships. Creates tested_by relationships in the graph.",
      args: {
        dry_run: tool.schema.boolean().optional().describe("Preview links without creating them (default: false)"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        const { calculateCoverage } = await import("../sdd/coverage/tracker.js")
        const coverage = calculateCoverage(graph)

        // Filter orphan tests that have inferred requirements
        const linkableOrphans = coverage.orphan_tests.filter(t => t.inferred_requirement_id)

        if (linkableOrphans.length === 0) {
          return [
            "## Auto-Link Tests",
            "",
            `**Orphan tests:** ${coverage.orphan_tests.length}`,
            `**Linkable (inferred):** 0`,
            "",
            "No orphan tests could be automatically linked to requirements.",
            "Try running `sdd.analyze_codebase` first to create FileNode/SymbolNode entries.",
          ].join("\n")
        }

        if (args.dry_run) {
          const lines = [
            "## Auto-Link Tests (Dry Run)",
            "",
            `**Orphan tests:** ${coverage.orphan_tests.length}`,
            `**Linkable (inferred):** ${linkableOrphans.length}`,
            "",
            "### Would create these relationships:\n",
          ]
          for (const orphan of linkableOrphans) {
            lines.push(`- ${orphan.test_id} --[tested_by]--> ${orphan.inferred_requirement_id}`)
            lines.push(`  Method: ${orphan.inferred_by}`)
          }
          lines.push("")
          lines.push("Run without `dry_run=true` to create the relationships.")
          return lines.join("\n")
        }

        // Create the relationships
        let linked = 0
        const errors: string[] = []

        for (const orphan of linkableOrphans) {
          const relId = `rel-${orphan.test_id}-tested-by-${orphan.inferred_requirement_id}`
          const exists = graph.relationships.some(
            r => r.from === orphan.inferred_requirement_id && r.to === orphan.test_id && r.type === "tested_by"
          )
          if (exists) continue

          try {
            graph.relationships.push({
              id: relId,
              from: orphan.inferred_requirement_id!,
              to: orphan.test_id,
              type: "tested_by",
              metadata: { inferred: true, method: orphan.inferred_by },
            })
            linked++
          } catch (e) {
            errors.push(`Failed to link ${orphan.test_id}: ${e}`)
          }
        }

        if (linked > 0) {
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["requirement", "test"], ["tested_by"])
        }

        const lines = [
          "## Auto-Link Tests Complete",
          "",
          `**Links created:** ${linked}`,
          `**Already linked:** ${linkableOrphans.length - linked}`,
          `**Remaining orphans:** ${coverage.orphan_tests.length - linkableOrphans.length}`,
        ]

        if (errors.length > 0) {
          lines.push("")
          lines.push(`**Errors:** ${errors.length}`)
          for (const err of errors) lines.push(`- ${err}`)
        }

        return lines.join("\n")
      },
    }),

    // ── Composite Tools (Item 5: Redução de Tools) ─────────────────
    "sdd.graph_mutation": createGraphMutationTool(),
    "sdd.graph_query": createGraphQueryTool(),
    "sdd.traverse": createTraverseTool(),
    "sdd.permissions": createPermissionsTool(),
    "sdd.snapshot": createSnapshotTool(),
    "sdd.sync": createSyncTool(),
    "sdd.graph_admin": createGraphAdminTool(),
    "sdd.code_quality": createCodeQualityTool(),
    "sdd.enterprise": createEnterpriseTool(),
    "sdd.drift_whitelist": createDriftWhitelistTool(),

    // ── Workflow Chains (Item 4: Orquestração) ──────────────────────
    ...createWorkflowTools(),
  }
}
