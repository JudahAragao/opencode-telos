/**
 * Tool Taxonomy — Mapeamento hierárquico de tools do SDD.
 *
 * Cada tool composta agrupa capacidades relacionadas por domínio.
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
  /** Nome curto para exibição no system prompt */
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
    description: "Modificar a estrutura do Knowledge Graph: criar, atualizar, remover nós e relações.",
    actions: [
      { name: "add_node", description: "Adicionar um novo nó ao grafo" },
      { name: "update_node", description: "Atualizar propriedades de um nó existente" },
      { name: "remove_node", description: "Remover um nó do grafo" },
      { name: "add_relationship", description: "Criar uma relação entre dois nós" },
      { name: "remove_relationship", description: "Remover uma relação entre dois nós" },
    ],
  },

  // ── Graph Query ─────────────────────────────────────────────────
  {
    name: "sdd.graph_query",
    label: "Graph Query",
    category: "graph",
    description: "Consultar o Knowledge Graph: buscar, filtrar, contar, listar nós.",
    actions: [
      { name: "count_nodes", description: "Contar nós por tipo ou status" },
      { name: "get_nodes_by_status", description: "Listar nós filtrados por status" },
      { name: "list_nodes", description: "Listar todos os nós de um tipo" },
    ],
  },

  // ── Traverse ────────────────────────────────────────────────────
  {
    name: "sdd.traverse",
    label: "Traverse",
    category: "graph",
    description: "Percorrer o grafo: BFS, subgraph, path finding.",
    actions: [
      { name: "outgoing", description: "BFS nos nós de saída" },
      { name: "incoming", description: "BFS nos nós de entrada" },
      { name: "both", description: "BFS em ambas direções" },
      { name: "subgraph", description: "Extrair subgrafo centrado em um nó" },
      { name: "find_path", description: "Encontrar caminho entre dois nós" },
    ],
  },

  // ── Permissions ─────────────────────────────────────────────────
  {
    name: "sdd.permissions",
    label: "Permissions",
    category: "admin",
    description: "Gerenciar permissões, roles, audit log e configuração de acesso.",
    actions: [
      { name: "set_role", description: "Definir role de um usuário" },
      { name: "check", description: "Verificar permissão de um usuário" },
      { name: "audit", description: "Exibir audit log" },
      { name: "config", description: "Carregar config de permissões" },
      { name: "save_config", description: "Salvar config de permissões" },
      { name: "role", description: "Obter role do usuário atual" },
      { name: "approval", description: "Verificar aprovação de change" },
    ],
  },

  // ── Snapshot & Rollback ─────────────────────────────────────────
  {
    name: "sdd.snapshot",
    label: "Snapshot",
    category: "admin",
    description: "Criar snapshots do grafo, rollback e histórico.",
    actions: [
      { name: "create", description: "Criar snapshot do estado atual" },
      { name: "rollback", description: "Executar rollback para um snapshot" },
      { name: "history", description: "Histórico de rollbacks" },
      { name: "list", description: "Listar todos os snapshots" },
    ],
  },

  // ── Sync ────────────────────────────────────────────────────────
  {
    name: "sdd.sync",
    label: "Sync",
    category: "sync",
    description: "Sincronizar grafo com repositório remoto: pull, push, conflitos.",
    actions: [
      { name: "status", description: "Status da sincronização" },
      { name: "pull", description: "Puxar mudanças remotas" },
      { name: "push", description: "Enviar mudanças locais" },
      { name: "conflicts", description: "Detectar conflitos" },
      { name: "merge", description: "Merge de grafos" },
    ],
  },

  // ── Graph Admin ─────────────────────────────────────────────────
  {
    name: "sdd.graph_admin",
    label: "Graph Admin",
    category: "admin",
    description: "Administração do grafo: health, pruning, cache, convenções, padrões.",
    actions: [
      { name: "health", description: "Análise de saúde do grafo" },
      { name: "health_detail", description: "Análise detalhada de saúde" },
      { name: "prune", description: "Remover nós obsoletos" },
      { name: "cache", description: "Estatísticas de cache" },
      { name: "conventions", description: "Detectar convenções do projeto" },
      { name: "learn", description: "Aprender padrões do grafo" },
    ],
  },

  // ── Code Quality ────────────────────────────────────────────────
  {
    name: "sdd.code_quality",
    label: "Code Quality",
    category: "quality",
    description: "Análise de qualidade de código: complexidade, métricas, smells, dependências, código morto.",
    actions: [
      { name: "complexity", description: "Analisar complexidade ciclomática" },
      { name: "metrics", description: "Calcular métricas de código" },
      { name: "smells", description: "Detectar code smells" },
      { name: "dependencies", description: "Analisar dependências e acoplamento" },
      { name: "usage", description: "Verificar uso de código" },
      { name: "dead_code", description: "Encontrar código morto" },
      { name: "remove_dead_code", description: "Remover código morto (requer SDD workflow)" },
      { name: "parse_symbols", description: "Extrair símbolos de arquivos" },
      { name: "plan_implementation", description: "Planejar implementação conectando código a spec" },
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
      { name: "migration", description: "Criar migração de dados" },
      { name: "experiment", description: "Criar experimento A/B" },
      { name: "flag", description: "Criar feature flag" },
      { name: "tenant", description: "Configurar multi-tenancy" },
      { name: "security_audit", description: "Auditoria de segurança" },
      { name: "scalability", description: "Análise de escalabilidade" },
      { name: "compliance", description: "Verificar compliance" },
      { name: "monitoring", description: "Configurar monitoramento" },
      { name: "dashboard", description: "Gerar dashboard" },
      { name: "incident", description: "Reportar incidente" },
      { name: "sla", description: "Criar SLA" },
      { name: "cost", description: "Estimar custos" },
      { name: "docs", description: "Gerar documentação" },
      { name: "onboarding", description: "Guia de onboarding" },
      { name: "knowledge_transfer", description: "Transferência de conhecimento" },
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
    description: "Gerenciar whitelist de drift: adicionar, remover, listar.",
    actions: [
      { name: "add", description: "Adicionar arquivo/padrão à whitelist" },
      { name: "remove", description: "Remover arquivo da whitelist" },
      { name: "list", description: "Listar todos na whitelist" },
    ],
  },
]

/**
 * Tools que NÃO foram compostas (mantidas isoladas).
 *
 * Derivado de `STANDALONE_CATEGORIES` para que exista uma única fonte do
 * catálogo.
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
