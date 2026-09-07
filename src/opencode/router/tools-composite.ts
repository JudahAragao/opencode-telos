/**
 * Composite Tools — Tools compostas que substituem múltiplas tools originais.
 *
 * Cada tool composta aceita um parâmetro `action` e delega para a lógica
 * correspondente nos módulos SDD. As tools originais são mantidas como
 * deprecated por compatibilidade.
 *
 * Consumido por: createSddTools() em tools.ts
 */

import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { sddDebug } from "../../sdd/log.js"
import { createRepository, type GraphRepository } from "../../sdd/persistence/repository.js"
import {
  getNodeIndexed,
  updateNode,
  removeNode,
  addRelationship,
  removeRelationship,
  getNodesByTypeIndexed,
  getGraphStatsIndexed,
} from "../../sdd/graph/engine.js"
import { bfsOutgoing, bfsBoth, bfsIncoming, getSubgraph, findPath } from "../../sdd/graph/traverse.js"
import {
  checkPermission,
  getUserRoleWithAuth,
  getAuditLog,
  formatAuditLog,
  loadPermissions,
  setRole,
  getRequiredApprovals,
} from "../../sdd/permissions/access.js"
import { createSnapshot, executeRollback, loadRollbackHistory, formatRollbackResult, formatRollbackHistory } from "../../sdd/rollback/manager.js"
import { getSyncStatus, pullLatest, pushChanges, detectConflicts, mergeGraphs, resolveConflict, formatSyncStatus } from "../../sdd/sync/git-sync.js"
import { computeGraphHealth } from "../../sdd/session/handoff.js"
import { getCacheManager } from "../../sdd/cache/manager.js"
import { detectConventions, formatConventions } from "../../sdd/code-quality/conventions.js"
import { learnPatterns, formatPatterns, loadPatterns, savePatterns, getSuggestedDefaults, getSuggestedRelationships, getSuggestedNaming } from "../../sdd/patterns/learner.js"
import { analyzeComplexity, formatComplexityReport } from "../../sdd/code-quality/complexity.js"
import { analyzeMetrics, formatMetricsReport } from "../../sdd/code-quality/metrics.js"
import { detectCodeSmells, formatCodeSmellReport } from "../../sdd/code-quality/smells.js"
import { analyzeDependencies, formatDependencyReport } from "../../sdd/code-quality/dependencies.js"
import { addToDriftWhitelist, removeFromDriftWhitelist, loadDriftWhitelist } from "../../sdd/drift/exclusion.js"
import { parseSymbols, convertToSymbolNodes } from "../../sdd/code-quality/symbol-parser.js"
import type { KnowledgeGraph, AnyNode, NodeType } from "../../sdd/domain/types.js"
import { pruneGraph, formatPruneReport } from "../../sdd/graph/pruner.js"
import { projectPath } from "../../sdd/security/paths.js"

function getRepo(directory: string): GraphRepository {
  return createRepository(directory)
}

function loadOrEmpty(directory: string): KnowledgeGraph {
  const repo = getRepo(directory)
  if (repo.isInitialized()) return repo.loadGraph()
  return { project_id: "pending", version: "1", nodes: [], relationships: [], metadata: { created_at: "", updated_at: "", sdd_version: "1.0" } }
}

async function executeOriginalTool(name: string, args: Record<string, unknown>, ctx: any): Promise<string> {
  const { createSddTools } = await import("../tools.js")
  const definition = createSddTools()[name]
  if (!definition) return `Error: Tool ${name} not found`
  const result = await definition.execute(args as any, ctx)
  return typeof result === "string" ? result : result.output
}

function parseJson(value?: string): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

// ── Composite: sdd.graph_mutation ──────────────────────────────────

export function createGraphMutationTool(): ToolDefinition {
  return tool({
    description:
      "Modificar a estrutura do Knowledge Graph. " +
      "Use `action` para selecionar a operação: add_node, update_node, remove_node, add_relationship, remove_relationship.",
    args: {
      action: tool.schema.enum(["add_node", "update_node", "remove_node", "add_relationship", "remove_relationship"]).describe("Operação a executar"),
      type: tool.schema.string().optional().describe("Tipo do nó (para add_node)"),
      name: tool.schema.string().optional().describe("Nome do nó (para add_node)"),
      description_text: tool.schema.string().optional().describe("Descrição do nó (para add_node)"),
      parent_id: tool.schema.string().optional().describe("ID do nó pai (para add_node)"),
      metadata_json: tool.schema.string().optional().describe("Metadados como JSON (para add_node)"),
      node_id: tool.schema.string().optional().describe("ID do nó (para update_node, remove_node)"),
      updates_json: tool.schema.string().optional().describe("Updates como JSON (para update_node)"),
      from_id: tool.schema.string().optional().describe("Nó origem (para add_relationship)"),
      to_id: tool.schema.string().optional().describe("Nó destino (para add_relationship)"),
      rel_type: tool.schema.string().optional().describe("Tipo da relação (para add_relationship)"),
      relationship_id: tool.schema.string().optional().describe("ID da relação (para remove_relationship)"),
    },
    async execute(args, ctx) {
      const repo = getRepo(ctx.directory)
      if (!repo.isInitialized()) return "SDD not initialized."
      const graph = repo.loadGraph()

      switch (args.action) {
        case "add_node": {
          if (!args.type || !args.name) return "type and name are required for add_node"
          const existing = graph.nodes.find(
            (n) => n.type === args.type && n.name.toLowerCase() === args.name!.toLowerCase()
          )
          if (existing) return `Node "${args.name}" already exists: ${existing.id}. Use update_node instead.`

          const nodeId = `${graph.project_id}-${args.type.toUpperCase().slice(0, 4)}-${String(graph.nodes.filter((n) => n.type === args.type).length + 1).padStart(3, "0")}`
          let metadata: Record<string, unknown> = {}
          if (args.metadata_json) {
            try { metadata = JSON.parse(args.metadata_json) } catch { return "Invalid JSON in metadata_json" }
          }

          const nodeType = args.type as NodeType
          if (nodeType === "business_rule" && !metadata.rule_text) metadata.rule_text = args.description_text || args.name || ""
          if (nodeType === "constraint" && !metadata.rule_text) metadata.rule_text = args.description_text || args.name || ""
          if (nodeType === "constraint" && !metadata.constraint_type) metadata.constraint_type = "business"
          if (nodeType === "entity" && !metadata.fields) metadata.fields = []
          if (nodeType === "endpoint" && !metadata.method) { metadata.method = "GET"; metadata.path = "/" }
          if (nodeType === "database" && !metadata.engine) metadata.engine = "postgresql"
          if (nodeType === "architecture_component" && !metadata.layer) metadata.layer = "backend"

          const node: AnyNode = {
            id: nodeId, type: args.type as NodeType, name: args.name,
            description: args.description_text, status: "DRAFT", version: 1,
            metadata, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          } as AnyNode

          graph.nodes.push(node)

          if (args.parent_id) {
            try { addRelationship(graph, args.parent_id, nodeId, "contains") } catch (error) { sddDebug("composite", `Failed to add parent relationship for ${nodeId}`) }
          }

          repo.saveGraph(graph)
          return `Node created: **${nodeId}** (${args.type}): ${args.name}`
        }

        case "update_node": {
          if (!args.node_id || !args.updates_json) return "node_id and updates_json are required"
          let updates: Partial<AnyNode>
          try { updates = JSON.parse(args.updates_json) } catch { return "Invalid JSON in updates_json" }
          const indices = repo.getIndices()
          const node = getNodeIndexed(indices, args.node_id)
          if (!node) return `Node ${args.node_id} not found.`
          updateNode(graph, args.node_id, updates)
          repo.saveGraph(graph)
          return `Node ${args.node_id} updated.`
        }

        case "remove_node": {
          if (!args.node_id) return "node_id is required"
          const indices = repo.getIndices()
          const node = getNodeIndexed(indices, args.node_id)
          if (!node) return `Node ${args.node_id} not found.`
          removeNode(graph, args.node_id)
          repo.saveGraph(graph)
          return `Node ${args.node_id} removed.`
        }

        case "add_relationship": {
          if (!args.from_id || !args.to_id || !args.rel_type) return "from_id, to_id, and rel_type are required"
          try {
            addRelationship(graph, args.from_id, args.to_id, args.rel_type as any)
            repo.saveGraph(graph)
            return `Relationship created: ${args.from_id} --[${args.rel_type}]--> ${args.to_id}`
          } catch (e) {
            return `Error: ${e instanceof Error ? e.message : String(e)}`
          }
        }

        case "remove_relationship": {
          if (!args.from_id || !args.to_id || !args.rel_type) return "from_id, to_id, and rel_type are required"
          removeRelationship(graph, args.from_id, args.to_id, args.rel_type as any)
          repo.saveGraph(graph)
          return `Relationship removed: ${args.from_id} --[${args.rel_type}]--> ${args.to_id}`
        }

        default:
          return `Unknown action: ${args.action}`
      }
    },
  })
}

// ── Composite: sdd.graph_query ────────────────────────────────────

export function createGraphQueryTool(): ToolDefinition {
  return tool({
    description: "Consultar o Knowledge Graph: contar nós, filtrar por status, listar por tipo.",
    args: {
      action: tool.schema.enum(["count_nodes", "get_nodes_by_status", "list_nodes"]).describe("Operação a executar"),
      type: tool.schema.string().optional().describe("Tipo de nó (para list_nodes)"),
      status: tool.schema.string().optional().describe("Status do nó (para get_nodes_by_status)"),
    },
    async execute(args, ctx) {
      const repo = getRepo(ctx.directory)
      if (!repo.isInitialized()) return "SDD not initialized."
      const indices = repo.getIndices()

      switch (args.action) {
        case "count_nodes": {
          const stats = getGraphStatsIndexed(indices)
          const lines = [`## Node Counts\n`]
          for (const [type, count] of Object.entries(stats.by_type).sort(([, a], [, b]) => b - a)) {
            lines.push(`- ${type}: ${count}`)
          }
          lines.push(`\n**Total:** ${stats.total_nodes} nodes, ${stats.total_relationships} relationships`)
          return lines.join("\n")
        }

        case "get_nodes_by_status": {
          if (!args.status) return "status is required"
          const allNodes = [...indices.byId.values()]
          const filtered = allNodes.filter((n) => n.status === args.status)
          if (filtered.length === 0) return `No nodes with status "${args.status}".`
          const lines = [`## Nodes with status "${args.status}" (${filtered.length})\n`]
          for (const node of filtered.slice(0, 30)) {
            lines.push(`- **${node.id}** (${node.type}): ${node.name}`)
          }
          if (filtered.length > 30) lines.push(`\n... and ${filtered.length - 30} more`)
          return lines.join("\n")
        }

        case "list_nodes": {
          if (!args.type) return "type is required"
          const nodes = getNodesByTypeIndexed(indices, args.type as NodeType)
          if (nodes.length === 0) return `No nodes of type "${args.type}".`
          const lines = [`## ${args.type} Nodes (${nodes.length})\n`]
          for (const node of nodes.slice(0, 30)) {
            lines.push(`- **${node.id}:** ${node.name} [${node.status}]`)
          }
          if (nodes.length > 30) lines.push(`\n... and ${nodes.length - 30} more`)
          return lines.join("\n")
        }

        default:
          return `Unknown action: ${args.action}`
      }
    },
  })
}

// ── Composite: sdd.traverse ───────────────────────────────────────

export function createTraverseTool(): ToolDefinition {
  return tool({
    description: "Percorrer o Knowledge Graph: BFS, subgraph, path finding.",
    args: {
      action: tool.schema.enum(["outgoing", "incoming", "both", "subgraph", "find_path"]).describe("Operação a executar"),
      node_id: tool.schema.string().describe("Nó de origem"),
      to_id: tool.schema.string().optional().describe("Nó destino (para find_path)"),
      depth: tool.schema.number().optional().describe("Profundidade máxima (default: 2)"),
    },
    async execute(args, ctx) {
      const repo = getRepo(ctx.directory)
      if (!repo.isInitialized()) return "SDD not initialized."
      const graph = repo.loadGraph()
      const indices = repo.getIndices()
      const depth = args.depth || 2
      const node = getNodeIndexed(indices, args.node_id)
      if (!node) return `Node ${args.node_id} not found.`

      switch (args.action) {
        case "outgoing": {
          const result = bfsOutgoing(graph, args.node_id, { max_depth: depth, include_start: true })
          const lines = [`## BFS Outgoing from ${args.node_id} (depth ${depth})\n`]
          for (const n of result.nodes.slice(0, 30)) lines.push(`- **${n.id}** (${n.type}): ${n.name}`)
          if (result.nodes.length > 30) lines.push(`\n... and ${result.nodes.length - 30} more`)
          return lines.join("\n")
        }
        case "incoming": {
          const result = bfsIncoming(graph, args.node_id, { max_depth: depth, include_start: true })
          const lines = [`## BFS Incoming to ${args.node_id} (depth ${depth})\n`]
          for (const n of result.nodes.slice(0, 30)) lines.push(`- **${n.id}** (${n.type}): ${n.name}`)
          if (result.nodes.length > 30) lines.push(`\n... and ${result.nodes.length - 30} more`)
          return lines.join("\n")
        }
        case "both": {
          const result = bfsBoth(graph, args.node_id, { max_depth: depth, include_start: true })
          const lines = [`## BFS Both from ${args.node_id} (depth ${depth})\n`]
          for (const n of result.nodes.slice(0, 30)) lines.push(`- **${n.id}** (${n.type}): ${n.name}`)
          if (result.nodes.length > 30) lines.push(`\n... and ${result.nodes.length - 30} more`)
          return lines.join("\n")
        }
        case "subgraph": {
          // Get neighbors up to depth
          const result = bfsBoth(graph, args.node_id, { max_depth: depth, include_start: true })
          const nodeIds = result.nodes.map(n => n.id)
          const sub = getSubgraph(graph, nodeIds)
          const lines = [`## Subgraph around ${args.node_id}\n`]
          lines.push(`**Nodes:** ${sub.nodes.length} | **Relationships:** ${sub.relationships.length}\n`)
          for (const n of sub.nodes.slice(0, 20)) lines.push(`- **${n.id}** (${n.type}): ${n.name}`)
          return lines.join("\n")
        }
        case "find_path": {
          if (!args.to_id) return "to_id is required for find_path"
          const path = findPath(graph, args.node_id, args.to_id)
          if (!path) return `No path found between ${args.node_id} and ${args.to_id}.`
          const lines = [`## Path: ${args.node_id} → ${args.to_id}\n`]
          for (let i = 0; i < path.length; i++) {
            const n = path[i]
            lines.push(`${i + 1}. **${n.id}** (${n.type}): ${n.name}${i < path.length - 1 ? " →" : ""}`)
          }
          return lines.join("\n")
        }
        default:
          return `Unknown action: ${args.action}`
      }
    },
  })
}

// ── Composite: sdd.permissions ────────────────────────────────────

export function createPermissionsTool(): ToolDefinition {
  return tool({
    description: "Gerenciar permissões, roles, audit log e configuração de acesso.",
    args: {
      action: tool.schema.enum(["set_role", "check", "audit", "config", "save_config", "role", "approval"]).describe("Operação a executar"),
      user: tool.schema.string().optional().describe("Nome do usuário"),
      role: tool.schema.string().optional().describe("Role a atribuir"),
      permission: tool.schema.string().optional().describe("Permissão a verificar"),
      change_id: tool.schema.string().optional().describe("ID da change"),
      limit: tool.schema.number().optional().describe("Limite de entradas no audit log"),
      config_json: tool.schema.string().optional().describe("Configuração JSON para save_config"),
    },
    async execute(args, ctx) {
      const currentUser = process.env.USER || process.env.USERNAME || "current"

      switch (args.action) {
        case "set_role": {
          if (!args.user || !args.role) return "user and role are required"
          setRole(ctx.directory, args.user, args.role as any)
          return `Role "${args.role}" set for user "${args.user}".`
        }
        case "check": {
          if (!args.user || !args.permission) return "user and permission are required"
          const role = getUserRoleWithAuth(ctx.directory, args.user)
          const has = checkPermission(role, args.permission as any, ctx.directory)
          return `User ${args.user} has permission ${args.permission}: ${has}`
        }
        case "audit": {
          const limit = args.limit || 20
          const log = getAuditLog(ctx.directory, { limit })
          return formatAuditLog(log)
        }
        case "config": {
          const config = loadPermissions(ctx.directory)
          return JSON.stringify(config, null, 2)
        }
        case "save_config": {
          if (!args.config_json) return "config_json is required"
          return executeOriginalTool("sdd.save_permissions_config", { config_json: args.config_json }, ctx)
        }
        case "role": {
          const role = getUserRoleWithAuth(ctx.directory, args.user || currentUser)
          return `User "${args.user || currentUser}" has role: **${role}**`
        }
        case "approval": {
          if (!args.change_id) return "change_id is required"
          const required = getRequiredApprovals("change", ctx.directory)
          return `Change ${args.change_id} requires ${required} approval(s).`
        }
        default:
          return `Unknown action: ${args.action}`
      }
    },
  })
}

// ── Composite: sdd.snapshot ───────────────────────────────────────

export function createSnapshotTool(): ToolDefinition {
  return tool({
    description: "Criar snapshots do grafo, rollback e histórico.",
    args: {
      action: tool.schema.enum(["create", "rollback", "history", "list"]).describe("Operação a executar"),
      change_id: tool.schema.string().optional().describe("ID da change (para create)"),
      snapshot_id: tool.schema.string().optional().describe("ID do snapshot (para rollback)"),
    },
    async execute(args, ctx) {
      const repo = getRepo(ctx.directory)
      if (!repo.isInitialized()) return "SDD not initialized."
      const graph = repo.loadGraph()

      switch (args.action) {
        case "create": {
          if (!args.change_id) return "change_id is required"
          createSnapshot(graph, args.change_id, ctx.directory)
          return `Snapshot created for change ${args.change_id}.`
        }
        case "rollback": {
          if (!args.snapshot_id) return "snapshot_id is required"
          const result = executeRollback(graph, args.snapshot_id, ctx.directory)
          repo.saveGraph(graph)
          return formatRollbackResult(result)
        }
        case "history": {
          const history = loadRollbackHistory(ctx.directory)
          return formatRollbackHistory(history)
        }
        case "list": {
          return executeOriginalTool("sdd.list_snapshots", {}, ctx)
        }
        default:
          return `Unknown action: ${args.action}`
      }
    },
  })
}

// ── Composite: sdd.sync ───────────────────────────────────────────

export function createSyncTool(): ToolDefinition {
  return tool({
    description: "Sincronizar grafo com repositório remoto: pull, push, conflitos, merge.",
    args: {
      action: tool.schema.enum(["status", "pull", "push", "conflicts", "merge"]).describe("Operação a executar"),
      remote_graph_path: tool.schema.string().optional().describe("Caminho do grafo remoto para sync"),
      auto_resolve: tool.schema.boolean().optional().describe("Resolver conflitos automaticamente"),
    },
    async execute(args, ctx) {
      switch (args.action) {
        case "status": {
          const status = await getSyncStatus(ctx.directory)
          return formatSyncStatus(status)
        }
        case "pull": {
          const result = pullLatest(ctx.directory)
          return `Pull: ${result.success ? "✅" : "❌"}`
        }
        case "push": {
          const result = pushChanges(ctx.directory, "SDD sync push")
          return `Push: ${result.success ? "✅" : "❌"}`
        }
        case "conflicts": {
          if (!args.remote_graph_path) return "remote_graph_path is required"
          const repo = getRepo(ctx.directory)
          if (!repo.isInitialized()) return "SDD not initialized."
          const conflicts = detectConflicts(repo.loadGraph(), projectPath(ctx.directory, args.remote_graph_path))
          if (conflicts.length === 0) return "No sync conflicts detected."
          return ["## Sync Conflicts", ...conflicts.map(c => `- ${c.node_id}.${c.field}: ${JSON.stringify(c.local_value)} → ${JSON.stringify(c.remote_value)}`)].join("\n")
        }
        case "merge": {
          if (!args.remote_graph_path) return "remote_graph_path is required"
          const repo = getRepo(ctx.directory)
          if (!repo.isInitialized()) return "SDD not initialized."
          const local = repo.loadGraph()
          const remote = JSON.parse((await import("fs")).readFileSync(projectPath(ctx.directory, args.remote_graph_path), "utf-8")) as KnowledgeGraph
          const conflicts = detectConflicts(local, projectPath(ctx.directory, args.remote_graph_path))
          const merged = mergeGraphs(local, remote, { auto_resolve: args.auto_resolve ?? false, field_priorities: {} })
          repo.saveGraph(merged)
          const resolved = conflicts.map(c => resolveConflict(c, "local"))
          return `## Graph Merge Complete\n- Merged nodes: ${merged.nodes.length}\n- Conflicts resolved: ${resolved.length}`
        }
        default:
          return `Unknown action: ${args.action}`
      }
    },
  })
}

// ── Composite: sdd.graph_admin ────────────────────────────────────

export function createGraphAdminTool(): ToolDefinition {
  return tool({
    description: "Administração do grafo: health, pruning, cache, convenções, padrões.",
    args: {
      action: tool.schema.enum(["health", "health_detail", "prune", "cache", "conventions", "learn"]).describe("Operação a executar"),
      learn_action: tool.schema.enum(["learn", "show", "suggest"]).optional().describe("Sub-action para learn"),
      node_type: tool.schema.string().optional().describe("Tipo de nó (para learn com suggest)"),
    },
    async execute(args, ctx) {
      const repo = getRepo(ctx.directory)
      if (!repo.isInitialized()) return "SDD not initialized."

      switch (args.action) {
        case "health": {
          const graph = repo.loadGraph()
          const indices = repo.getIndices()
          const stats = getGraphStatsIndexed(indices)
          const orphanCount = graph.nodes.filter(n => !graph.relationships.some(r => r.from === n.id || r.to === n.id)).length
          const avgRels = graph.nodes.length > 0 ? (graph.relationships.length / graph.nodes.length).toFixed(2) : "0"
          return [
            "## Graph Health Report",
            `- Nodes: ${graph.nodes.length} | Relationships: ${graph.relationships.length}`,
            `- Orphan nodes: ${orphanCount}`,
            `- Relationship density: ${avgRels} rels/node`,
            `- Types: ${Object.keys(stats.by_type).length}`,
          ].join("\n")
        }
        case "health_detail": {
          const graph = repo.loadGraph()
          const health = computeGraphHealth(graph)
          return [
            "## Detailed Graph Health",
            `- Stale changes: ${health.staleChanges}`,
            `- Cycles: ${health.cyclesDetected}`,
            `- God nodes: ${health.godNodes.length}`,
            `- Orphan changes: ${health.orphanChanges}`,
            `- Draft endpoints: ${health.draftEndpoints}`,
          ].join("\n")
        }
        case "prune": {
          const graph = repo.loadGraph()
          const report = pruneGraph(graph, ctx.directory)
          repo.saveGraph(graph)
          return formatPruneReport(report)
        }
        case "cache": {
          const cacheMgr = getCacheManager(ctx.directory)
          const stats = cacheMgr.getStats()
          return [
            "## Cache Statistics",
            `- Tool cache: ${stats.toolCacheSize} entries (${stats.hitRate} hit rate)`,
            `- Analysis cache: ${stats.analysisCacheSize} entries (${stats.analysisHitRate} hit rate)`,
            `- Invalidation count: ${stats.invalidations}`,
          ].join("\n")
        }
        case "conventions": {
          const conventions = detectConventions(ctx.directory)
          return formatConventions(conventions)
        }
        case "learn": {
          const graph = repo.loadGraph()
          const subAction = args.learn_action || "show"
          if (subAction === "learn") {
            const patterns = learnPatterns(graph)
            savePatterns(ctx.directory, patterns)
            return formatPatterns(patterns)
          }
          if (subAction === "show") {
            const patterns = loadPatterns(ctx.directory)
            if (!patterns) return "No patterns learned yet. Run with learn_action=learn first."
            return formatPatterns(patterns)
          }
          if (subAction === "suggest") {
            if (!args.node_type) return "node_type is required for suggest"
            const patterns = loadPatterns(ctx.directory)
            if (!patterns) return "No patterns learned yet. Run with learn_action=learn first."
            const defaults = getSuggestedDefaults(patterns, args.node_type as any)
            const rels = getSuggestedRelationships(patterns, args.node_type as any)
            const naming = getSuggestedNaming(patterns, args.node_type as any)
            return [
              `## Suggestions for ${args.node_type}`,
              `Default metadata: ${Object.keys(defaults).length > 0 ? JSON.stringify(defaults) : "none"}`,
              `Suggested relationships: ${rels.map(r => `→[${r.relationship_type}]→ ${r.to_type}`).join(", ") || "none"}`,
              naming ? `Naming convention: ${naming}` : "",
            ].filter(Boolean).join("\n")
          }
          return "Invalid learn_action. Use learn, show, or suggest."
        }
        default:
          return `Unknown action: ${args.action}`
      }
    },
  })
}

// ── Composite: sdd.code_quality ───────────────────────────────────

export function createCodeQualityTool(): ToolDefinition {
  return tool({
    description: "Análise de qualidade de código: complexidade, métricas, smells, dependências, código morto, símbolos.",
    args: {
      action: tool.schema.enum([
        "complexity", "metrics", "smells", "dependencies",
        "usage", "dead_code", "remove_dead_code", "parse_symbols", "plan_implementation", "analyze_codebase",
      ]).describe("Operação a executar"),
      file_path: tool.schema.string().optional().describe("Caminho do arquivo"),
      feature_id: tool.schema.string().optional().describe("ID da feature"),
      files: tool.schema.string().optional().describe("Lista de arquivos separados por vírgula"),
      dry_run: tool.schema.boolean().optional().describe("Apenas simular a remoção"),
    },
    async execute(args, ctx) {
      switch (args.action) {
        case "complexity": {
          if (!args.file_path) return "file_path is required"
          const { readFileSync } = await import("fs")
          const code = readFileSync(projectPath(ctx.directory, args.file_path), "utf-8")
          const result = analyzeComplexity(code, args.file_path)
          return formatComplexityReport(result)
        }
        case "metrics": {
          if (!args.file_path) return "file_path is required"
          const { readFileSync } = await import("fs")
          const code = readFileSync(projectPath(ctx.directory, args.file_path), "utf-8")
          const result = analyzeMetrics(code, args.file_path)
          return formatMetricsReport(result)
        }
        case "smells": {
          if (!args.file_path) return "file_path is required"
          const { readFileSync } = await import("fs")
          const code = readFileSync(projectPath(ctx.directory, args.file_path), "utf-8")
          const result = detectCodeSmells(code, args.file_path)
          return formatCodeSmellReport(result)
        }
        case "dependencies": {
          const graph = loadOrEmpty(ctx.directory)
          const result = analyzeDependencies(graph)
          return formatDependencyReport(result)
        }
        case "usage": {
          const { createSddTools } = await import("../tools.js")
          return String(await createSddTools()["sdd.verify_usage"].execute({}, ctx))
        }
        case "dead_code": {
          if (!args.file_path) return "file_path is required"
          const { createSddTools } = await import("../tools.js")
          return String(await createSddTools()["sdd.find_dead_code"].execute({ file: args.file_path }, ctx))
        }
        case "remove_dead_code": {
          if (!args.file_path) return "file_path is required"
          return executeOriginalTool("sdd.remove_dead_code", { file: args.file_path, dry_run: args.dry_run }, ctx)
        }
        case "parse_symbols": {
          if (!args.file_path) return "file_path is required"
          const { readFileSync } = await import("fs")
          const code = readFileSync(projectPath(ctx.directory, args.file_path), "utf-8")
          const symbols = parseSymbols(code, args.file_path)
          const nodes = convertToSymbolNodes(symbols)
          return nodes.map(n => `- **${n.id}** (${n.type}): ${n.name}`).join("\n") || "No symbols found."
        }
        case "plan_implementation": {
          if (!args.feature_id || !args.files) return "feature_id and files are required"
          const { createSddTools } = await import("../tools.js")
          return String(await createSddTools()["sdd.plan_implementation"].execute({ feature_id: args.feature_id, files: args.files }, ctx))
        }
        case "analyze_codebase": {
          return executeOriginalTool("sdd.analyze_codebase", {}, ctx)
        }
        default:
          return `Unknown action: ${args.action}`
      }
    },
  })
}

// ── Composite: sdd.enterprise ─────────────────────────────────────

export function createEnterpriseTool(): ToolDefinition {
  return tool({
    description: "Workflows empresariais: migrations, experiments, feature flags, security, compliance, docs.",
    args: {
      action: tool.schema.enum([
        "migration", "experiment", "flag", "tenant", "security_audit", "scalability",
        "compliance", "monitoring", "dashboard", "incident", "sla", "cost", "docs",
        "onboarding", "knowledge_transfer", "disaster_recovery", "config_drift", "workflow_export",
      ]).describe("Operação a executar"),
      params_json: tool.schema.string().optional().describe("Parâmetros como JSON"),
    },
    async execute(args, ctx) {
      const graph = loadOrEmpty(ctx.directory)

      switch (args.action) {
        case "migration": return executeOriginalTool("sdd.create_migration", parseJson(args.params_json), ctx)
        case "experiment": return executeOriginalTool("sdd.create_experiment", parseJson(args.params_json), ctx)
        case "flag": return executeOriginalTool("sdd.create_flag", parseJson(args.params_json), ctx)
        case "tenant": return executeOriginalTool("sdd.create_tenant", parseJson(args.params_json), ctx)
        case "security_audit": {
          const { performSecurityAudit, formatSecurityAudit } = await import("../../sdd/analysis/security.js")
          const result = performSecurityAudit(graph)
          return formatSecurityAudit(result)
        }
        case "scalability": {
          const { analyzeScalability, formatScalabilityAnalysis } = await import("../../sdd/analysis/scalability.js")
          const result = analyzeScalability(graph)
          return formatScalabilityAnalysis(result)
        }
        case "compliance": {
          const params = args.params_json ? JSON.parse(args.params_json) : {}
          const standard = params.standard || "GDPR"
          const { checkCompliance, formatComplianceCheck } = await import("../../sdd/analysis/compliance.js")
          const result = checkCompliance(graph, standard)
          return formatComplianceCheck(result)
        }
        case "monitoring": {
          const { setupMonitoring, formatMonitoringSetup } = await import("../../sdd/monitoring/setup.js")
          const result = setupMonitoring(graph)
          return formatMonitoringSetup(result)
        }
        case "docs": {
          const { generateDocumentation } = await import("../../sdd/documentation/generator.js")
          const params = args.params_json ? JSON.parse(args.params_json) : {}
          return generateDocumentation(graph, params.format || "api")
        }
        case "onboarding": {
          const { generateOnboardingGuide } = await import("../../sdd/workflows/onboarding.js")
          return generateOnboardingGuide(graph, {} as any)
        }
        case "dashboard": return executeOriginalTool("sdd.generate_dashboard", parseJson(args.params_json), ctx)
        case "incident": return executeOriginalTool("sdd.report_incident", parseJson(args.params_json), ctx)
        case "sla": return executeOriginalTool("sdd.create_sla", parseJson(args.params_json), ctx)
        case "cost": return executeOriginalTool("sdd.estimate_cost", parseJson(args.params_json), ctx)
        case "knowledge_transfer": return executeOriginalTool("sdd.knowledge_transfer", parseJson(args.params_json), ctx)
        case "disaster_recovery": return executeOriginalTool("sdd.disaster_recovery_plan", parseJson(args.params_json), ctx)
        case "config_drift": return executeOriginalTool("sdd.config_drift", parseJson(args.params_json), ctx)
        case "workflow_export": return executeOriginalTool("sdd.workflow_export", parseJson(args.params_json), ctx)
        default:
          return `Unknown action: ${args.action}`
      }
    },
  })
}

// ── Composite: sdd.drift_whitelist ────────────────────────────────

export function createDriftWhitelistTool(): ToolDefinition {
  return tool({
    description: "Gerenciar whitelist de drift: adicionar, remover, listar.",
    args: {
      action: tool.schema.enum(["add", "remove", "list"]).describe("Operação a executar"),
      file_path: tool.schema.string().optional().describe("Caminho do arquivo ou padrão"),
      reason: tool.schema.string().optional().describe("Motivo (para add)"),
    },
    async execute(args, ctx) {
      switch (args.action) {
        case "add": {
          if (!args.file_path || !args.reason) return "file_path and reason are required"
          projectPath(ctx.directory, args.file_path)
          addToDriftWhitelist(ctx.directory, args.file_path, args.reason)
          const whitelist = loadDriftWhitelist(ctx.directory)
          return `✅ Whitelisted: ${args.file_path} — Total: ${whitelist.entries.length}`
        }
        case "remove": {
          if (!args.file_path) return "file_path is required"
          projectPath(ctx.directory, args.file_path)
          removeFromDriftWhitelist(ctx.directory, args.file_path)
          return `✅ Removed: ${args.file_path}`
        }
        case "list": {
          const whitelist = loadDriftWhitelist(ctx.directory)
          if (whitelist.entries.length === 0) return "Whitelist is empty."
          return whitelist.entries.map(e => `- **${e.file_path}** — ${e.reason}`).join("\n")
        }
        default:
          return `Unknown action: ${args.action}`
      }
    },
  })
}
