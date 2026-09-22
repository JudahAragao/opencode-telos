/**
 * Internal handler functions for deprecated tools.
 *
 * These functions contain the business logic that was previously wrapped in
 * ToolDefinition objects. They are now called directly by composite tools
 * (tools-composite.ts) instead of being exposed as standalone tools.
 *
 * This file is the ONLY place where this logic lives. The deprecated tool
 * entries have been removed from tools.ts.
 */

import { createRepository, type GraphRepository } from "../sdd/persistence/repository.js"
import { loadPermissions, savePermissions } from "../sdd/permissions/access.js"
import { detectConfigDrift, formatConfigDriftReport } from "../sdd/patterns/config-drift.js"
import { exportWorkflow, formatWorkflowExport } from "../sdd/workflow/exporter.js"
import { analyzeCodebase } from "../code-intelligence/analyzer.js"
import { sddDebug } from "../sdd/log.js"
import { projectPath } from "../sdd/security/paths.js"
import { getCacheManager } from "../sdd/cache/manager.js"
import { graphFingerprint } from "../sdd/cache/fingerprint.js"
import type { KnowledgeGraph } from "../sdd/domain/types.js"

// ── Repository helpers ─────────────────────────────────────────────

function getRepo(directory: string): GraphRepository {
  return createRepository(directory)
}

function loadOrEmpty(directory: string): KnowledgeGraph {
  const repo = getRepo(directory)
  if (repo.isInitialized()) return repo.loadGraph()
  return {
    project_id: "pending",
    version: "1.0.0",
    nodes: [],
    relationships: [],
    metadata: { created_at: "", updated_at: "", sdd_version: "1.0.0" },
  }
}

// ── Shared context type ────────────────────────────────────────────

type HandlerCtx = { directory: string }

// ── sdd.permissions: save_permissions_config ────────────────────────

export async function savePermissionsConfigHandler(
  args: Record<string, any>,
  ctx: HandlerCtx,
): Promise<string> {
  try {
    const config = JSON.parse(args.config_json)
    savePermissions(ctx.directory, config)
    return "✅ Permissions configuration saved."
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`
  }
}

// ── sdd.snapshot: list_snapshots ───────────────────────────────────

export async function listSnapshotsHandler(
  _args: Record<string, any>,
  ctx: HandlerCtx,
): Promise<string> {
  const repo = getRepo(ctx.directory)
  if (!repo.isInitialized()) return "SDD not initialized."

  const snapshots = repo.listSnapshots()
  if (snapshots.length === 0) return "No snapshots found."

  const lines = [`## Snapshots (${snapshots.length})\n`]
  for (const snap of snapshots) {
    lines.push(`- ${snap}`)
  }
  return lines.join("\n")
}

// ── sdd.code_quality: verify_usage ─────────────────────────────────

export async function verifyUsageHandler(
  _args: Record<string, any>,
  ctx: HandlerCtx,
): Promise<string> {
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
          } catch (error) { sddDebug("tools", `Failed to read ${fullPath} for usage analysis`) }
        }
      } catch (error) { sddDebug("tools", `Failed to scan directory ${fullPath}`) }
    }
  }

  scanDir(ctx.directory)
  const report = trackUsage(graph, sourceFiles)
  return formatUsageReport(report)
}

// ── sdd.code_quality: find_dead_code ───────────────────────────────

export async function findDeadCodeHandler(
  args: Record<string, any>,
  ctx: HandlerCtx,
): Promise<string> {
  const { readFileSync } = await import("fs")
  const filePath = projectPath(ctx.directory, args.file)
  const code = readFileSync(filePath, "utf-8")
  const { analyzeImports, formatImportAnalysis } = await import("../sdd/code-quality/import-analyzer.js")
  const analysis = analyzeImports(code, args.file)
  return formatImportAnalysis(analysis)
}

// ── sdd.code_quality: remove_dead_code ─────────────────────────────

export async function removeDeadCodeHandler(
  args: Record<string, any>,
  ctx: HandlerCtx,
): Promise<string> {
  const { readFileSync, existsSync } = await import("fs")
  const filePath = projectPath(ctx.directory, args.file)

  if (!existsSync(filePath)) {
    return `❌ Arquivo não encontrado: ${args.file}`
  }

  const code = readFileSync(filePath, "utf-8")
  const { analyzeImports } = await import("../sdd/code-quality/import-analyzer.js")
  const analysis = analyzeImports(code, args.file)

  const unusedImports = analysis.issues.filter((i: any) => i.type === "unused_import")

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
      ...unusedImports.map((i: any) => `- Linha ${i.line}: ${i.message}`),
      "",
      "Execute sem dry_run para criar o ChangeNode e solicitar aprovação.",
    ].join("\n")
  }

  const graph = loadOrEmpty(ctx.directory)

  const changeNodeId = `change-remove-dead-${Date.now()}`
  const affectedNodes: string[] = []

  const fileNodeId = graph.nodes.find(
    (n) => n.type === "file" && (n.metadata as any).path === args.file,
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
}

// ── sdd.code_quality: plan_implementation ──────────────────────────

export async function planImplementationHandler(
  args: Record<string, any>,
  ctx: HandlerCtx,
): Promise<string> {
  const repo2 = getRepo(ctx.directory)
  const graph = loadOrEmpty(ctx.directory)
  const indices = repo2.isInitialized() ? repo2.getIndices() : null
  const { parseSymbols, convertToSymbolNodes } = await import("../sdd/code-quality/symbol-parser.js")
  const { readFileSync } = await import("fs")
  const fileList = args.files.split(",").map((f: string) => f.trim())
  const featureNode = indices
    ? indices.byId.get(args.feature_id)
    : graph.nodes.find((n) => n.id === args.feature_id)

  if (!featureNode) {
    return `❌ Feature/Entity não encontrada: ${args.feature_id}\n\nCrie o nó primeiro com sdd.discover ou sdd.update_from_answers.`
  }

  const newNodes: string[] = []
  const newRelationships: Array<{
    id: string
    from: string
    to: string
    type: string
    metadata: Record<string, unknown>
  }> = []

  for (const file of fileList) {
    const fullPath = projectPath(ctx.directory, file)
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
}

// ── sdd.code_quality: analyze_codebase ─────────────────────────────

export async function analyzeCodebaseHandler(
  _args: Record<string, any>,
  ctx: HandlerCtx,
): Promise<string> {
  const repo = getRepo(ctx.directory)
  if (!repo.isInitialized()) return "SDD not initialized."

  const graph = repo.loadGraph()
  const result = analyzeCodebase(graph, ctx.directory)
  repo.saveGraph(graph)

  return [
    `## Codebase Analysis Complete`,
    `**Files Analyzed:** ${result.files_analyzed}`,
    `**Symbols Found:** ${result.symbols_found}`,
    "",
    "FileNode and SymbolNode entries have been added to the Knowledge Graph.",
    "Use `sdd.query_graph` to inspect the new nodes.",
  ].join("\n")
}

// ── sdd.enterprise: create_migration ───────────────────────────────

export async function createMigrationHandler(
  args: Record<string, any>,
  ctx: HandlerCtx,
): Promise<string> {
  const graph = loadOrEmpty(ctx.directory)
  const { createMigrationChange, getMigrationInstructions } = await import(
    "../sdd/workflows/data-migration.js"
  )
  const { change, migration } = createMigrationChange(graph, {
    id: `migration-${Date.now()}`,
    source_schema: args.source,
    target_schema: args.target,
    description: args.description,
    data_transformations: args.transformations,
  })

  const repo = getRepo(ctx.directory)
  if (repo.isInitialized()) {
    const g = repo.loadGraph()
    g.nodes.push(change, migration)
    repo.saveGraph(g)
  }

  return getMigrationInstructions(migration)
}

// ── sdd.enterprise: create_experiment ──────────────────────────────

export async function createExperimentHandler(
  args: Record<string, any>,
  ctx: HandlerCtx,
): Promise<string> {
  const graph = loadOrEmpty(ctx.directory)
  const { createExperimentChange, getExperimentInstructions } = await import(
    "../sdd/workflows/ab-testing.js"
  )
  const { change, experiment } = createExperimentChange(graph, {
    id: `experiment-${Date.now()}`,
    hypothesis: args.hypothesis,
    variants: args.variants as any,
    primary_metric: args.metric,
    duration_days: args.duration,
  })

  const repo = getRepo(ctx.directory)
  if (repo.isInitialized()) {
    const g = repo.loadGraph()
    g.nodes.push(change, experiment)
    repo.saveGraph(g)
  }

  return getExperimentInstructions(experiment)
}

// ── sdd.enterprise: create_flag ────────────────────────────────────

export async function createFlagHandler(
  args: Record<string, any>,
  ctx: HandlerCtx,
): Promise<string> {
  const graph = loadOrEmpty(ctx.directory)
  const { createFeatureFlagChange, getFeatureFlagInstructions } = await import(
    "../sdd/workflows/feature-flags.js"
  )
  const { change, featureFlag } = createFeatureFlagChange(graph, {
    id: `flag-${Date.now()}`,
    flag_name: args.name,
    description: args.description,
    rollout_percentage: args.rollout,
    target_audience: args.audience,
  })

  const repo = getRepo(ctx.directory)
  if (repo.isInitialized()) {
    const g = repo.loadGraph()
    g.nodes.push(change, featureFlag)
    repo.saveGraph(g)
  }

  return getFeatureFlagInstructions(featureFlag)
}

// ── sdd.enterprise: create_tenant ──────────────────────────────────

export async function createTenantHandler(
  args: Record<string, any>,
  ctx: HandlerCtx,
): Promise<string> {
  const graph = loadOrEmpty(ctx.directory)
  const { createTenantChange, getTenantInstructions } = await import(
    "../sdd/workflows/multi-tenancy.js"
  )
  const { change, tenant } = createTenantChange(graph, {
    id: `tenant-${Date.now()}`,
    tenant_name: args.name,
    tenant_type: args.type as any,
    isolation_level: args.isolation as any,
  })

  const repo = getRepo(ctx.directory)
  if (repo.isInitialized()) {
    const g = repo.loadGraph()
    g.nodes.push(change, tenant)
    repo.saveGraph(g)
  }

  return getTenantInstructions(tenant)
}

// ── sdd.enterprise: generate_dashboard ─────────────────────────────

export async function generateDashboardHandler(
  args: Record<string, any>,
  ctx: HandlerCtx,
): Promise<string> {
  const graph = loadOrEmpty(ctx.directory)
  const { generateDashboardConfig, formatDashboardConfig } = await import(
    "../sdd/monitoring/setup.js"
  )
  const config = generateDashboardConfig(graph, args.type as any)
  return formatDashboardConfig(config)
}

// ── sdd.enterprise: report_incident ────────────────────────────────

export async function reportIncidentHandler(
  args: Record<string, any>,
  ctx: HandlerCtx,
): Promise<string> {
  const graph = loadOrEmpty(ctx.directory)
  const { createIncident, getIncidentInstructions } = await import(
    "../sdd/incidents/manager.js"
  )
  const incident = createIncident(graph, {
    id: `incident-${Date.now()}`,
    title: args.title,
    severity: args.severity as any,
    impact: args.impact,
  })

  const repo = getRepo(ctx.directory)
  if (repo.isInitialized()) {
    const g = repo.loadGraph()
    g.nodes.push(incident)
    repo.saveGraph(g)
  }

  return getIncidentInstructions(incident)
}

// ── sdd.enterprise: create_sla ─────────────────────────────────────

export async function createSlaHandler(
  args: Record<string, any>,
  ctx: HandlerCtx,
): Promise<string> {
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
    const g = repo.loadGraph()
    g.nodes.push(sla)
    repo.saveGraph(g)
  }

  return getSLAInstructions(sla)
}

// ── sdd.enterprise: estimate_cost ──────────────────────────────────

export async function estimateCostHandler(
  _args: Record<string, any>,
  ctx: HandlerCtx,
): Promise<string> {
  const graph = loadOrEmpty(ctx.directory)
  const { estimateCost, formatCostEstimate } = await import("../sdd/cost/estimator.js")
  const result = estimateCost(graph)
  return formatCostEstimate(result)
}

// ── sdd.enterprise: knowledge_transfer ─────────────────────────────

export async function knowledgeTransferHandler(
  _args: Record<string, any>,
  ctx: HandlerCtx,
): Promise<string> {
  const graph = loadOrEmpty(ctx.directory)
  const { generateKnowledgeTransfer, formatKnowledgeTransfer } = await import(
    "../sdd/knowledge/transfer.js"
  )
  const data = generateKnowledgeTransfer(graph)
  return formatKnowledgeTransfer(data)
}

// ── sdd.enterprise: disaster_recovery_plan ─────────────────────────

export async function disasterRecoveryPlanHandler(
  _args: Record<string, any>,
  ctx: HandlerCtx,
): Promise<string> {
  const graph = loadOrEmpty(ctx.directory)
  const { generateDisasterRecoveryPlan, formatDisasterRecoveryPlan } = await import(
    "../sdd/disaster/recovery.js"
  )
  const plan = generateDisasterRecoveryPlan(graph)
  return formatDisasterRecoveryPlan(plan)
}

// ── sdd.enterprise: config_drift ───────────────────────────────────

export async function configDriftHandler(
  _args: Record<string, any>,
  ctx: HandlerCtx,
): Promise<string> {
  const report = detectConfigDrift(ctx.directory)
  return formatConfigDriftReport(report)
}

// ── sdd.enterprise: workflow_export ────────────────────────────────

export async function workflowExportHandler(
  _args: Record<string, any>,
  ctx: HandlerCtx,
): Promise<string> {
  const repo = getRepo(ctx.directory)
  if (!repo.isInitialized()) return "SDD not initialized."
  const graph = repo.loadGraph()
  const exportData = exportWorkflow(graph)
  return formatWorkflowExport(exportData)
}
