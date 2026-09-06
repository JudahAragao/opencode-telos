/**
 * Tool Taxonomy — Mapeamento hierárquico de tools do SDD.
 *
 * Cada tool composta agrupa tools originais relacionadas por domínio.
 * O LLM chama: `sdd.{composite}(action="sub_action")`
 *
 * Base para: router (intent classification), state gate, e redução de tools.
 */

export type ToolCategory = "graph" | "workflow" | "analysis" | "quality" | "sync" | "enterprise" | "admin"

export interface SubAction {
  name: string
  description: string
  /** Tools originais que esta sub-action substitui */
  replaces: string[]
}

export interface CompositeTool {
  name: string
  /** Nome curto para exibição no system prompt */
  label: string
  category: ToolCategory
  description: string
  actions: SubAction[]
}

/**
 * Todas as tools composits e suas sub-actions.
 * As tools originais listadas em `replaces` são deprecated e mantidas por compatibilidade.
 */
export const TOOL_TAXONOMY: CompositeTool[] = [
  // ── Graph Mutation ──────────────────────────────────────────────
  {
    name: "sdd.graph_mutation",
    label: "Graph Mutation",
    category: "graph",
    description: "Modificar a estrutura do Knowledge Graph: criar, atualizar, remover nós e relações.",
    actions: [
      { name: "add_node", description: "Adicionar um novo nó ao grafo", replaces: ["sdd.add_node"] },
      { name: "update_node", description: "Atualizar propriedades de um nó existente", replaces: ["sdd.update_node"] },
      { name: "remove_node", description: "Remover um nó do grafo", replaces: ["sdd.remove_node"] },
      { name: "add_relationship", description: "Criar uma relação entre dois nós", replaces: ["sdd.add_relationship"] },
      { name: "remove_relationship", description: "Remover uma relação entre dois nós", replaces: ["sdd.remove_relationship"] },
    ],
  },

  // ── Graph Query ─────────────────────────────────────────────────
  {
    name: "sdd.graph_query",
    label: "Graph Query",
    category: "graph",
    description: "Consultar o Knowledge Graph: buscar, filtrar, contar, listar nós.",
    actions: [
      { name: "count_nodes", description: "Contar nós por tipo ou status", replaces: ["sdd.count_nodes"] },
      { name: "get_nodes_by_status", description: "Listar nós filtrados por status", replaces: ["sdd.get_nodes_by_status"] },
      { name: "list_nodes", description: "Listar todos os nós de um tipo", replaces: ["sdd.list_nodes"] },
    ],
  },

  // ── Traverse ────────────────────────────────────────────────────
  {
    name: "sdd.traverse",
    label: "Traverse",
    category: "graph",
    description: "Percorrer o grafo: BFS, subgraph, path finding.",
    actions: [
      { name: "outgoing", description: "BFS nos nós de saída", replaces: ["sdd.traverse_outgoing"] },
      { name: "incoming", description: "BFS nos nós de entrada", replaces: ["sdd.traverse_incoming"] },
      { name: "both", description: "BFS em ambas direções", replaces: ["sdd.traverse_both"] },
      { name: "subgraph", description: "Extrair subgrafo centrado em um nó", replaces: ["sdd.get_subgraph"] },
      { name: "find_path", description: "Encontrar caminho entre dois nós", replaces: ["sdd.find_path"] },
    ],
  },

  // ── Permissions ─────────────────────────────────────────────────
  {
    name: "sdd.permissions",
    label: "Permissions",
    category: "admin",
    description: "Gerenciar permissões, roles, audit log e configuração de acesso.",
    actions: [
      { name: "set_role", description: "Definir role de um usuário", replaces: ["sdd.set_role"] },
      { name: "check", description: "Verificar permissão de um usuário", replaces: ["sdd.check_permission"] },
      { name: "audit", description: "Exibir audit log", replaces: ["sdd.audit_log"] },
      { name: "config", description: "Carregar config de permissões", replaces: ["sdd.load_permissions_config"] },
      { name: "save_config", description: "Salvar config de permissões", replaces: ["sdd.save_permissions_config"] },
      { name: "role", description: "Obter role do usuário atual", replaces: ["sdd.get_user_role"] },
      { name: "approval", description: "Verificar aprovação de change", replaces: ["sdd.check_change_approval"] },
    ],
  },

  // ── Snapshot & Rollback ─────────────────────────────────────────
  {
    name: "sdd.snapshot",
    label: "Snapshot",
    category: "admin",
    description: "Criar snapshots do grafo, rollback e histórico.",
    actions: [
      { name: "create", description: "Criar snapshot do estado atual", replaces: ["sdd.create_snapshot"] },
      { name: "rollback", description: "Executar rollback para um snapshot", replaces: ["sdd.rollback"] },
      { name: "history", description: "Histórico de rollbacks", replaces: ["sdd.rollback_history"] },
      { name: "list", description: "Listar todos os snapshots", replaces: ["sdd.list_snapshots"] },
    ],
  },

  // ── Sync ────────────────────────────────────────────────────────
  {
    name: "sdd.sync",
    label: "Sync",
    category: "sync",
    description: "Sincronizar grafo com repositório remoto: pull, push, conflitos.",
    actions: [
      { name: "status", description: "Status da sincronização", replaces: ["sdd.sync_status"] },
      { name: "pull", description: "Puxar mudanças remotas", replaces: ["sdd.sync_pull"] },
      { name: "push", description: "Enviar mudanças locais", replaces: ["sdd.sync_push"] },
      { name: "conflicts", description: "Detectar conflitos", replaces: ["sdd.detect_sync_conflicts"] },
      { name: "merge", description: "Merge de grafos", replaces: ["sdd.merge_graphs"] },
    ],
  },

  // ── Graph Admin ─────────────────────────────────────────────────
  {
    name: "sdd.graph_admin",
    label: "Graph Admin",
    category: "admin",
    description: "Administração do grafo: health, pruning, cache, convenções, padrões.",
    actions: [
      { name: "health", description: "Análise de saúde do grafo", replaces: ["sdd.graph_health"] },
      { name: "health_detail", description: "Análise detalhada de saúde", replaces: ["sdd.graph_health_detail"] },
      { name: "prune", description: "Remover nós obsoletos", replaces: ["sdd.graph_prune"] },
      { name: "cache", description: "Estatísticas de cache", replaces: ["sdd.cache_stats"] },
      { name: "conventions", description: "Detectar convenções do projeto", replaces: ["sdd.detect_conventions"] },
      { name: "learn", description: "Aprender padrões do grafo", replaces: ["sdd.learn_patterns"] },
    ],
  },

  // ── Code Quality ────────────────────────────────────────────────
  {
    name: "sdd.code_quality",
    label: "Code Quality",
    category: "quality",
    description: "Análise de qualidade de código: complexidade, métricas, smells, dependências, código morto.",
    actions: [
      { name: "complexity", description: "Analisar complexidade ciclomática", replaces: ["sdd.analyze_complexity"] },
      { name: "metrics", description: "Calcular métricas de código", replaces: ["sdd.code_metrics"] },
      { name: "smells", description: "Detectar code smells", replaces: ["sdd.detect_smells"] },
      { name: "dependencies", description: "Analisar dependências e acoplamento", replaces: ["sdd.analyze_dependencies"] },
      { name: "usage", description: "Verificar uso de código", replaces: ["sdd.verify_usage"] },
      { name: "dead_code", description: "Encontrar código morto", replaces: ["sdd.find_dead_code"] },
      { name: "remove_dead_code", description: "Remover código morto (requer SDD workflow)", replaces: ["sdd.remove_dead_code"] },
      { name: "parse_symbols", description: "Extrair símbolos de arquivos", replaces: ["sdd.parse_symbols"] },
      { name: "plan_implementation", description: "Planejar implementação conectando código a spec", replaces: ["sdd.plan_implementation"] },
      { name: "analyze_codebase", description: "Analisar codebase inteira", replaces: ["sdd.analyze_codebase"] },
    ],
  },

  // ── Enterprise ──────────────────────────────────────────────────
  {
    name: "sdd.enterprise",
    label: "Enterprise",
    category: "enterprise",
    description: "Workflows empresariais: migrations, experiments, feature flags, multi-tenancy.",
    actions: [
      { name: "migration", description: "Criar migração de dados", replaces: ["sdd.create_migration"] },
      { name: "experiment", description: "Criar experimento A/B", replaces: ["sdd.create_experiment"] },
      { name: "flag", description: "Criar feature flag", replaces: ["sdd.create_flag"] },
      { name: "tenant", description: "Configurar multi-tenancy", replaces: ["sdd.create_tenant"] },
      { name: "security_audit", description: "Auditoria de segurança", replaces: ["sdd.security_audit"] },
      { name: "scalability", description: "Análise de escalabilidade", replaces: ["sdd.analyze_scalability"] },
      { name: "compliance", description: "Verificar compliance", replaces: ["sdd.check_compliance"] },
      { name: "monitoring", description: "Configurar monitoramento", replaces: ["sdd.setup_monitoring"] },
      { name: "dashboard", description: "Gerar dashboard", replaces: ["sdd.generate_dashboard"] },
      { name: "incident", description: "Reportar incidente", replaces: ["sdd.report_incident"] },
      { name: "sla", description: "Criar SLA", replaces: ["sdd.create_sla"] },
      { name: "cost", description: "Estimar custos", replaces: ["sdd.estimate_cost"] },
      { name: "docs", description: "Gerar documentação", replaces: ["sdd.generate_docs"] },
      { name: "onboarding", description: "Guia de onboarding", replaces: ["sdd.onboard_developer"] },
      { name: "knowledge_transfer", description: "Transferência de conhecimento", replaces: ["sdd.knowledge_transfer"] },
      { name: "disaster_recovery", description: "Plano de disaster recovery", replaces: ["sdd.disaster_recovery_plan"] },
      { name: "config_drift", description: "Detectar config drift", replaces: ["sdd.config_drift"] },
      { name: "workflow_export", description: "Exportar workflow", replaces: ["sdd.workflow_export"] },
    ],
  },

  // ── Drift Whitelist ─────────────────────────────────────────────
  {
    name: "sdd.drift_whitelist",
    label: "Drift Whitelist",
    category: "analysis",
    description: "Gerenciar whitelist de drift: adicionar, remover, listar.",
    actions: [
      { name: "add", description: "Adicionar arquivo/padrão à whitelist", replaces: ["sdd.whitelist_drift"] },
      { name: "remove", description: "Remover arquivo da whitelist", replaces: ["sdd.unwhitelist_drift"] },
      { name: "list", description: "Listar todos na whitelist", replaces: ["sdd.list_whitelist"] },
    ],
  },
]

/** Mapeamento: tool original → tool composta + action */
export const TOOL_TO_COMPOSITE = new Map<string, { composite: string; action: string }>()

for (const tool of TOOL_TAXONOMY) {
  for (const action of tool.actions) {
    for (const original of action.replaces) {
      TOOL_TO_COMPOSITE.set(original, { composite: tool.name, action: action.name })
    }
  }
}

/** Tools que NÃO foram compostas (mantidas isoladas) */
export const STANDALONE_TOOLS = [
  "sdd.initialize",
  "sdd.inspect",
  "sdd.query_graph",
  "sdd.analyze_impact",
  "sdd.create_change",
  "sdd.discover",
  "sdd.update_from_answers",
  "sdd.validate",
  "sdd.detect_drift",
  "sdd.get_context",
  "sdd.approve_change",
  "sdd.complete_change",
  "sdd.fail_change",
  "sdd.change_history",
  "sdd.impact_report",
  "sdd.pending_changes",
  "sdd.generate_code",
  "sdd.enforce",
  "sdd.enforce_rules",
  "sdd.full_cycle",
  "sdd.toggle",
  "sdd.constitution",
  "sdd.promises",
  "sdd.quality",
  "sdd.session_handoff",
  "sdd.anti_patterns",
  "sdd.clone_detection",
  "sdd.contradictions",
  "sdd.coverage",
  "sdd.install_hooks",
  "sdd.brownfield_scan",
  "sdd.generate_cicd",
  "sdd.bug_fix",
  "sdd.hotfix",
  "sdd.refactoring",
  "sdd.deprecate",
  "sdd.toggle_status",
  "sdd.drift_signals",
  "sdd.build_graph",
  "sdd.auto_link_tests",
  "sdd.migrate_storage",
  "sdd.start_dashboard",
  "sdd.mcp_server_info",
  "sdd.handle_mcp_tool",
]

/** Todas as tools originais que foram substituídas por composits */
export const DEPRECATED_TOOLS: string[] = []
for (const tool of TOOL_TAXONOMY) {
  for (const action of tool.actions) {
    DEPRECATED_TOOLS.push(...action.replaces)
  }
}

/** Verificar se uma tool original foi composta */
export function isDeprecatedTool(toolName: string): boolean {
  return TOOL_TO_COMPOSITE.has(toolName)
}

/** Obter a tool composta equivalente */
export function getCompositeForTool(toolName: string): { composite: string; action: string } | undefined {
  return TOOL_TO_COMPOSITE.get(toolName)
}

/** Contar total de tools ativas (composits + standalone) */
export function countActiveTools(): { composite: number; standalone: number; total: number } {
  return {
    composite: TOOL_TAXONOMY.length,
    standalone: STANDALONE_TOOLS.length,
    total: TOOL_TAXONOMY.length + STANDALONE_TOOLS.length,
  }
}
