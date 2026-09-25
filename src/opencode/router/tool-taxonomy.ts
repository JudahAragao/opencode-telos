/**
 * Tool Taxonomy — Hierarchical mapping of SDD tools.
 *
 * Each composite tool groups related capabilities by domain.
 * O LLM chama: `sdd.{composite}(action="sub_action")`
 *
 * Base para: router (intent classification), state gate, e system prompt.
 */

import { STANDALONE_CATEGORIES } from "./categories.js"

export type ToolCategory = "graph" | "workflow" | "analysis" | "quality" | "sync" | "enterprise" | "admin"

export interface SubAction {
  name: string
  description: string
}

export interface CompositeTool {
  name: string
  /** Short name for display in the system prompt */
  label: string
  category: ToolCategory
  description: string
  actions: SubAction[]
}

/**
 * Todas as tools composits e suas sub-actions.
 */
export const TOOL_TAXONOMY: CompositeTool[] = [
  // ── Graph Mutation ──────────────────────────────────────────────
  {
    name: "sdd.graph_mutation",
    label: "Graph Mutation",
    category: "graph",
    description: "Modify the Knowledge Graph structure: create, update, remove nodes and relationships.",
    actions: [
      { name: "add_node", description: "Add a new node to the graph" },
      { name: "update_node", description: "Update properties of an existing node" },
      { name: "remove_node", description: "Remove a node from the graph" },
      { name: "add_relationship", description: "Create a relationship between two nodes" },
      { name: "remove_relationship", description: "Remove a relationship between two nodes" },
    ],
  },

  // ── Graph Query ─────────────────────────────────────────────────
  {
    name: "sdd.graph_query",
    label: "Graph Query",
    category: "graph",
    description: "Query the Knowledge Graph: search, filter, count, list nodes.",
    actions: [
      { name: "count_nodes", description: "Count nodes by type or status" },
      { name: "get_nodes_by_status", description: "List nodes filtered by status" },
      { name: "list_nodes", description: "List all nodes of a type" },
    ],
  },

  // ── Traverse ────────────────────────────────────────────────────
  {
    name: "sdd.traverse",
    label: "Traverse",
    category: "graph",
    description: "Percorrer o grafo: BFS, subgraph, path finding.",
    actions: [
      { name: "outgoing", description: "BFS on outgoing nodes" },
      { name: "incoming", description: "BFS on incoming nodes" },
      { name: "both", description: "BFS in both directions" },
      { name: "subgraph", description: "Extract the subgraph centered on a node" },
      { name: "find_path", description: "Find a path between two nodes" },
    ],
  },

  // ── Permissions ─────────────────────────────────────────────────
  {
    name: "sdd.permissions",
    label: "Permissions",
    category: "admin",
    description: "Manage permissions, roles, audit log and access configuration.",
    actions: [
      { name: "set_role", description: "Set a user's role" },
      { name: "check", description: "Check a user's permission" },
      { name: "audit", description: "Exibir audit log" },
      { name: "config", description: "Load permission config" },
      { name: "save_config", description: "Save permission config" },
      { name: "role", description: "Get the current user's role" },
      { name: "approval", description: "Check change approval" },
    ],
  },

  // ── Snapshot & Rollback ─────────────────────────────────────────
  {
    name: "sdd.snapshot",
    label: "Snapshot",
    category: "admin",
    description: "Create graph snapshots, rollback and history.",
    actions: [
      { name: "create", description: "Create a snapshot of the current state" },
      { name: "rollback", description: "Roll back to a snapshot" },
      { name: "history", description: "Rollback history" },
      { name: "list", description: "List all snapshots" },
    ],
  },

  // ── Sync ────────────────────────────────────────────────────────
  {
    name: "sdd.sync",
    label: "Sync",
    category: "sync",
    description: "Sync the graph with a remote repository: pull, push, conflicts.",
    actions: [
      { name: "status", description: "Sync status" },
      { name: "pull", description: "Pull remote changes" },
      { name: "push", description: "Push local changes" },
      { name: "conflicts", description: "Detectar conflitos" },
      { name: "merge", description: "Merge de grafos" },
    ],
  },

  // ── Graph Admin ─────────────────────────────────────────────────
  {
    name: "sdd.graph_admin",
    label: "Graph Admin",
    category: "admin",
    description: "Graph administration: health, pruning, cache, conventions, patterns.",
    actions: [
      { name: "health", description: "Graph health analysis" },
      { name: "health_detail", description: "Detailed health analysis" },
      { name: "prune", description: "Remove obsolete nodes" },
      { name: "cache", description: "Cache statistics" },
      { name: "conventions", description: "Detect project conventions" },
      { name: "learn", description: "Learn patterns from the graph" },
    ],
  },

  // ── Code Quality ────────────────────────────────────────────────
  {
    name: "sdd.code_quality",
    label: "Code Quality",
    category: "quality",
    description: "Code quality analysis: complexity, metrics, smells, dependencies, dead code.",
    actions: [
      { name: "complexity", description: "Analyze cyclomatic complexity" },
      { name: "metrics", description: "Compute code metrics" },
      { name: "smells", description: "Detectar code smells" },
      { name: "dependencies", description: "Analyze dependencies and coupling" },
      { name: "usage", description: "Check code usage" },
      { name: "dead_code", description: "Find dead code" },
      { name: "remove_dead_code", description: "Remove dead code (requires SDD workflow)" },
      { name: "parse_symbols", description: "Extract symbols from files" },
      { name: "plan_implementation", description: "Plan implementation connecting code to spec" },
      { name: "analyze_codebase", description: "Analisar codebase inteira" },
    ],
  },

  // ── Enterprise ──────────────────────────────────────────────────
  {
    name: "sdd.enterprise",
    label: "Enterprise",
    category: "enterprise",
    description: "Workflows empresariais: migrations, experiments, feature flags, multi-tenancy.",
    actions: [
      { name: "migration", description: "Create a data migration" },
      { name: "experiment", description: "Create an A/B experiment" },
      { name: "flag", description: "Create a feature flag" },
      { name: "tenant", description: "Configure multi-tenancy" },
      { name: "security_audit", description: "Security audit" },
      { name: "scalability", description: "Scalability analysis" },
      { name: "compliance", description: "Check compliance" },
      { name: "monitoring", description: "Configure monitoring" },
      { name: "dashboard", description: "Generate a dashboard" },
      { name: "incident", description: "Reportar incidente" },
      { name: "sla", description: "Create an SLA" },
      { name: "cost", description: "Estimar custos" },
      { name: "docs", description: "Generate documentation" },
      { name: "onboarding", description: "Guia de onboarding" },
      { name: "knowledge_transfer", description: "Knowledge transfer" },
      { name: "disaster_recovery", description: "Plano de disaster recovery" },
      { name: "config_drift", description: "Detectar config drift" },
      { name: "workflow_export", description: "Exportar workflow" },
    ],
  },

  // ── Drift Whitelist ─────────────────────────────────────────────
  {
    name: "sdd.drift_whitelist",
    label: "Drift Whitelist",
    category: "analysis",
    description: "Manage the drift whitelist: add, remove, list.",
    actions: [
      { name: "add", description: "Add a file/pattern to the whitelist" },
      { name: "remove", description: "Remove a file from the whitelist" },
      { name: "list", description: "List everything in the whitelist" },
    ],
  },
]

/**
 * Tools que NÃO foram compostas (mantidas isoladas).
 *
 * Derived from `STANDALONE_CATEGORIES` so there is a single source for the
 * catalog.
 */
export const STANDALONE_TOOLS: string[] = Object.keys(STANDALONE_CATEGORIES)

/** Contar total de tools ativas (composits + standalone) */
export function countActiveTools(): { composite: number; standalone: number; total: number } {
  return {
    composite: TOOL_TAXONOMY.length,
    standalone: STANDALONE_TOOLS.length,
    total: TOOL_TAXONOMY.length + STANDALONE_TOOLS.length,
  }
}
