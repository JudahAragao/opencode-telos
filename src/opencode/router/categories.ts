/**
 * Categories — Mapping of tools to intent categories.
 *
 * Each tool is classified into one or more categories.
 * O intent classifier usa isso para filtrar tools por categoria.
 *
 * This file is the single source of the standalone tool catalog: the list of
 * names in `STANDALONE_TOOLS` (tool-taxonomy.ts) is derived from
 * `STANDALONE_CATEGORIES`. Sempre que uma tool nova for registrada em
 * `createSddTools()`, ela precisa de uma entrada aqui — o teste
 * tests/tool-catalog.test.ts fails otherwise.
 *
 * Consumido por: intent-classifier.ts, tool-registry.ts, state-gate.ts
 * Dependencies: none (pure module, no imports)
 */

/**
 * User intent categories.
 */
export type IntentCategory =
  | "mutation"      // Create, modify, remove nodes/relationships
  | "query"         // Buscar, consultar, inspecionar o grafo
  | "workflow"      // Manage changes, approvals, lifecycle
  | "analysis"      // Impact, drift and validation analysis
  | "quality"       // Code quality, metrics, smells
  | "enterprise"    // Workflows empresariais (migration, security, etc.)
  | "admin"         // Administration: permissions, sync, cache, snapshots
  | "discovery"     // Requirement discovery, briefing, questions
  | "implementation" // Code generation, planning, implementation
  | "info"          // Information: status, history, help

/**
 * Mapping of CANONICAL standalone tools to intent categories.
 *
 * Apenas capacidades sem substituta composta aparecem aqui. Toda tool cuja
 * action already lives in a composite (`TOOL_TAXONOMY[i].actions[].replaces`) is
 * deprecated and does NOT enter this map: `createSddTools()` also filters it, so
 * there is a single name per capability in the catalog announced to the LLM.
 *
 * tests/tool-catalog.test.ts guarantees this map is identical to the registered
 * standalone tools, and that no entry is deprecated.
 */
export const STANDALONE_CATEGORIES: Record<string, IntentCategory[]> = {
  // ── Mutation ────────────────────────────────────────────────────
  "sdd.initialize": ["mutation"],
  "sdd.build_graph": ["mutation", "discovery"],
  "sdd.update_from_answers": ["mutation", "discovery"],
  "sdd.auto_link_tests": ["implementation", "mutation"],
  "sdd.infer_relationships": ["analysis", "mutation"],
  "sdd.milestone": ["workflow", "analysis", "mutation"],
  "sdd.integrate_tasks": ["workflow", "implementation", "mutation"],
  "sdd.acceptance": ["workflow", "mutation", "query"],
  "sdd.node_guidance": ["mutation", "workflow", "analysis"],
  "sdd.impact": ["analysis", "query"],

  // ── Query ───────────────────────────────────────────────────────
  "sdd.inspect": ["query"],
  "sdd.query_graph": ["query"],
  "sdd.get_context": ["query"],

  // ── Discovery ───────────────────────────────────────────────────
  "sdd.discover": ["discovery"],

  // ── Workflow ────────────────────────────────────────────────────
  "sdd.enforce": ["workflow"],
  "sdd.renew_workflow": ["workflow", "admin"],
  "sdd.enforce_rules": ["workflow", "info"],
  "sdd.full_cycle": ["workflow", "implementation"],
  "sdd.create_change": ["workflow"],
  "sdd.approve_change": ["workflow"],
  "sdd.complete_change": ["workflow"],
  "sdd.fail_change": ["workflow"],
  "sdd.pending_changes": ["workflow", "info"],
  "sdd.verify_implementation": ["implementation", "workflow"],
  "sdd.check_migrations": ["admin", "workflow"],
  "sdd.run_migrations": ["admin", "workflow"],
  "sdd.workflow_new_feature": ["workflow", "implementation"],
  "sdd.workflow_bug_fix": ["workflow", "implementation"],
  "sdd.workflow_hotfix": ["workflow", "implementation"],
  "sdd.workflow_refactor": ["workflow", "implementation"],
  "sdd.workflow_full_cycle": ["workflow", "implementation"],
  "sdd.workflow_reverse_engineer": ["workflow", "discovery"],

  // ── Analysis ────────────────────────────────────────────────────
  "sdd.analyze_impact": ["analysis"],
  "sdd.impact_report": ["analysis"],
  "sdd.validate": ["analysis"],
  "sdd.detect_drift": ["analysis"],
  "sdd.drift_signals": ["analysis"],
  "sdd.anti_patterns": ["analysis"],
  "sdd.clone_detection": ["analysis"],
  "sdd.contradictions": ["analysis"],
  "sdd.coverage": ["analysis"],
  "sdd.promises": ["analysis"],
  "sdd.constitution": ["analysis"],
  "sdd.quality": ["analysis", "quality"],
  "sdd.brownfield_scan": ["analysis"],
  "sdd.reverse_engineer": ["discovery", "analysis"],
  "sdd.findings": ["analysis", "workflow", "mutation"],

  // ── Implementation ──────────────────────────────────────────────
  "sdd.generate_code": ["implementation"],
  "sdd.install_hooks": ["implementation"],
  "sdd.generate_cicd": ["implementation", "enterprise"],

  // ── Enterprise ──────────────────────────────────────────────────
  "sdd.bug_fix": ["workflow", "implementation", "enterprise"],
  "sdd.hotfix": ["workflow", "implementation", "enterprise"],
  "sdd.refactoring": ["workflow", "implementation", "enterprise"],
  "sdd.deprecate": ["workflow", "enterprise"],

  // ── Admin ───────────────────────────────────────────────────────
  "sdd.toggle": ["admin"],
  "sdd.toggle_status": ["admin"],
  "sdd.remote_status": ["admin", "info"],
  "sdd.migrate_storage": ["admin"],
  "sdd.start_dashboard": ["admin", "info"],

  // ── Info ────────────────────────────────────────────────────────
  "sdd.change_history": ["info"],
  "sdd.session_handoff": ["info"],
  "sdd.mcp_server_info": ["info"],
  "sdd.handle_mcp_tool": ["info"],
  "sdd.telemetry": ["info"],
  "sdd.record_feedback": ["info"],
}

/**
 * Mapping of composite tools to intent categories.
 */
export const COMPOSITE_CATEGORIES: Record<string, IntentCategory[]> = {
  "sdd.graph_mutation": ["mutation"],
  "sdd.graph_query": ["query"],
  "sdd.traverse": ["query"],
  "sdd.permissions": ["admin"],
  "sdd.snapshot": ["admin"],
  "sdd.sync": ["admin"],
  "sdd.graph_admin": ["admin", "analysis"],
  "sdd.code_quality": ["quality"],
  "sdd.enterprise": ["enterprise"],
  "sdd.drift_whitelist": ["analysis"],
}

/**
 * Gets the intent categories for a tool.
 */
export function getToolCategories(toolName: string): IntentCategory[] {
  if (STANDALONE_CATEGORIES[toolName]) return STANDALONE_CATEGORIES[toolName]
  if (COMPOSITE_CATEGORIES[toolName]) return COMPOSITE_CATEGORIES[toolName]
  return ["info"] // fallback
}

/**
 * Indica se a tool tem categoria declarada explicitamente (sem fallback).
 */
export function hasToolCategory(toolName: string): boolean {
  return Boolean(STANDALONE_CATEGORIES[toolName] || COMPOSITE_CATEGORIES[toolName])
}

/**
 * Gets all tools of an intent category.
 */
export function getToolsByCategory(category: IntentCategory): string[] {
  const tools: string[] = []

  for (const [name, categories] of Object.entries(STANDALONE_CATEGORIES)) {
    if (categories.includes(category)) tools.push(name)
  }
  for (const [name, categories] of Object.entries(COMPOSITE_CATEGORIES)) {
    if (categories.includes(category)) tools.push(name)
  }

  return tools
}

/**
 * Gets the categories represented in a set of tools.
 */
export function getCategoriesInToolSet(toolNames: Set<string>): IntentCategory[] {
  const categories = new Set<IntentCategory>()
  for (const name of toolNames) {
    for (const cat of getToolCategories(name)) {
      categories.add(cat)
    }
  }
  return [...categories]
}

/**
 * Keywords associated with each intent category.
 * Usado como sinal auxiliar no intent classifier.
 */
export const CATEGORY_KEYWORDS: Record<IntentCategory, string[]> = {
  mutation: [
    "criar", "adicionar", "remover", "deletar", "modificar", "atualizar",
    "create", "add", "remove", "delete", "modify", "update",
  ],
  query: [
    "buscar", "consultar", "mostrar", "listar", "ver", "inspecionar",
    "search", "query", "show", "list", "find", "inspect", "get",
  ],
  workflow: [
    "aprovar", "rejeitar", "completar", "falhar", "mudar", "change",
    "approve", "reject", "complete", "fail", "change", "enforce",
  ],
  analysis: [
    "analisar", "validar", "verificar", "detectar", "drift", "impacto",
    "analyze", "validate", "verify", "detect", "drift", "impact",
  ],
  quality: [
    "qualidade", "métrica", "smell", "complexidade", "dependência",
    "quality", "metric", "smell", "complexity", "dependency", "dead code",
  ],
  enterprise: [
    "migration", "experimento", "flag", "tenant", "segurança", "compliance",
    "security", "monitoring", "incident", "sla", "custo",
  ],
  admin: [
    "permissão", "role", "audit", "sync", "snapshot", "rollback", "cache",
    "permission", "role", "sync", "snapshot", "rollback",
  ],
  discovery: [
    "briefing", "descobrir", "perguntar", "especificação", "requisito",
    "discover", "briefing", "question", "specification", "requirement",
    "reverse", "engineering", "reversa", "documentar", "documentação", "scan",
    "existing", "codebase", "existente", "código",
  ],
  implementation: [
    "implementar", "gerar código", "code", "generate", "planejar",
    "implement", "build", "write", "plan",
  ],
  info: [
    "status", "histórico", "help", "informação", "info",
    "status", "history", "help", "information", "info",
  ],
}
