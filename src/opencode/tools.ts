import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { createRepository, loadSddConfig, type GraphRepository } from "../sdd/persistence/repository.js"
import { addRelationship, getNeighbors } from "../sdd/graph/engine.js"
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
import {
  createGraph,
  getNode,
  addNode,
  getNodeIndexed,
  getOutgoingIndexed,
  getIncomingIndexed,
  searchNodesIndexed,
  getGraphStatsIndexed,
} from "../sdd/graph/engine.js"



import {
  TASK_COLUMN_LABELS,
  TASK_COLUMNS,
  buildIntegrationBrief,
  createTask as createBoardTask,
  getPendingIntegrationTasks,
  isTaskColumn,
  listTasks,
  markTaskIntegrated,
  removeTask as removeBoardTask,
  updateTask as updateBoardTask,
} from "../sdd/tasks/board.js"
import { formatOpenChangeResult, openChangeForTask } from "../sdd/tasks/change-bridge.js"
import { computeImpact } from "../sdd/graph/traverse.js"
import { analyzeBriefing, generateDiscoveryQuestions, updateGraphFromAnswers, formatDiscoverySummary, generatePurposeQuestion } from "../sdd/discovery/briefing.js"
import { createChange, classifyApprovalLevel, approveChange, getPendingChanges, failChange, getChangeHistory, formatImpactReport, preflightChangeScope, checkSpecEvidence } from "../sdd/changes/manager.js"
import { validateGraph, formatValidationResult } from "../sdd/validation/validator.js"
import { detectDrift, formatDriftReport } from "../sdd/drift/detector.js"
import { buildSddContextPack } from "./system-prompt.js"
import { generateProject, writeGeneratedFiles, detectTechStack, type GeneratedFile } from "../sdd/codegen/generator.js"
import { enforceSddFirst, classifyChangeRequest, buildEnforcementPrompt, getSddEnforcementRules } from "../sdd/enforcement/interceptor.js"
import { isSddEnabled, setToggleState, getToggleState } from "../sdd/toggle/state.js"
import { join as joinPath } from "path"
import { validateAgainstConstitution, formatConstitutionResult } from "../sdd/constitution/validator.js"
import { extractPromises, getPromiseReport, verifyPromise, markPromiseViolated, formatPromiseReport } from "../sdd/promises/tracker.js"
import { findUnverifiablePromises } from "../sdd/promises/classifier.js"
import { calculateQualityScore, formatQualityReport } from "../sdd/quality/scorer.js"
import { generateHandoff, formatHandoffPack, saveSessionLog } from "../sdd/session/handoff.js"
import { detectAntiPatterns, formatAntiPatterns } from "../sdd/patterns/anti-patterns.js"
import { detectAstClones, formatCloneReport } from "../sdd/patterns/ast-clones.js"
import { detectContradictions, formatContradictionReport } from "../sdd/patterns/contradictions.js"
import { calculateCoverage, formatCoverageReport } from "../sdd/coverage/tracker.js"


import { generateShellHooks, formatShellHookResult } from "./shell-hooks.js"
import { scanExistingProject, formatBrownfieldAnalysis } from "../sdd/brownfield/scanner.js"
import { reverseEngineerProject } from "../sdd/brownfield/reverse-engineer.js"
import { detectBrownfieldFindings, findingFingerprint, formatFindingsReport, getFindings, resolveFinding, transitionFinding, upsertFinding, createFindingTask, type FindingInput } from "../sdd/brownfield/findings.js"
import { generateCicd, writeCicdFiles, formatCicdResults } from "../sdd/cicd/generators.js"


import { addAuditEntry, checkPermission, detectRemote, formatRemoteStatus, getUserRoleWithAuth, type Permission } from "../sdd/permissions/access.js"

import { createMcpServer } from "../mcp/server.js"
import { startSharedDashboard, getSharedDashboardUrl, resolveDashboardPort } from "../server/server.js"

import type { KnowledgeGraph, AnyNode, ConstitutionNode, ChangeNode, Transaction, FindingStatus, FindingNode } from "../sdd/domain/types.js"
import { getCacheManager } from "../sdd/cache/manager.js"
import { markEnforced, markApproved, markValidated, markCompleted, resetWorkflowState, workflowScope, renewWorkflow, workflowRemainingMs, workflowTtlMs } from "../sdd/enforcement/workflow-tracker.js"
import { validateSmart, type SmartValidationOptions } from "../sdd/validation/smart-validator.js"
import { validateExecutableProject, validateFunctionalEvidence, saveExecutableValidation, loadExecutableValidation, isExecutableValidationCurrent, computeScopedFileHashes, verifyScopedFiles } from "../sdd/validation/executable.js"
import { getTelemetrySummary, recordFeedback, recordTelemetry } from "../sdd/monitoring/telemetry.js"
import { ValidationIndex } from "../sdd/validation/coverage-index.js"
import { detectAllSignals, formatDriftSignals } from "../sdd/drift/signals.js"
import { sddDebug } from "../sdd/log.js"
import { TransactionManager, reconcileChangeTransactions } from "../sdd/transactions/manager.js"

import { createWorkflowTools } from "./workflows/tools-workflow.js"
import { graphFingerprint } from "../sdd/cache/fingerprint.js"
import { projectPath } from "../sdd/security/paths.js"
import { AcceptanceService, checkChangeAcceptance, materializeLegacyAcceptanceCriteria, updateAcceptanceCriterionText } from "../sdd/acceptance/service.js"
import { analyzeNodeImpact, formatNodeImpact } from "../sdd/impact/service.js"
import { analyzeGuidance, applyGuidancePatch, createGuidance, proposeGuidancePatch, rejectGuidance } from "../sdd/guidance/service.js"

// ── Validation Coverage Index (singleton per session) ──────────────
const validationIndex = new ValidationIndex()

// ── Repository cache ────────────────────────────────────────────────
// A single createRepository() decision per directory per process lifetime.
// The backend (yaml vs sqlite) never changes mid-session unless an explicit
// migration tool runs; at that point invalidateCachedRepo() is called so the
// next getRepo() re-evaluates with the updated sentinel.
const repoCache = new Map<string, GraphRepository>()
// Keeps the briefing available between sdd.discover and sdd.update_from_answers
// in the same OpenCode process. The update tool also accepts briefing
// explicitly, so the workflow remains correct across process/session restarts.
const discoveryBriefings = new Map<string, string>()

function getRepo(directory: string): GraphRepository {
  const cached = repoCache.get(directory)
  if (cached) return cached
  const repo = createRepository(directory)
  repoCache.set(directory, repo)
  if (repo.isInitialized()) {
    try {
      const graph = repo.loadGraph()
      if (reconcileChangeTransactions(directory, graph)) repo.saveGraph(graph)
    } catch (error) {
      sddDebug("tools", `Legacy state reconciliation skipped: ${String(error)}`)
    }
  }
  return repo
}

/** Persist the complete Change → file → spec/test trace for generated code. */
function recordGeneratedArtifacts(graph: KnowledgeGraph, files: GeneratedFile[], changeId?: string): void {
  const change = changeId ? graph.nodes.find((node) => node.id === changeId && node.type === "change") as ChangeNode | undefined : undefined
  const affectedSpecIds = new Set(change?.metadata.affected_nodes || [])
  const now = new Date().toISOString()
  for (const file of files) {
    const fileId = `${graph.project_id}-FILE-${file.path.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 30)}`
    const existing = graph.nodes.find((node) => node.id === fileId)
    if (!existing) {
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
    }
    if (change) {
      try { addRelationship(graph, change.id, fileId, "modifies", { source: "codegen", path: file.path }) } catch {}
      change.metadata.affected_files = [...new Set([...(change.metadata.affected_files || []), file.path])]
    }
    for (const targetId of affectedSpecIds) {
      const target = graph.nodes.find((node) => node.id === targetId)
      if (!target || !["feature", "requirement", "use_case", "business_rule", "flow"].includes(target.type)) continue
      try { addRelationship(graph, fileId, targetId, "implements", { source: "codegen", change_id: change?.id }) } catch {}
    }
    if (/\btest[s]?\b|\.spec\.|\.test\./i.test(file.path)) {
      const testId = `${graph.project_id}-TEST-${file.path.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 30)}`
      if (!graph.nodes.some((node) => node.id === testId)) {
        addNode(graph, {
          id: testId,
          type: "test",
          name: file.path,
          description: file.description,
          status: "IMPLEMENTED",
          version: 1,
          metadata: {
            test_type: "integration",
            target: file.path,
            verifies: [
              ...affectedSpecIds,
              ...[...affectedSpecIds]
                .filter((id) => graph.nodes.some((node) => node.id === id && node.type === "requirement"))
                .flatMap((id) => new AcceptanceService(graph).list(id, false).map((criterion) => criterion.id)),
            ],
          },
          created_at: now,
          updated_at: now,
        } as any)
      }
      for (const targetId of affectedSpecIds) {
        const target = graph.nodes.find((node) => node.id === targetId)
        if (!target || !["feature", "requirement", "use_case"].includes(target.type)) continue
        try { addRelationship(graph, targetId, testId, "tested_by", { source: "codegen", change_id: change?.id }) } catch {}
      }
      if (change) {
        try { addRelationship(graph, change.id, testId, "creates", { source: "codegen" }) } catch {}
      }
    }
  }
  if (change) change.updated_at = now
}

/** Call after any operation that changes the active storage backend. */
export function invalidateCachedRepo(directory: string): void {
  repoCache.delete(directory)
}

function advanceChangeTransaction(projectDir: string, changeId: string, target: "SPEC_UPDATED" | "IMPLEMENTING" | "IMPLEMENTED" | "VERIFYING" | "COMPLETED"): void {
  const manager = new TransactionManager(projectDir)
  const transaction = manager.getTransactionsForChange(changeId)[0]
  if (!transaction) return
  const order: Transaction["status"][] = ["PLANNED", "SPEC_UPDATED", "IMPLEMENTING", "IMPLEMENTED", "VERIFYING", "COMPLETED"]
  const currentIndex = order.indexOf(transaction.status)
  const targetIndex = order.indexOf(target)
  if (currentIndex < 0 || targetIndex <= currentIndex) return
  for (let index = currentIndex + 1; index <= targetIndex; index++) {
    manager.advanceStatus(transaction.id, order[index])
  }
}

function loadOrEmpty(directory: string): KnowledgeGraph {
  const repo = getRepo(directory)
  if (repo.isInitialized()) return repo.loadGraph()
  return createGraph("pending")
}

function ensureTargetRequirementForFinding(graph: KnowledgeGraph, finding: AnyNode): AnyNode {
  const existing = graph.nodes.find((node) =>
    node.type === "requirement" && (node.metadata as Record<string, unknown>).source_finding_id === finding.id,
  )
  if (existing) return existing

  const meta = finding.metadata as Record<string, any>
  const now = new Date().toISOString()
  const requirement: AnyNode = {
    id: `${graph.project_id}-REQ-FND-${finding.id.slice(-12)}`,
    type: "requirement",
    name: `Comportamento alvo: ${meta.title ?? finding.name}`,
    description: meta.target_behavior ?? meta.expected_behavior ?? meta.observed_behavior ?? finding.description,
    status: "DRAFT",
    version: 1,
    metadata: {
      priority: meta.severity ?? "medium",
      req_type: "non_functional",
      source_finding_id: finding.id,
      source_purpose: "reverse_engineering",
      evidence: (meta.evidence ?? []).map((e: Record<string, unknown>) => ({
        source: String(e.path ?? e.detector ?? "brownfield_scan"),
        excerpt: e.excerpt,
        confidence: e.confidence,
        confirmed: true,
      })),
    },
    created_at: now,
    updated_at: now,
  } as AnyNode
  addNode(graph, requirement)
  const acceptanceService = new AcceptanceService(graph)
  acceptanceService.create(requirement.id, "O comportamento alvo não reproduz a limitação observada na origem.", "reverse_engineering")
  acceptanceService.create(requirement.id, "A decisão possui teste ou evidência verificável.", "reverse_engineering")
  try { addRelationship(graph, requirement.id, finding.id, "derived_from", { source: "reverse_engineering" }) } catch {}
  return requirement
}

function materializeBrownfieldFindings(
  graph: KnowledgeGraph,
  inputs: FindingInput[],
  purpose: "documentation" | "reverse_engineering",
): { created: number; tasks: number; resolvedForTarget: number } {
  let created = 0
  let tasks = 0
  let resolvedForTarget = 0

  for (const input of inputs) {
    const fingerprint = input.fingerprint ?? findingFingerprint(input)
    const wasExisting = graph.nodes.some((node) => node.type === "finding" && (node.metadata as Record<string, unknown>).fingerprint === fingerprint)
    const finding = upsertFinding(graph, input)
    if (!wasExisting) created++

    if (purpose === "documentation") {
      const task = createFindingTask(graph, finding, { purpose })
      if (task) tasks++
      continue
    }

    const targetRequirement = ensureTargetRequirementForFinding(graph, finding)
    const existingResolution = finding.metadata.resolution
    if (!existingResolution || !["resolved", "closed", "accepted", "wont_fix"].includes(finding.status)) {
      resolveFinding(graph, {
        findingId: finding.id,
        description: `Convertido em requisito do sistema alvo: ${targetRequirement.id}. O sistema novo deve tratar explicitamente essa descoberta.`,
        status: "resolved",
        targetNodeIds: [targetRequirement.id],
        evidence: [{ kind: "node", node_id: targetRequirement.id, detector: "reverse_engineering_target" }],
        actor: "sdd.reverse_engineer",
      })
      resolvedForTarget++
    }
    const task = createFindingTask(graph, finding, { purpose, targetNodeId: targetRequirement.id })
    if (task) tasks++
  }

  const metadata = graph.metadata as Record<string, unknown>
  metadata.brownfield_findings = {
    last_scan_at: new Date().toISOString(),
    purpose,
    total: getFindings(graph).filter((finding) => finding.metadata.purpose === purpose).length,
    open: getFindings(graph).filter((finding) => finding.metadata.purpose === purpose && !["resolved", "closed", "accepted", "wont_fix"].includes(finding.status)).length,
    resolved: getFindings(graph).filter((finding) => finding.metadata.purpose === purpose && ["resolved", "closed", "accepted", "wont_fix"].includes(finding.status)).length,
  }
  return { created, tasks, resolvedForTarget }
}

function attachResponseCache(tools: Record<string, ToolDefinition>): Record<string, ToolDefinition> {
  const cacheable = new Set(["sdd.validate", "sdd.quality", "sdd.detect_drift", "sdd.coverage", "sdd.contradictions"])
  for (const toolName of cacheable) {
    const definition = tools[toolName] as any
    if (!definition || typeof definition.execute !== "function") continue
    const originalExecute = definition.execute
    definition.execute = async (args: Record<string, unknown>, ctx: { directory: string }) => {
      let repo: GraphRepository | null = null
      try {
        repo = getRepo(ctx.directory)
        if (repo.isInitialized()) {
          const manager = getCacheManager(ctx.directory)
          const cached = manager.getToolResponse(toolName, args, graphFingerprint(repo.loadGraph()))
          if (cached !== null) return cached
        }
      } catch {
        repo = null
      }
      const response = await originalExecute(args, ctx)
      if (typeof response === "string" && repo?.isInitialized()) {
        try {
          getCacheManager(ctx.directory).setToolResponse(toolName, args, response, graphFingerprint(repo.loadGraph()))
        } catch (error) { sddDebug("tools", `Failed to cache response for ${toolName}`) }
      }
      return response
    }
  }
  return tools
}

/**
 * Condições obrigatórias para concluir um Change (trava B).
 *
 * Devolve a lista de condições que FALHARAM, cada uma com o motivo acionável,
 * em vez de um único "BLOCKED" genérico — o agente precisa saber o que corrigir.
 */
function completionGateFailures(projectDir: string, graph: KnowledgeGraph, changeId: string): string[] {
  const failures: string[] = []
  const execution = loadExecutableValidation(projectDir, changeId)
  if (!execution) {
    return ["No verification report for this Change. Run `sdd.verify_implementation` after the last code change."]
  }
  if (!execution.verified) {
    failures.push("Executable verification did not pass (or was not explicitly waived for a project with no declared script).")
  }
  if (execution.functional_verified !== true) {
    const gaps = execution.functional_gaps?.length ? ` Gaps: ${execution.functional_gaps.join(" ")}` : ""
    failures.push(`Requirement→test evidence is unsatisfied.${gaps}`)
  }
  if (!execution.passed) failures.push("At least one verification check failed.")
  if (!isExecutableValidationCurrent(projectDir, execution)) {
    failures.push("The project changed after verification (fingerprint mismatch). Re-run `sdd.verify_implementation`.")
  }
  failures.push(...verifyScopedFiles(projectDir, execution).gaps)
  const spec = checkSpecEvidence(graph, changeId)
  if (!spec.allowed) failures.push(spec.reason)
  const config = loadSddConfig(projectDir)
  if (config.acceptance.enabled && config.acceptance.require_before_change_completion) {
    const acceptance = checkChangeAcceptance(graph, changeId, { allowWaived: config.acceptance.allow_waived, legacyFallback: config.acceptance.legacy_fallback })
    if (!acceptance.allowed) failures.push(acceptance.reason)
  }
  return failures
}

/**
 * Invalidate cache for specific node types after a mutation.
 */
export function invalidateCacheForMutation(directory: string, nodeTypes: string[], relTypes: string[] = []): void {
  try {
    const cacheMgr = getCacheManager(directory)
    cacheMgr.invalidatePartial(nodeTypes, relTypes)
  } catch (error) { sddDebug("tools", "Failed to invalidate cache after mutation") }
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

/**
 * All SDD tools.
 */
function createAllTools(): Record<string, ToolDefinition> {
  const tools: Record<string, ToolDefinition> = {
    "sdd.acceptance": tool({
      description: "Centralized acceptance criteria service backed by the Knowledge Graph.",
      args: {
        action: tool.schema.enum(["list", "summary", "create", "accept", "reject", "waive", "reopen", "accept_all", "update_text", "migrate"]),
        requirement_id: tool.schema.string().optional().describe("Requirement ID"),
        criterion_id: tool.schema.string().optional().describe("Acceptance criterion ID"),
        text: tool.schema.string().optional().describe("Criterion text"),
        observation: tool.schema.string().optional().describe("Observation or reason"),
        evidence_json: tool.schema.string().optional().describe("Evidence array as JSON"),
        expected_version: tool.schema.number().optional().describe("Expected criterion version"),
        expected_hash: tool.schema.string().optional().describe("Expected criterion content hash"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const service = new AcceptanceService(graph, loadSddConfig(ctx.directory).acceptance.legacy_fallback)
        const actor = process.env.USER || process.env.USERNAME || "current"
        const evidence = args.evidence_json ? (() => { try { return JSON.parse(args.evidence_json!) } catch { return undefined } })() : undefined
        const input = { actor, observation: args.observation, evidence, expected_version: args.expected_version, expected_hash: args.expected_hash }
        try {
          const requiredPermission: Permission | undefined = args.action === "create" || args.action === "update_text" || args.action === "migrate"
            ? "create_requirement"
            : args.action === "accept" || args.action === "accept_all"
              ? "accept_requirement"
              : args.action === "reject"
                ? "reject_requirement"
                : args.action === "waive"
                  ? "waive_requirement"
                  : args.action === "reopen"
                    ? "reopen_requirement"
                    : undefined
          if (requiredPermission && !checkPermission(getUserRoleWithAuth(ctx.directory, actor), requiredPermission, ctx.directory)) {
            addAuditEntry(ctx.directory, actor, `acceptance.${args.action}`, args.criterion_id || args.requirement_id || "unknown", "denied", `Missing permission ${requiredPermission}`)
            return `Permission denied: ${requiredPermission}`
          }
          if (args.action === "migrate") {
            const result = materializeLegacyAcceptanceCriteria(graph)
            repo.saveGraph(graph)
            invalidateCacheForMutation(ctx.directory, ["acceptance_criterion", "requirement"], ["has_acceptance_criterion"])
            return `Acceptance migration complete: ${result.created} created, ${result.linked} linked, ${result.unresolved.length} unresolved task(s).`
          }
          if (args.action === "list" || args.action === "summary") {
            if (!args.requirement_id) return "requirement_id is required"
            if (args.action === "summary") return JSON.stringify(service.summary(args.requirement_id), null, 2)
            const criteria = service.list(args.requirement_id)
            return criteria.length === 0 ? "No acceptance criteria found." : criteria.map((criterion) => `${criterion.id} [${criterion.status}] v${criterion.metadata.criterion_version}: ${criterion.metadata.text}`).join("\n")
          }
          if (args.action === "create") {
            if (!args.requirement_id || !args.text) return "requirement_id and text are required"
            const criterion = service.create(args.requirement_id, args.text)
            repo.saveGraph(graph)
            invalidateCacheForMutation(ctx.directory, ["acceptance_criterion"], ["has_acceptance_criterion"])
            return `Acceptance criterion created: ${criterion.id}`
          }
          if (args.action === "update_text") {
            if (!args.criterion_id || !args.text) return "criterion_id and text are required"
            const criterion = updateAcceptanceCriterionText(graph, args.criterion_id, args.text, { actor, observation: args.observation })
            repo.saveGraph(graph)
            invalidateCacheForMutation(ctx.directory, ["acceptance_criterion"], [])
            return `Acceptance criterion ${criterion.id} updated to version ${criterion.metadata.criterion_version} and returned to PENDING.`
          }
          if (args.action === "accept_all") {
            if (!args.requirement_id) return "requirement_id is required"
            const result = service.acceptAll(args.requirement_id, input)
            repo.saveGraph(graph)
            for (const event of result.audit) addAuditEntry(ctx.directory, actor, `acceptance.${event.action}`, event.criterion_id, "allowed", JSON.stringify(event))
            invalidateCacheForMutation(ctx.directory, ["acceptance_criterion"], [])
            return JSON.stringify(result, null, 2)
          }
          if (!args.criterion_id) return "criterion_id is required"
          const result = args.action === "accept"
            ? service.accept(args.criterion_id, input)
            : args.action === "reject"
              ? service.reject(args.criterion_id, input)
              : args.action === "waive"
                ? service.waive(args.criterion_id, input)
                : service.reopen(args.criterion_id, input)
          repo.saveGraph(graph)
          addAuditEntry(ctx.directory, actor, `acceptance.${result.audit.action}`, args.criterion_id, "allowed", JSON.stringify(result.audit))
          invalidateCacheForMutation(ctx.directory, ["acceptance_criterion"], [])
          return `${args.criterion_id} -> ${result.criterion.status}`
        } catch (error) {
          return `Error: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    }),

    "sdd.impact": tool({
      description: "Analyze bidirectional and semantic impact of changing any graph node.",
      args: {
        node_id: tool.schema.string().describe("Source node ID"),
        depth: tool.schema.number().optional().describe("Maximum traversal depth"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        try { return formatNodeImpact(analyzeNodeImpact(repo.loadGraph(), args.node_id, args.depth || 5)) }
        catch (error) { return `Error: ${error instanceof Error ? error.message : String(error)}` }
      },
    }),

    "sdd.node_guidance": tool({
      description: "Record human guidance for any graph node, analyze impact, propose and apply validated updates.",
      args: {
        action: tool.schema.enum(["create", "analyze", "propose", "apply", "reject"]),
        node_id: tool.schema.string().optional().describe("Target node ID for create"),
        guidance_id: tool.schema.string().optional().describe("Guidance node ID"),
        instruction: tool.schema.string().optional().describe("Human instruction"),
        proposal_json: tool.schema.string().optional().describe("Structured proposal JSON"),
        expected_target_version: tool.schema.number().optional().describe("Expected target version"),
        resolution: tool.schema.string().optional().describe("Rejection resolution"),
        depth: tool.schema.number().optional().describe("Impact depth"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const actor = process.env.USER || process.env.USERNAME || "current"
        try {
          const requiredPermission: Permission = args.action === "apply" ? "apply_node_guidance" : "guide_node"
          if (!checkPermission(getUserRoleWithAuth(ctx.directory, actor), requiredPermission, ctx.directory)) {
            addAuditEntry(ctx.directory, actor, `guidance.${args.action}`, args.guidance_id || args.node_id || "unknown", "denied", `Missing permission ${requiredPermission}`)
            return `Permission denied: ${requiredPermission}`
          }
          if (args.action === "create") {
            if (!args.node_id || !args.instruction) return "node_id and instruction are required"
            const guidance = createGuidance(graph, args.node_id, { instruction: args.instruction, requested_by: actor })
            repo.saveGraph(graph)
            invalidateCacheForMutation(ctx.directory, ["guidance"], ["guides"])
            return `Guidance created: ${guidance.id}`
          }
          if (!args.guidance_id) return "guidance_id is required"
          if (args.action === "analyze") {
            const result = analyzeGuidance(graph, args.guidance_id, args.depth || 5)
            repo.saveGraph(graph)
            invalidateCacheForMutation(ctx.directory, ["guidance"], [])
            return formatNodeImpact(result.impact)
          }
          if (!args.proposal_json && (args.action === "propose" || args.action === "apply")) return "proposal_json is required"
          const proposal = args.proposal_json ? JSON.parse(args.proposal_json) as Record<string, unknown> : {}
          if (args.action === "propose") {
            const guidance = proposeGuidancePatch(graph, args.guidance_id, proposal)
            repo.saveGraph(graph)
            return `Guidance ${guidance.id} now has a PROPOSED update.`
          }
          if (args.action === "apply") {
            const result = applyGuidancePatch(graph, args.guidance_id, proposal, actor, args.expected_target_version)
            repo.saveGraph(graph)
            invalidateCacheForMutation(ctx.directory, [result.target.type, "guidance"], [])
            addAuditEntry(ctx.directory, actor, "guidance.apply", result.target.id, "allowed", JSON.stringify(proposal))
            return `Guidance applied to ${result.target.id}; version ${result.target.version}.`
          }
          const guidance = rejectGuidance(graph, args.guidance_id, actor, args.resolution || "Rejected by user")
          repo.saveGraph(graph)
          return `Guidance ${guidance.id} rejected.`
        } catch (error) {
          return `Error: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    }),

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
          const andResults = indices.searchAllTokens(new Set(queryWords.map(w => w.toLowerCase())))
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
        "to the system specification. Automatically performs impact analysis. " +
        "Requires `affected_files`: without them the write hook rejects every Write/Edit for this Change.",
      args: {
        title: tool.schema.string().describe("Change title"),
        reason: tool.schema.string().describe("Reason for the change"),
        affected_node_ids: tool.schema.string().optional().describe("Comma-separated list of affected node IDs"),
        affected_files: tool.schema.string().optional().describe("Comma-separated file paths this change will write (include files to be created)"),
        affected_tests: tool.schema.string().optional().describe("Comma-separated test node IDs covering this change"),
        no_requirement_impact: tool.schema.boolean().optional().describe("Set true when the change alters no specified behaviour (no requirement node affected)"),
        acknowledge_no_files: tool.schema.boolean().optional().describe("Explicitly create the Change without affected_files (recorded for audit; Write/Edit will stay blocked)"),
        new_nodes_json: tool.schema.string().optional().describe("JSON array of new nodes to create"),
        modified_nodes_json: tool.schema.string().optional().describe('JSON array of {id, updates} for modified nodes'),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        const affectedIds = args.affected_node_ids
          ? args.affected_node_ids.split(",").map((s) => s.trim()).filter(Boolean)
          : []

        const affectedFiles = args.affected_files
          ? args.affected_files.split(",").map((s) => s.trim()).filter(Boolean)
          : []
        const affectedTests = args.affected_tests
          ? args.affected_tests.split(",").map((s) => s.trim()).filter(Boolean)
          : []

        // ── Preflight (G3): sem affected_files o Change é inutilizável ──
        if (affectedFiles.length === 0 && args.acknowledge_no_files !== true) {
          return [
            `## Change NOT created — scope incomplete`,
            "",
            "`affected_files` is empty. The write hook only allows Write/Edit on files covered by an approved Change, so a Change without files can never release implementation.",
            "",
            "Re-run with `affected_files` (comma-separated paths, including files you are about to create).",
            "If this change genuinely writes no file (documentation-only, graph-only), pass `acknowledge_no_files=true` to record that decision.",
          ].join("\n")
        }

        let newNodes: Partial<AnyNode>[] = []
        if (args.new_nodes_json) {
          try { newNodes = JSON.parse(args.new_nodes_json) } catch { return "Invalid JSON in new_nodes_json" }
        }

        let modifiedNodes: Array<{ id: string; updates: Partial<AnyNode> }> = []
        if (args.modified_nodes_json) {
          try { modifiedNodes = JSON.parse(args.modified_nodes_json) } catch { return "Invalid JSON in modified_nodes_json" }
        }

        const proposal = {
          title: args.title,
          reason: args.reason,
          affected_node_ids: affectedIds,
          new_nodes: newNodes,
          modified_nodes: modifiedNodes,
          removed_node_ids: [],
          affected_files: affectedFiles,
          affected_tests: affectedTests,
          implementation_tasks: [],
          no_requirement_impact: args.no_requirement_impact === true,
          files_scope_acknowledged: args.acknowledge_no_files === true,
        }

        const change = createChange(graph, proposal)

        repo.saveGraph(graph)
        invalidateCacheForMutation(ctx.directory, ["change"], ["created_by"])

        // Create a transaction to track this change lifecycle
        const txManager = new TransactionManager(ctx.directory)
        const tx = txManager.createTransaction(change.id)
        change.metadata.transaction_id = tx.id
        change.updated_at = new Date().toISOString()
        repo.saveGraph(graph)

        const approvalLevel = classifyApprovalLevel(proposal, graph)

        const preflight = preflightChangeScope(graph, change.id)
        const lines = [
          `Change created: **${change.id}**: ${args.title}`,
          `**Approval Level:** ${approvalLevel}`,
          `**Status:** ${change.status}`,
          `**Transaction:** ${tx.id}`,
          `**Affected files:** ${affectedFiles.length > 0 ? affectedFiles.join(", ") : "(none declared)"}`,
          "",
          approvalLevel === "APPROVAL"
            ? "⚠️ This change requires explicit approval before implementation."
            : approvalLevel === "REVIEW"
              ? "This change should be reviewed before implementation."
              : "This change can proceed automatically.",
        ]
        if (preflight.warnings.length > 0) {
          lines.push("", "### ⚠️ Preflight warnings")
          for (const warning of preflight.warnings) lines.push(`- ${warning}`)
        }
        if (args.acknowledge_no_files === true && affectedFiles.length === 0) {
          lines.push("", "⚠️ `acknowledge_no_files=true` recorded: Write/Edit remain blocked for this Change.")
        }
        return lines.join("\n")
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
        const repo = getRepo(_ctx.directory)
        if (!repo.isInitialized()) {
          // Discovery must be usable as the first tool in a brand-new project.
          // The graph is initialized before answers are collected so the next
          // step can persist them instead of losing them to an uninitialized
          // repository.
          repo.createProject("project", "Project", args.briefing, "greenfield")
        }
        discoveryBriefings.set(_ctx.directory, args.briefing)

        const analysis = analyzeBriefing(args.briefing)
        let questions = generateDiscoveryQuestions(analysis)

        // Adaptive discovery: filter out questions already answered by graph
        try {
          if (repo.isInitialized()) {
            const graph = repo.loadGraph()
            const { filterAlreadyAnswered, generateGapQuestions } = await import("../sdd/discovery/adaptive.js")
            const filteredQuestions = filterAlreadyAnswered(questions, graph)
            const gapQuestions = generateGapQuestions(graph)
            questions = [...filteredQuestions, ...gapQuestions]
          }
        } catch (error) { sddDebug("tools", "Discovery adaptive filtering failed") }

        // Mandatory purpose question for brownfield projects
        try {
          const purposeQuestion = generatePurposeQuestion(_ctx.directory)
          if (purposeQuestion) {
            // Insert as FIRST question — highest priority
            questions.unshift(purposeQuestion)
          }
        } catch (error) { sddDebug("tools", "Purpose question generation failed") }

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
        lines.push("Chame `sdd.update_from_answers` com o JSON de respostas e o briefing completo para reconstruir a especificação e gerar as tasks.")
        lines.push("Inclua também `briefing` com o texto original desta chamada.")
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
        briefing: tool.schema
          .string()
          .optional()
          .describe("Briefing original usado no sdd.discover; necessário para reconstruir o grafo e gerar tasks"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) {
          if (!args.briefing) return "SDD not initialized. Provide briefing or run sdd.initialize first."
          repo.createProject("project", "Project", args.briefing, "greenfield")
        }
        const graph = repo.loadGraph()

        let answers: Record<string, string>
        try {
          answers = JSON.parse(args.answers_json)
        } catch {
          return "Invalid JSON in answers_json"
        }

        updateGraphFromAnswers(graph, answers, {
          executionId: ctx.messageID,
          sessionId: ctx.sessionID,
          source: "sdd.update_from_answers",
        })

        const briefing = args.briefing?.trim() || discoveryBriefings.get(ctx.directory)
        let buildSummary = ""
        if (briefing) {
          const confirmedAnswers = Object.entries(answers)
            .map(([question, answer]) => `- ${question}: ${answer}`)
            .join("\n")
          const enrichedBriefing = [
            briefing,
            confirmedAnswers ? "\n## Confirmed discovery decisions\n" + confirmedAnswers : "",
          ].join("\n")
          const { analyzeBriefingDeep, formatDeepAnalysis } = await import("../sdd/discovery/briefing-analyzer.js")
          const { buildGraphFromAnalysis } = await import("../sdd/discovery/graph-builder.js")
          const enrichedAnalysis = analyzeBriefingDeep(enrichedBriefing)
          const buildResult = buildGraphFromAnalysis(graph, enrichedAnalysis)
          buildSummary = `\n${buildResult.summary}\n\n${formatDeepAnalysis(enrichedAnalysis)}`
          discoveryBriefings.delete(ctx.directory)
        }

        repo.saveGraph(graph)
        invalidateCacheForMutation(ctx.directory, [...new Set(graph.nodes.map((node) => node.type))], [...new Set(graph.relationships.map((relationship) => relationship.type))])

        return `Graph updated with ${Object.keys(answers).length} answers.${buildSummary}\n\nUse sdd.inspect and sdd.query_graph to inspect the generated specification and tasks.`
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
          const cached = cacheMgr.getAnalysisResult("validate", graphFingerprint(graph))
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
          projectDir: ctx.directory,
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
          markValidated(workflowScope(ctx.directory, ctx.sessionID))
        }

        // Cache the result
          cacheMgr.setAnalysisResult("validate", formatted, graphFingerprint(graph))
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
          const cached = cacheMgr.getAnalysisResult("drift", graphFingerprint(graph))
        if (cached) return cached as string

        const result = detectDrift(graph, ctx.directory)
        const formatted = formatDriftReport(result)

        // Cache the result
          cacheMgr.setAnalysisResult("drift", formatted, graphFingerprint(graph))

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
        const { getLastConflictResolution } = await import("../sdd/persistence/repository.js")
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
        
        // 2. Storage backend state
        const yamlPath = join(ctx.directory, ".sdd", "graph.yaml")
        const dbPath = join(ctx.directory, ".sdd", "graph.db")
        const sentinelPath = join(ctx.directory, ".sdd", "storage-backend")
        const yamlBakPath = join(ctx.directory, ".sdd", "graph.yaml.bak")

        const hasSentinel = existsSync(sentinelPath)
        const hasYaml = existsSync(yamlPath)
        const hasDb = existsSync(dbPath)
        const hasBak = existsSync(yamlBakPath)

        lines.push(`\n## Storage Backend`)
        lines.push(`- sentinel (storage-backend): ${hasSentinel ? require("fs").readFileSync(sentinelPath, "utf-8").trim() : "absent"}`)
        lines.push(`- graph.yaml: ${hasYaml ? "present" : "absent"}`)
        lines.push(`- graph.db: ${hasDb ? "present" : "absent"}`)
        lines.push(`- graph.yaml.bak: ${hasBak ? "present (archive — do not read or delete)" : "absent"}`)

        // Ambiguous state: both files exist without sentinel
        if (hasYaml && hasDb && !hasSentinel) {
          lines.push(`\n### ⚠️ Ambiguous State Detected`)
          lines.push(`Both graph.yaml and graph.db exist without a sentinel file.`)
          lines.push(`The plugin performed an intelligent analysis to determine the active backend:`)

          const conflict = getLastConflictResolution()
          if (conflict) {
            lines.push(`- **Active backend chosen:** ${conflict.winner.toUpperCase()}`)
            lines.push(`- **Reason:** ${conflict.reason}`)
            lines.push(`- The sentinel has been written. This analysis will not run again.`)
          } else {
            // Trigger the resolution now so the sentinel is written and we can report it
            const { createRepository } = await import("../sdd/persistence/repository.js")
            createRepository(ctx.directory)
            const resolved = getLastConflictResolution()
            if (resolved) {
              lines.push(`- **Active backend chosen:** ${resolved.winner.toUpperCase()}`)
              lines.push(`- **Reason:** ${resolved.reason}`)
              lines.push(`- The sentinel has been written. This analysis will not run again.`)
            } else {
              lines.push(`- Resolution was already cached from a prior call. Run sdd.inspect to confirm the active backend.`)
            }
          }
          issues.push("Ambiguous backend state (both graph.yaml and graph.db existed without sentinel) — now resolved")
        } else if (hasYaml && hasDb && hasSentinel) {
          // Both exist but sentinel is present — old yaml is a leftover from a
          // pre-Fix1 migration (rename didn't happen). Not dangerous but worth noting.
          const activeSentinel = require("fs").readFileSync(sentinelPath, "utf-8").trim()
          if (activeSentinel === "sqlite") {
            lines.push(`\n### ℹ️ Stale graph.yaml detected`)
            lines.push(`graph.yaml exists alongside graph.db, but sentinel correctly points to SQLite.`)
            lines.push(`The graph.yaml is a leftover from a pre-v2 migration and is no longer the active backend.`)
            lines.push(`It can be manually renamed to graph.yaml.bak for archival if desired.`)
          }
        } else if (hasDb && !hasYaml) {
          lines.push(`- ✅ SQLite-only project (clean state)`)
        } else if (hasYaml && !hasDb) {
          lines.push(`- ✅ YAML-only project (clean state)`)
        }

        // 3. Check for missing priority fields (using active backend only)
        try {
          const repo = createRepository(ctx.directory)
          if (repo.isInitialized()) {
            lines.push(`\n## Active Backend: ${repo.getStorageType().toUpperCase()}`)
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
      description: "Approve a pending change in the SDD graph. Refuses a Change with no affected_files unless acknowledge_no_files is set, because such a Change can never release a Write/Edit.",
      args: {
        change_id: tool.schema.string().describe("Change node ID (e.g., CHG-001)"),
        acknowledge_no_files: tool.schema.boolean().optional().describe("Approve even though the Change declares no affected_files (recorded for audit)"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        // ── Preflight (G3): aprovar um Change sem escopo de arquivos trava a
        // escrita para sempre. Aprovação é o gate, então o bloqueio fica aqui. ──
        const preflight = preflightChangeScope(graph, args.change_id)
        if (preflight.blockers.length > 0 && args.acknowledge_no_files !== true) {
          try {
            addAuditEntry(ctx.directory, process.env.USER || process.env.USERNAME || "current", "sdd.approve_change", args.change_id, "denied", "Change declares no affected_files")
          } catch (error) { sddDebug("tools", `Failed to audit preflight denial for ${args.change_id}`) }
          return [
            `## Approval BLOCKED: ${args.change_id} has no declared scope`,
            "",
            ...preflight.blockers.map((blocker) => `- ${blocker}`),
            ...preflight.warnings.map((warning) => `- ${warning}`),
            "",
            "Fix: start the Change again with `sdd.enforce` / `sdd.create_change` passing `affected_files`.",
            "Or pass `acknowledge_no_files=true` to approve anyway (audited) — Write/Edit will stay blocked for this Change.",
          ].join("\n")
        }

        const acceptanceConfig = loadSddConfig(ctx.directory).acceptance
        if (acceptanceConfig.enabled && acceptanceConfig.require_before_change_approval) {
          const acceptance = checkChangeAcceptance(graph, args.change_id, { allowWaived: acceptanceConfig.allow_waived, legacyFallback: acceptanceConfig.legacy_fallback })
          if (!acceptance.allowed) {
            return [
              `## Approval BLOCKED: ${args.change_id} has incomplete human acceptance`,
              "",
              `- ${acceptance.reason}`,
              "",
              "Accept or waive the affected criteria before approving this Change.",
            ].join("\n")
          }
        }

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
          if (args.acknowledge_no_files === true && preflight.blockers.length > 0) {
            const node = graph.nodes.find((n) => n.id === args.change_id)
            if (node) {
              node.metadata = { ...node.metadata, files_scope_acknowledged: true }
            }
          }
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change"], ["approved_by"])
          markApproved(workflowScope(ctx.directory, ctx.sessionID))

          // Advance transaction to SPEC_UPDATED.
          try { advanceChangeTransaction(ctx.directory, args.change_id, "SPEC_UPDATED") }
          catch (error) { sddDebug("tools", `Failed to advance transaction for ${args.change_id}: ${String(error)}`) }

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
            const failures = completionGateFailures(ctx.directory, graph, args.change_id)
            if (failures.length > 0) {
              return [
                `## Change ${args.change_id} Completion BLOCKED`,
                "",
                "Failing conditions:",
                ...failures.map((failure) => `- ${failure}`),
                "",
                "Fix them and retry. `force=true` is an explicit, audited override — not a shortcut.",
              ].join("\n")
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
          markCompleted(workflowScope(ctx.directory, ctx.sessionID))

          // Advance transaction to COMPLETED through every valid lifecycle edge.
          try { advanceChangeTransaction(ctx.directory, args.change_id, "COMPLETED") }
          catch (error) { sddDebug("tools", `Failed to advance transaction for ${args.change_id}: ${String(error)}`) }

          return `Change ${args.change_id} completed.`
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

    "sdd.verify_implementation": tool({
      description: "Run declared formatter, lint, typecheck, tests and git diff checks after implementation, plus the requirement→test evidence for this Change. A successful report is required before completing the Change.",
      args: {
        change_id: tool.schema.string().describe("Approved Change node ID being verified"),
        acknowledge_no_scripts: tool.schema.boolean().optional().describe("Explicitly waive executable verification when the project declares no verification script (recorded in the report)"),
        waiver_reason: tool.schema.string().optional().describe("Why executable verification is being waived (recorded in the report)"),
      },
      async execute(args, ctx) {
        const startedAt = Date.now()
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "## Executable Verification: BLOCKED\n\nSDD graph is not initialized. Run sdd.initialize first."
        const graph = repo.loadGraph()
        const change = graph.nodes.find((node) => node.id === args.change_id && node.type === "change") as ChangeNode | undefined
        if (!change) return `## Executable Verification: BLOCKED\n\nChange ${args.change_id} was not found in the graph.`

        const result = validateExecutableProject(ctx.directory, {
          acknowledgeNoScripts: args.acknowledge_no_scripts === true,
          waiverReason: args.waiver_reason,
        })
        const functional = validateFunctionalEvidence(graph, args.change_id)
        result.functional_verified = functional.verified
        result.functional_gaps = functional.gaps
        result.functional_applicable = functional.applicable
        result.functional_requirements = functional.requirements
        result.no_requirement_impact = change.metadata.no_requirement_impact === true
        // G6/G8: vincula o laudo aos arquivos declarados pelo Change, para que
        // a conclusão possa rejeitar arquivos não verificados ou alterados.
        result.scoped_files = computeScopedFileHashes(ctx.directory, change.metadata.affected_files || [])
        saveExecutableValidation(ctx.directory, args.change_id, result)
        const changeMetadata = change.metadata as unknown as Record<string, unknown>
        const verificationArtifacts = Array.isArray(changeMetadata.verification_artifacts)
          ? changeMetadata.verification_artifacts as Array<Record<string, unknown>>
          : []
        verificationArtifacts.push({
          execution_id: ctx.messageID,
          recorded_at: new Date().toISOString(),
          passed: result.passed,
          verified: result.verified,
          functional_verified: result.functional_verified,
          fingerprint: result.project_fingerprint,
          scoped_files: result.scoped_files,
        })
        changeMetadata.verification_artifacts = verificationArtifacts.slice(-10)
        change.updated_at = new Date().toISOString()
        repo.saveGraph(graph)
        try { advanceChangeTransaction(ctx.directory, args.change_id, "VERIFYING") } catch (error) { sddDebug("tools", `Failed to advance verification transaction: ${String(error)}`) }
        recordTelemetry(ctx.directory, {
          name: "executable_verification",
          duration_ms: Date.now() - startedAt,
          metadata: { change_id: args.change_id, execution_id: ctx.messageID, passed: result.passed, verified: result.verified, functional_verified: result.functional_verified, waived: result.verification_waived === true },
        })

        const lines = [`## Executable Verification: ${result.passed && result.verified && result.functional_verified ? "PASSED" : "BLOCKED"}`]
        for (const check of result.checks) lines.push(`- ${check.status.toUpperCase()}: ${check.name}${check.output ? ` — ${check.output.slice(0, 300)}` : ""}`)
        if (result.verification_waived) {
          lines.push(`- ⚠️ WAIVED: ${result.waiver_reason}`)
        } else if (!result.verified) {
          lines.push("No executable verification script was available; declare project scripts (or rerun with `acknowledge_no_scripts=true` to record an audited waiver) before completing the Change.")
        }
        lines.push("", `**Requirement→test evidence:** ${functional.applicable ? (functional.verified ? (functional.requirements?.length ? `verified (${(functional.requirements || []).join(", ")})` : "verified") : "unsatisfied") : (result.no_requirement_impact ? "not applicable (declared by the Change)" : "not applicable — but must be declared")}`)
        if (!result.functional_verified) {
          lines.push("Functional evidence is incomplete:")
          for (const gap of result.functional_gaps || []) lines.push(`- ${gap}`)
        }
        const scoped = result.scoped_files || []
        lines.push("", `**Verified files:** ${scoped.length > 0 ? scoped.map((entry) => `${entry.path}${entry.sha256 ? "" : " (missing)"}`).join(", ") : "(none — write some code first and declare affected_files)"}`)
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
        const wfState = getWorkflowState(workflowScope(ctx.directory, ctx.sessionID))
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
        const validation = validateGraph(graph, undefined, ctx.directory)
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
        const targetDir = projectPath(ctx.directory, args.target_dir || ".", true)
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

        // Update graph with the complete implementation trace.
        const generatedFiles = plan.files.filter((file) => !result.conflicts.includes(file.path) && !result.errors.some((error) => error.includes(file.path)))
        recordGeneratedArtifacts(graph, generatedFiles, wfState.changeId || approvedChanges[0]?.id)

        repo.saveGraph(graph)
        try { advanceChangeTransaction(ctx.directory, wfState.changeId || approvedChanges[0]?.id || "", "IMPLEMENTED") } catch (error) { sddDebug("tools", `Failed to advance implementation transaction: ${String(error)}`) }
        invalidateCacheForMutation(ctx.directory, ["file", "test"], ["modifies", "implements", "tested_by", "creates"])

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

        if (graph.metadata.purpose === "reverse_engineering") {
          const blockers = graph.nodes.filter((node) =>
            node.type === "finding" &&
            ["critical", "high"].includes(String((node.metadata as Record<string, unknown>).severity)) &&
            !["resolved", "closed", "accepted", "wont_fix"].includes(node.status),
          )
          if (blockers.length > 0) {
            return [
              "## SDD Enforcement: BLOCKED",
              "",
              "The reverse-engineering SDD still has critical/high findings that were not converted into target decisions or requirements.",
              "Resolve them with `sdd.findings(action=\"resolve\")` or classify them as an accepted risk before implementation.",
              "",
              ...blockers.map((node) => `- ${node.id}: ${node.name}`),
            ].join("\n")
          }
        }
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

        if (result.change_id) {
          const change = graph.nodes.find((node) => node.id === result.change_id && node.type === "change") as ChangeNode | undefined
          if (change) {
            const txManager = new TransactionManager(ctx.directory)
            const linkedTransaction = change.metadata.transaction_id ? txManager.getTransaction(change.metadata.transaction_id) : null
            if (linkedTransaction?.change_id === change.id) {
              // Existing transaction is already authoritative.
            } else {
              const requestedId = change.metadata.transaction_id && !txManager.getTransaction(change.metadata.transaction_id)
                ? change.metadata.transaction_id
                : undefined
              const tx = txManager.createTransaction(change.id, requestedId)
              change.metadata.transaction_id = tx.id
              change.updated_at = new Date().toISOString()
            }
          }
        }

        repo.saveGraph(graph)
        invalidateCacheForMutation(ctx.directory, ["change"], ["created_by"])

        if (result.auto_completed) {
          if (result.change_id) markEnforced(result.change_id, workflowScope(ctx.directory, ctx.sessionID))
          return [
            `## SDD Enforcement: AUTO-APPROVED ✅`,
            `**Request Type:** ${request.type}`,
            `**Description:** ${request.description}`,
            `**Change ID:** ${result.change_id}`,
            `**Validation:** PASSED`,
            ``,
            `This is a low-risk change and was approved automatically. Implementation and explicit completion verification are still required.`,
          ].join("\n")
        }

        if (result.allowed && result.change_id) {
          markEnforced(result.change_id, workflowScope(ctx.directory, ctx.sessionID))
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

    "sdd.renew_workflow": tool({
      description:
        "Renew the validity window of the ACTIVE SDD workflow, keeping the SAME Change and its verification report. " +
        "Use this when a long task outlives the window, instead of calling sdd.enforce again (which creates a new, unrelated Change).",
      args: {
        change_id: tool.schema.string().optional().describe("Active Change ID; a different Change is refused unless it is started with sdd.enforce"),
      },
      async execute(args, ctx) {
        const scope = workflowScope(ctx.directory, ctx.sessionID)
        const result = renewWorkflow(args.change_id, scope)
        if (!result.renewed) {
          return [
            "## SDD Workflow Renewal: NOT RENEWED",
            "",
            result.reason || "Unknown reason.",
            "",
            "`sdd.enforce` starts a NEW Change; renewal only extends the workflow already in place.",
          ].join("\n")
        }
        const ttlMinutes = Math.round(workflowTtlMs() / 60000)
        const remaining = Math.round(workflowRemainingMs(scope) / 60000)
        return [
          `## SDD Workflow Renewed (${result.changeId})`,
          "",
          `**Valid again for:** ${ttlMinutes} min (${remaining} min remaining)`,
          `**Expires at:** ${result.expiresAt ? new Date(result.expiresAt).toISOString() : "n/a"}`,
          "",
          "The active Change and its verification report are preserved — re-run `sdd.verify_implementation` only if the code changed after the last verification.",
        ].join("\n")
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

        let graph = repo.loadGraph()
        const lines: string[] = []
        const request = classifyChangeRequest(args.request)

        lines.push(`## Full Cycle: ${request.type}`)
        lines.push(`**Request:** ${args.request}\n`)

        // Step 1: Enforce SDD-first
        lines.push("### Step 1: SDD Enforcement")
        const enforcement = enforceSddFirst(graph, request, { projectDir: ctx.directory })

        if (!enforcement.allowed) {
          lines.push(`❌ **BLOCKED:** ${enforcement.reason}`)
          if (enforcement.blocking_reasons) {
            for (const r of enforcement.blocking_reasons) lines.push(`- ${r}`)
          }
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change"], [])
          return lines.join("\n")
        }

        lines.push(`✅ **Change created:** ${enforcement.change_id}${enforcement.change_id && graph.nodes.find(n => n.id === enforcement.change_id)?.status === "APPROVED" ? " (AUTO-APPROVED)" : " (awaiting explicit approval)"}`)
        lines.push(enforcement.impact_summary || "")
        if (enforcement.change_id) markEnforced(enforcement.change_id, workflowScope(ctx.directory, ctx.sessionID))

        // Step 2: Update the specification from the request before validating
        // or generating code. Use the same graph-builder path exposed to the
        // user so full_cycle cannot claim to update the spec without doing it.
        lines.push("\n### Step 2: Specification Update")
        try {
          const buildTool = createAllTools()["sdd.build_graph"]
          const buildResult = await buildTool.execute({ briefing: args.request }, ctx)
          const buildText = typeof buildResult === "string" ? buildResult : JSON.stringify(buildResult)
          lines.push(buildText)
          if (/^Error|\bBLOCKED\b/i.test(buildText)) {
            repo.invalidateCache()
            return lines.join("\n")
          }
          repo.invalidateCache()
          graph = repo.loadGraph()
          const { markSpecUpdated } = await import("../sdd/enforcement/workflow-tracker.js")
          markSpecUpdated(workflowScope(ctx.directory, ctx.sessionID))
        } catch (error) {
          lines.push(`❌ Specification update failed: ${error instanceof Error ? error.message : String(error)}`)
          return lines.join("\n")
        }

        // Step 3: Validate SDD
        lines.push("\n### Step 3: SDD Validation")
          const validation = validateGraph(graph, undefined, ctx.directory)
        if (validation.valid) {
          lines.push("✅ SDD validation passed")
        } else {
          lines.push(`❌ SDD validation failed: ${validation.errors.length} errors`)
          for (const e of validation.errors) lines.push(`- [${e.code}] ${e.message}`)
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change"], [])
          return lines.join("\n")
        }

        // Explicit approval is required for REVIEW/APPROVAL changes unless
        // the caller deliberately opts into auto_approve.
        if (enforcement.change_id) {
          const change = getNode(graph, enforcement.change_id)
          if (change?.status !== "APPROVED") {
            if (args.auto_approve && request.type !== "architecture_change") {
              approveChange(graph, enforcement.change_id)
              repo.saveGraph(graph)
              markApproved(workflowScope(ctx.directory, ctx.sessionID))
            } else {
              lines.push("❌ Completion blocked: explicit Change approval is required (or set auto_approve=true for non-architecture changes).")
              repo.saveGraph(graph)
              return lines.join("\n")
            }
          }
        }

        // Step 4: Generate code plan
        lines.push("\n### Step 4: Code Generation Plan")
        const plan = generateProject(graph)
        lines.push(`Generated plan: ${plan.files.length} files to create/update`)

        // Step 5: Write code
        lines.push("\n### Step 5: Implementation")
        const writeResult = writeGeneratedFiles(ctx.directory, plan)
        const generatedFiles = plan.files.filter((file) => !writeResult.conflicts.includes(file.path) && !writeResult.errors.some((error) => error.includes(file.path)))
        recordGeneratedArtifacts(graph, generatedFiles, enforcement.change_id)
        lines.push(`Files written: ${writeResult.written}`)
        if (writeResult.conflicts.length > 0) {
          lines.push(`❌ Implementation blocked: ${writeResult.conflicts.length} existing file conflict(s)`)
          for (const conflict of writeResult.conflicts) lines.push(`- ${conflict}`)
          lines.push("Review the files and rerun generation with explicit overwrite approval.")
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change"], [])
          return lines.join("\n")
        }
        if (writeResult.errors.length > 0) {
          lines.push(`Errors: ${writeResult.errors.length}`)
          for (const err of writeResult.errors) lines.push(`  - ${err}`)
          lines.push("❌ Implementation blocked: generated files could not be written completely")
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change"], [])
          return lines.join("\n")
        }

        // Step 6: Validate implementation
        lines.push("\n### Step 6: Post-Implementation Validation")
        const postValidation = validateGraph(graph, undefined, ctx.directory)
        if (postValidation.valid) {
          lines.push("✅ Post-implementation SDD validation passed")
        } else {
          lines.push(`❌ Post-implementation validation failed: ${postValidation.errors.length} error(s)`)
          for (const error of postValidation.errors) lines.push(`- [${error.code}] ${error.message}`)
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["change"], [])
          return lines.join("\n")
        }

        // Step 6b: execute the project's declared verification pipeline.
        lines.push("\n### Step 6b: Executable Verification")
        const execution = validateExecutableProject(ctx.directory)
        const functional = enforcement.change_id
          ? validateFunctionalEvidence(graph, enforcement.change_id)
          : { verified: false, gaps: ["No active Change was identified"] }
        execution.functional_verified = functional.verified
        execution.functional_gaps = functional.gaps
        if (enforcement.change_id) saveExecutableValidation(ctx.directory, enforcement.change_id, execution)
        lines.push(execution.passed && execution.verified && execution.functional_verified
          ? "✅ All declared verification scripts passed"
          : "❌ Executable verification is incomplete or failed; Change will not be completed")

        // Step 7: Complete change (with promise check)
        if (enforcement.change_id) {
          lines.push("\n### Step 7: Change Completion")
          try {
            if (!execution.passed || !execution.verified || !execution.functional_verified) {
              lines.push("⚠️ Completion blocked: executable verification did not pass")
              for (const gap of execution.functional_gaps || []) lines.push(`- Functional evidence: ${gap}`)
              repo.saveGraph(graph)
              return lines.join("\n")
            }
            const { completeChangeWithPromiseCheck } = await import("../sdd/changes/manager.js")
            const completionResult = completeChangeWithPromiseCheck(graph, enforcement.change_id)
            if (completionResult.completed) {
              lines.push(`✅ Change ${enforcement.change_id} completed`)
              markCompleted(workflowScope(ctx.directory, ctx.sessionID))
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
        try { if (enforcement.change_id) advanceChangeTransaction(ctx.directory, enforcement.change_id, "IMPLEMENTED") } catch (error) { sddDebug("tools", `Failed to advance implementation transaction: ${String(error)}`) }
        invalidateCacheForMutation(ctx.directory, ["change"], [])

        lines.push("\n### Summary")
        lines.push(`- Change: ${enforcement.change_id}`)
        lines.push(`- Files generated: ${writeResult.written}`)
        lines.push(`- SDD valid: ${postValidation.valid}`)
        const completed = lines.some((line) => line.includes(`✅ Change ${enforcement.change_id} completed`))
        lines.push(`- Status: ${completed ? "COMPLETED" : "BLOCKED"}`)

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
        // Accept an explicit directory from the tool caller (e.g. resource call),
        // but default to the context-directory-based resolution the same way hooks do.
        const dir = (ctx as any).projectDir || ctx.directory
        const current = isSddEnabled(dir)
        const newState = args.enabled !== undefined ? args.enabled : !current
        const state = setToggleState(dir, newState)

        if (!state.enabled) {
          resetWorkflowState(workflowScope(dir, ctx.sessionID))
        }

        const togglePath = joinPath(dir, ".sdd", "enabled")
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
          `Toggle written to: ${togglePath}`,
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
        evidence_refs_json: tool.schema.string().optional().describe("JSON array of structured evidence refs: [{type:'test'|'file'|'change'|'execution',id,path?,fingerprint?,summary?}]"),
        violation_reason: tool.schema.string().optional().describe("Required explanation for a violated promise"),
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

          if (!args.evidence_refs_json) return "Error: 'evidence_refs_json' is required for verify. Link the result to a test, file, change, or execution."
          let evidenceRefs: Array<{ type: "test" | "file" | "change" | "execution"; id: string; path?: string; fingerprint?: string; summary?: string }>
          try {
            const parsed = JSON.parse(args.evidence_refs_json)
            if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((ref) => !ref || typeof ref.id !== "string" || !["test", "file", "change", "execution"].includes(ref.type))) {
              return "Error: evidence_refs_json must be a non-empty array with typed refs and ids."
            }
            evidenceRefs = parsed
          } catch {
            return "Error: invalid JSON in evidence_refs_json."
          }

          const result = verifyPromise(graph, args.promise_id, {
            evidence: args.evidence,
            evidence_refs: evidenceRefs,
            execution_id: ctx.messageID,
            project_dir: ctx.directory,
          })
          if (!result) return `Promise ${args.promise_id} not found.`
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["requirement", "business_rule"], ["promises"])
          return `Promise ${args.promise_id} marked as FULFILLED.\nEvidence: ${args.evidence}`
        }

        if (args.action === "violate") {
          if (!args.promise_id) return "Error: 'promise_id' is required for violate."
          if (!args.violation_reason) return "Error: 'violation_reason' is required for violate."

          const result = markPromiseViolated(graph, args.promise_id, args.violation_reason)
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
          const cached = cacheMgr.getAnalysisResult("quality", graphFingerprint(graph))
        if (cached) return cached as string

        const report = calculateQualityScore(graph, ctx.directory)
        const formatted = formatQualityReport(report)

        // Cache the result
          cacheMgr.setAnalysisResult("quality", formatted, graphFingerprint(graph))

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

    "sdd.findings": tool({
      description:
        "Gerenciar descobertas brownfield persistentes. No modo documentation, mantém problemas no AS-IS e cria tasks de correção; " +
        "no modo reverse_engineering, converte descobertas em requisitos do sistema alvo.",
      args: {
        action: tool.schema.enum(["scan", "list", "report", "readiness", "transition", "resolve", "create_task"]).describe("Operação sobre findings"),
        finding_id: tool.schema.string().optional().describe("ID do finding"),
        status: tool.schema.enum(["open", "triaged", "accepted", "in_progress", "resolved", "closed", "wont_fix"]).optional().describe("Novo status"),
        purpose: tool.schema.enum(["documentation", "reverse_engineering"]).optional().describe("Fluxo brownfield"),
        description: tool.schema.string().optional().describe("Descrição da resolução ou transição"),
        change_id: tool.schema.string().optional().describe("Change que resolveu o finding"),
        task_id: tool.schema.string().optional().describe("Task que resolveu ou acompanha o finding"),
        target_node_ids: tool.schema.array(tool.schema.string()).optional().describe("Nós do SDD alvo que resolvem o finding"),
        evidence: tool.schema.string().optional().describe("Evidência textual da resolução"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized. Run sdd.reverse_engineer first."
        const graph = repo.loadGraph()
        const action = args.action as string
        const purpose = (args.purpose as "documentation" | "reverse_engineering" | undefined) ?? graph.metadata.purpose ?? "documentation"

        if (action === "scan") {
          const brownfield = scanExistingProject(ctx.directory)
          const scan = detectBrownfieldFindings(ctx.directory, brownfield, purpose as "documentation" | "reverse_engineering")
          const summary = materializeBrownfieldFindings(graph, scan.findings, purpose as "documentation" | "reverse_engineering")
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["finding", "task", "requirement", "file"], ["detected_in", "tracked_by", "resolves", "derived_from"])
          return [
            `Scan completed: ${scan.findings.length} findings from ${scan.filesInspected} source files.`,
            `Created: ${summary.created}; tasks: ${summary.tasks}; converted to target requirements: ${summary.resolvedForTarget}.`,
            "",
            formatFindingsReport(graph, purpose as "documentation" | "reverse_engineering"),
          ].join("\n")
        }

        if (action === "list" || action === "report" || action === "readiness") {
          const findings = getFindings(graph).filter((finding) => finding.metadata.purpose === purpose)
          if (action === "list") return JSON.stringify(findings.map((finding) => ({ id: finding.id, title: finding.name, status: finding.status, severity: finding.metadata.severity, category: finding.metadata.category })), null, 2)
          if (action === "readiness") {
            const blockers = findings.filter((finding) =>
              !["resolved", "closed", "accepted", "wont_fix"].includes(finding.status) && ["critical", "high"].includes(finding.metadata.severity),
            )
            return [
              `Reverse-engineering readiness: ${blockers.length === 0 ? "READY" : "BLOCKED"}`,
              `Critical/high unresolved findings: ${blockers.length}`,
              ...blockers.map((finding) => `- ${finding.id}: ${finding.name}`),
              "",
              formatFindingsReport(graph, purpose as "documentation" | "reverse_engineering"),
            ].join("\n")
          }
          return formatFindingsReport(graph, purpose as "documentation" | "reverse_engineering")
        }

        if (!args.finding_id) return "`finding_id` is required for this action."
        const finding = graph.nodes.find((node) => node.id === args.finding_id && node.type === "finding")
        if (!finding) return `Finding ${args.finding_id} not found.`

        if (action === "transition") {
          if (!args.status) return "`status` is required for transition."
          transitionFinding(graph, args.finding_id, args.status as FindingStatus, args.description)
        } else if (action === "resolve") {
          if (!args.description) return "`description` is required to resolve a finding."
          resolveFinding(graph, {
            findingId: args.finding_id,
            description: args.description,
            status: (args.status as "resolved" | "closed" | "accepted" | "wont_fix" | undefined) ?? "resolved",
            changeId: args.change_id,
            taskId: args.task_id,
            targetNodeIds: args.target_node_ids,
            evidence: args.evidence ? [{ kind: "change", detector: "sdd.findings", excerpt: args.evidence }] : [],
          })
        } else if (action === "create_task") {
          createFindingTask(graph, finding as FindingNode, {
            purpose: purpose as "documentation" | "reverse_engineering",
            targetNodeId: args.target_node_ids?.[0],
          })
        } else {
          return `Unknown action ${action}.`
        }

        repo.saveGraph(graph)
        invalidateCacheForMutation(ctx.directory, ["finding", "task"], ["tracked_by", "resolves", "evidenced_by"])
        return formatFindingsReport(graph, purpose as "documentation" | "reverse_engineering")
      },
    }),

    "sdd.reverse_engineer": tool({
      description:
        "Reverse-engineer an existing codebase into a Knowledge Graph. " +
        "Use purpose='documentation' to document the system as-is with its real tech stack. " +
        "Use purpose='reverse_engineering' to create a technology-agnostic spec that captures " +
        "WHAT the system does (entities, endpoints, business rules, architecture layers) without " +
        "committing to specific frameworks — ideal for rebuilding the system with a different stack.",
      args: {
        purpose: tool.schema.enum(["documentation", "reverse_engineering"]).describe(
          "documentation = document the existing system as-is. " +
          "reverse_engineering = create a technology-agnostic spec for rebuilding elsewhere."
        ),
        depth: tool.schema.enum(["structure", "full"]).optional().describe(
          "structure = only entities, endpoints, and architecture. " +
          "full = also extract business rules and requirements. Default: full."
        ),
        focus_dirs: tool.schema.string().optional().describe(
          "Comma-separated directories to focus on (e.g., 'src/api,src/models')."
        ),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) {
          repo.createProject(
            "project",
            "Project",
            "Reverse-engineered from existing codebase",
            args.purpose as "documentation" | "reverse_engineering",
          )
        }

        const result = reverseEngineerProject(ctx.directory, {
          purpose: args.purpose as "documentation" | "reverse_engineering",
          depth: (args.depth as "structure" | "full") || "full",
          focusDirs: args.focus_dirs?.split(",").map(s => s.trim()),
        })

        // Update graph with reverse-engineered data
        const graph = repo.loadGraph()

        // Set purpose in metadata
        graph.metadata.purpose = args.purpose as "documentation" | "reverse_engineering"
        const projectNode = graph.nodes.find(n => n.type === "project")
        if (projectNode) {
          projectNode.metadata.purpose = args.purpose
        }

        // Build graph from analysis using existing graph builder
        const { buildGraphFromAnalysis } = await import("../sdd/discovery/graph-builder.js")
        buildGraphFromAnalysis(graph, result.analysis)

        // Brownfield discoveries are first-class graph records. Documentation
        // keeps them open and creates remediation tasks; reverse engineering
        // converts them into target requirements and closes the source finding
        // only after the target behaviour is represented in the SDD.
        const findingSummary = materializeBrownfieldFindings(graph, result.findings, args.purpose as "documentation" | "reverse_engineering")

        // For documentation mode: mark all spec nodes as APPROVED (they represent reality)
        if (args.purpose === "documentation") {
          for (const node of graph.nodes) {
            if (["feature", "entity", "endpoint", "architecture_component", "requirement", "business_rule", "decision"].includes(node.type) && node.status === "DRAFT") {
              node.status = "APPROVED"
            }
          }
        }

        repo.saveGraph(graph)
        invalidateCacheForMutation(ctx.directory, [...new Set(graph.nodes.map(n => n.type))], [...new Set(graph.relationships.map(r => r.type))])

        const lines = [
          result.summary,
          "",
          `### Graph Updated`,
          `- **Nodes:** ${graph.nodes.length}`,
          `- **Relationships:** ${graph.relationships.length}`,
          `- **Purpose:** ${args.purpose}`,
          `- **Findings created:** ${findingSummary.created}`,
          `- **Tasks created:** ${findingSummary.tasks}`,
          "",
          "Use `sdd.inspect` to review the graph.",
        ]

        if (args.purpose === "reverse_engineering") {
          const unresolved = getFindings(graph).filter((finding) => finding.metadata.purpose === "reverse_engineering" && !["resolved", "closed", "accepted", "wont_fix"].includes(finding.status))
          lines.push(
            "",
            "### Next Steps",
            "This is a **technology-agnostic** SDD. When using it in a new project:",
            "1. The LLM will detect `purpose: reverse_engineering` in the graph",
            "2. It will ask you to choose a tech stack (frontend, backend, database, etc.)",
            "3. Architecture components will be updated with your chosen technologies",
            `4. Reverse-engineering findings converted to target requirements: ${findingSummary.resolvedForTarget}`,
            `5. Unresolved target gaps: ${unresolved.length}`,
            "6. Then proceed with the normal SDD workflow",
          )
        }

        return lines.join("\n")
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
        writeCicdFiles(results, ctx.directory)
        return formatCicdResults(results)
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


    "sdd.start_dashboard": tool({
      description: "Start the SDD Knowledge Graph dashboard server (3D visualization UI) and return its URL. Stop it with the `/sdd viz stop` command.",
      args: {},
      async execute(_args, ctx) {
        try {
          // Servidor compartilhado: `/sdd viz` usa a mesma instância, então não
          // subimos dois servidores (com duas portas) na mesma sessão.
          const port = startSharedDashboard(ctx.directory, resolveDashboardPort())
          const url = getSharedDashboardUrl() ?? `http://127.0.0.1:${port}`
          return [
            `## SDD Dashboard Started`,
            `**URL:** ${url}`,
            "",
            "Open the URL in a browser to view the Knowledge Graph visualization.",
            "The dashboard auto-refreshes every 5 seconds.",
            "",
            "Stop it with `/sdd viz stop`.",
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
        const dir = (ctx as any).projectDir || ctx.directory
        const state = getToggleState(dir)
        const status = state.enabled ? "🟢 ON" : "🔴 OFF"
        const togglePath = joinPath(dir, ".sdd", "enabled")
        return [
          `## SDD Toggle Status`,
          `**Status:** ${status}`,
          `**Last Changed:** ${state.changed_at}`,
          `**Toggle file:** ${togglePath}`,
          "",
          "Commands: `/sdd on`, `/sdd off`, `/sdd status`",
        ].join("\n")
      },
    }),


    "sdd.build_graph": tool({
      description:
        "Build a complete SDD Knowledge Graph from a project briefing. " +
        "Analyzes the briefing text and automatically creates ALL necessary nodes: " +
        "features, entities, endpoints, business rules, architecture components, " +
        "decisions, requirements, and implementation tasks. Then connects them with relationships. " +
        "This is the direct/fallback tool for bootstrapping a project specification when discovery is not needed. " +
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
          'tasks: [{name, description, goal?, files?, acceptance?, priority?, requirement?, feature?}], ' +
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
          const hasTasks = indices.byType.has("task")
          if (hasFeatures && hasEntities && hasTasks) {
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
            if (!analysis.tasks) analysis.tasks = []
            if (!analysis.relationships) analysis.relationships = []
            if (!analysis.domains) analysis.domains = []
            if (!analysis.techStack) analysis.techStack = {}
            analysisSource = "LLM (intelligent extraction)"
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e)
            analysis = analyzeBriefingDeep(args.briefing)
            analysisSource = `regex fallback after invalid analysis_json (${errMsg})`
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
        repo.migrateTo(args.target as "yaml" | "sqlite", ctx.directory)

        // Invalidate the per-directory repo cache so every subsequent tool
        // call in this session uses the new backend immediately.
        invalidateCachedRepo(ctx.directory)

        return [
          `## Storage Migration Complete`,
          `- **From:** ${currentType}`,
          `- **To:** ${args.target}`,
          `- **Nodes:** ${graph.nodes.length}`,
          `- **Relationships:** ${graph.relationships.length}`,
        ].join("\n")
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

    "sdd.infer_relationships": tool({
      description:
        "Reconstrói a rastreabilidade do Knowledge Graph: infere arestas que a " +
        "construção por keyword deixou de fora (requirement --specifies--> feature, " +
        "endpoint/file --implements--> feature, endpoint --operates_on--> entity, " +
        "task --implements--> requirement/feature, task/change --belongs_to--> milestone), " +
        "normaliza pares inversos redundantes e garante os nós de milestone. " +
        "Idempotente e não destrutivo: use dry_run=true para revisar antes de aplicar.",
      args: {
        dry_run: tool.schema.boolean().optional().describe("Pré-visualiza as arestas sem gravá-las (default: false)"),
        min_confidence: tool.schema.number().optional().describe("Confiança mínima 0..1 (default: 0.5)"),
        include_milestones: tool.schema.boolean().optional().describe("Criar/ligar milestones (default: true)"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()

        const { inferRelationships, runRelationshipInference } = await import(
          "../sdd/discovery/relationship-inferencer.js"
        )
        const minConfidence = args.min_confidence ?? 0.5
        const includeMilestones = args.include_milestones ?? true

        if (args.dry_run) {
          const proposals = inferRelationships(graph, { minConfidence })
          const lines = [
            "## Inferência de Relacionamentos (Dry Run)",
            "",
            `**Arestas propostas:** ${proposals.length}`,
            "",
          ]
          if (proposals.length === 0) {
            lines.push("Nenhuma aresta nova a inferir — a rastreabilidade já está completa.")
            return lines.join("\n")
          }
          const byType: Record<string, number> = {}
          for (const proposal of proposals) {
            byType[proposal.type] = (byType[proposal.type] ?? 0) + 1
          }
          lines.push("### Por tipo")
          for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
            lines.push(`- **${type}:** ${count}`)
          }
          lines.push("", "### Amostra")
          for (const proposal of proposals.slice(0, 25)) {
            lines.push(
              `- ${proposal.from} --[${proposal.type}]--> ${proposal.to} ` +
                `(${proposal.method}, conf ${proposal.confidence.toFixed(2)})`,
            )
          }
          if (proposals.length > 25) lines.push(`- ... e mais ${proposals.length - 25}`)
          lines.push("", "Rode sem `dry_run` para aplicar.")
          return lines.join("\n")
        }

        const result = runRelationshipInference(graph, { minConfidence, includeMilestones })
        if (result.applied > 0 || result.normalized > 0 || result.milestones_created > 0) {
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["milestone"], Object.keys(result.by_type))
        }

        const lines = [
          "## Inferência de Relacionamentos Concluída",
          "",
          `**Arestas aplicadas:** ${result.applied}`,
          `**Inversos normalizados:** ${result.normalized}`,
          `**Milestones criados:** ${result.milestones_created}`,
          `**Ignorados:** ${result.skipped}`,
        ]
        const types = Object.entries(result.by_type).sort((a, b) => b[1] - a[1])
        if (types.length > 0) {
          lines.push("", "### Por tipo")
          for (const [type, count] of types) lines.push(`- **${type}:** ${count}`)
        }
        return lines.join("\n")
      },
    }),

    "sdd.milestone": tool({
      description:
        "Gerencia milestones (âncora de release) e gera o relatório de rastreabilidade por release. " +
        "Ações: create/list/add/remove/assign/close/report. Um milestone agrupa changes, tasks, " +
        "features e requirements; o report mostra o escopo do release, o progresso e os gaps " +
        "(requisitos sem teste, features sem implementação, endpoints/arquivos sem feature).",
      args: {
        action: tool.schema
          .enum(["create", "list", "add", "remove", "assign", "close", "report"])
          .optional()
          .describe("Operação (default: list)"),
        milestone_id: tool.schema.string().optional().describe("ID do milestone (add/remove/assign/close/report)"),
        name: tool.schema.string().optional().describe("Nome do milestone (create)"),
        release_version: tool.schema.string().optional().describe("Versão do release (create)"),
        target_date: tool.schema.string().optional().describe("Data alvo ISO YYYY-MM-DD (create)"),
        objective: tool.schema.string().optional().describe("Objetivo do milestone (create)"),
        status: tool.schema.string().optional().describe("Status do nó (create/close)"),
        node_ids: tool.schema.string().optional().describe("IDs de nós separados por vírgula (add/remove/assign)"),
        from_id: tool.schema.string().optional().describe("Milestone de origem (assign)"),
        to_id: tool.schema.string().optional().describe("Milestone de destino (assign)"),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized."
        const graph = repo.loadGraph()
        const {
          createMilestone,
          linkNodesToMilestone,
          unlinkNodesFromMilestone,
          moveNodesToMilestone,
          closeMilestone,
          getMilestoneNodes,
          buildReleaseReport,
          formatReleaseReport,
        } = await import("../sdd/release/milestone.js")

        const action = args.action ?? "list"
        const parseIds = (value?: string): string[] =>
          (value ?? "").split(",").map((v) => v.trim()).filter((v) => v.length > 0)
        const nameOf = (id: string) => graph.nodes.find((n) => n.id === id)?.name ?? id

        try {
          if (action === "create") {
            if (!args.name) return "`name` é obrigatório para create."
            const milestone = createMilestone(graph, {
              name: args.name,
              release_version: args.release_version,
              target_date: args.target_date,
              objective: args.objective,
              status: args.status as any,
            })
            repo.saveGraph(graph)
            invalidateCacheForMutation(ctx.directory, ["milestone"], ["contains"])
            return [
              "## Milestone criado",
              `**ID:** ${milestone.id}`,
              `**Nome:** ${milestone.name}`,
              milestone.metadata.release_version ? `**Release:** ${milestone.metadata.release_version}` : "",
              "",
              "Vincule changes/tasks com `sdd.milestone` action=\"add\".",
            ].filter(Boolean).join("\n")
          }

          if (action === "list") {
            const milestones = getMilestoneNodes(graph)
            if (milestones.length === 0) return "Nenhum milestone definido. Use action=\"create\"."
            const report = buildReleaseReport(graph)
            const lines = [`## Milestones (${milestones.length})\n`]
            for (const item of report.milestones) {
              const version = item.release_version ? ` · ${item.release_version}` : ""
              lines.push(`- **${item.name}**${version} [${item.status}] — ${item.counts.changes} change(s), ${item.counts.tasks} task(s), ${item.progress_percent}% concluído`)
              lines.push(`  \`${item.id}\``)
            }
            return lines.join("\n")
          }

          if (action === "add" || action === "remove") {
            if (!args.milestone_id) return "`milestone_id` é obrigatório."
            const ids = parseIds(args.node_ids)
            if (ids.length === 0) return "`node_ids` é obrigatório."
            const result = action === "add"
              ? linkNodesToMilestone(graph, args.milestone_id, ids)
              : { linked: 0, skipped: 0, not_found: [], removed: unlinkNodesFromMilestone(graph, args.milestone_id, ids) }
            repo.saveGraph(graph)
            invalidateCacheForMutation(ctx.directory, ["milestone"], ["contains", "belongs_to"])
            if (action === "add") {
              return [
                `## Milestone add`,
                `**Vinculados:** ${result.linked}`,
                `**Já vinculados:** ${result.skipped}`,
                result.not_found.length > 0 ? `**Não encontrados/não suportados:** ${result.not_found.join(", ")}` : "",
              ].filter(Boolean).join("\n")
            }
            return `## Milestone remove\n**Desvinculados:** ${(result as any).removed}`
          }

          if (action === "assign") {
            if (!args.from_id || !args.to_id) return "`from_id` e `to_id` são obrigatórios."
            const ids = parseIds(args.node_ids)
            if (ids.length === 0) return "`node_ids` é obrigatório."
            const result = moveNodesToMilestone(graph, args.from_id, args.to_id, ids)
            repo.saveGraph(graph)
            invalidateCacheForMutation(ctx.directory, ["milestone"], ["contains", "belongs_to"])
            return `## Milestone assign\n**Movidos:** ${result.linked}\n**Ignorados:** ${result.skipped}`
          }

          if (action === "close") {
            if (!args.milestone_id) return "`milestone_id` é obrigatório."
            const milestone = closeMilestone(graph, args.milestone_id, (args.status as any) ?? "COMPLETED")
            repo.saveGraph(graph)
            invalidateCacheForMutation(ctx.directory, ["milestone"], [])
            return `## Milestone encerrado\n**${milestone.name}** → ${milestone.status}`
          }

          // report
          const report = buildReleaseReport(graph, args.milestone_id)
          return formatReleaseReport(report, nameOf)
        } catch (error) {
          return `Error: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    }),

    "sdd.integrate_tasks": tool({
      description:
        "Kanban task board bridge: list tasks pending AI integration, create/update/remove tasks, " +
        "mark them as integrated once they are linked to the Knowledge Graph, and open/approve the " +
        "SDD Change that authorizes the code for a task. " +
        "Used by the dashboard workflow so a manual task becomes part of the specification and can be implemented.",
      args: {
        action: tool.schema
          .enum(["list", "create", "update", "remove", "mark_integrated", "open_change", "approve_change"])
          .optional()
          .describe(
            "Operação: list (default) | create | update | remove | mark_integrated | open_change | approve_change",
          ),
        task_id: tool.schema.string().optional().describe("ID da task (update/remove/mark_integrated)"),
        name: tool.schema.string().optional().describe("Nome da task (create/update)"),
        description: tool.schema.string().optional().describe("Descrição da task"),
        goal: tool.schema.string().optional().describe("Objetivo da task"),
        files: tool.schema.string().optional().describe("Arquivos previstos, separados por vírgula"),
        acceptance: tool.schema
          .string()
          .optional()
          .describe("Critérios de aceite, separados por ponto e vírgula ou quebra de linha"),
        column: tool.schema
          .string()
          .optional()
          .describe("Coluna do Kanban: backlog | ready | in_progress | blocked | done"),
        status: tool.schema.string().optional().describe("Status do nó (opcional)"),
        link_to: tool.schema
          .string()
          .optional()
          .describe("ID de feature/requirement para vincular a task (create)"),
        no_requirement_impact: tool.schema
          .boolean()
          .optional()
          .describe(
            "open_change/approve_change: declara que o Change não altera comportamento especificado (pula a evidência de requisito)",
          ),
      },
      async execute(args, ctx) {
        const repo = getRepo(ctx.directory)
        if (!repo.isInitialized()) return "SDD not initialized. Run sdd.initialize first."
        const graph = repo.loadGraph()
        const action = args.action || "list"

        const splitBy = (value: string | undefined, pattern: RegExp): string[] | undefined => {
          if (!value) return undefined
          const parts = value.split(pattern).map((s) => s.trim()).filter(Boolean)
          return parts.length > 0 ? parts : undefined
        }

        const formatTaskList = (): string => {
          const tasks = listTasks(graph)
          if (tasks.length === 0) return "## SDD Tasks — nenhuma task no board."
          const lines = [`## SDD Tasks (${tasks.length})`, ""]
          for (const column of TASK_COLUMNS) {
            const items = tasks.filter((t) => t.column === column)
            if (items.length === 0) continue
            lines.push(`### ${TASK_COLUMN_LABELS[column]} (${items.length})`)
            for (const task of items) {
              const flag = task.integration_status === "pending" ? " ⏳ pendente de integração" : ""
              const change = task.change_id ? ` · ${task.change_id}(${task.change_status})` : ""
              lines.push(`- ${task.id}: ${task.name}${flag}${change}`)
            }
            lines.push("")
          }
          return lines.join("\n")
        }

        if (action === "list") {
          const pending = getPendingIntegrationTasks(graph)
          return pending.length > 0 ? buildIntegrationBrief(graph) : formatTaskList()
        }

        if (action === "create") {
          if (!args.name) return "`name` is required to create a task."
          const column = isTaskColumn(args.column) ? args.column : undefined
          const task = createBoardTask(graph, {
            name: args.name,
            description: args.description,
            goal: args.goal,
            files: splitBy(args.files, /,/),
            acceptance: splitBy(args.acceptance, /[;\n]/),
            column,
            status: args.status as never,
            link_to: args.link_to,
            origin: "agent",
            integration_status: "manual",
          })
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["task"], ["contains", "implements"])
          return `Task created: **${task.id}** (column: ${column || "backlog"})`
        }

        if (action === "update") {
          if (!args.task_id) return "`task_id` is required to update a task."
          const column = isTaskColumn(args.column) ? args.column : undefined
          const task = updateBoardTask(graph, args.task_id, {
            name: args.name,
            description: args.description,
            goal: args.goal,
            files: splitBy(args.files, /,/),
            acceptance: splitBy(args.acceptance, /[;\n]/),
            column,
            status: args.status as never,
          })
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["task"], [])
          return `Task updated: **${task.id}** (${task.status})`
        }

        if (action === "remove") {
          if (!args.task_id) return "`task_id` is required to remove a task."
          removeBoardTask(graph, args.task_id)
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["task"], [])
          return `Task removed: **${args.task_id}**`
        }

        if (action === "mark_integrated") {
          if (!args.task_id) return "`task_id` is required to mark a task as integrated."
          const task = markTaskIntegrated(graph, args.task_id)

          // An integrated task opens the SDD Change that authorizes its code.
          const change = openChangeForTask(graph, task.id, {
            noRequirementImpact: args.no_requirement_impact,
          })
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["task", "change"], ["implements", "tested_by", "affects"])
          return [
            `Task **${task.id}** marked as integrated.`,
            "",
            formatOpenChangeResult(change),
          ].join("\n")
        }

        if (action === "open_change" || action === "approve_change") {
          if (!args.task_id) return "`task_id` is required to open the SDD Change of a task."
          const change = openChangeForTask(graph, args.task_id, {
            files: splitBy(args.files, /,/),
            approve: action === "approve_change",
            noRequirementImpact: args.no_requirement_impact,
          })
          repo.saveGraph(graph)
          invalidateCacheForMutation(ctx.directory, ["task", "change"], ["affects"])
          return formatOpenChangeResult(change)
        }

        return `Unknown action \`${action}\`. Use list, create, update, remove, mark_integrated, open_change or approve_change.`
      },
    }),

    // ── Workflow Chains (Item 4: Orquestração) ──────────────────────
    ...createWorkflowTools(),
  }
  return attachResponseCache(tools)
}

export function createSddTools(): Record<string, ToolDefinition> {
  const standalone = createAllTools()
  return {
    ...standalone,
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
  }
}
