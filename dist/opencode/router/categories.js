/**
 * Categories — Mapeamento de tools para categorias de intenção.
 *
 * Cada tool é classificada em uma ou mais categorias.
 * O intent classifier usa isso para filtrar tools por categoria.
 *
 * Este arquivo é a fonte única do catálogo de tools standalone: a lista de
 * nomes em `STANDALONE_TOOLS` (tool-taxonomy.ts) é derivada de
 * `STANDALONE_CATEGORIES`. Sempre que uma tool nova for registrada em
 * `createSddTools()`, ela precisa de uma entrada aqui — o teste
 * tests/tool-catalog.test.ts falha caso contrário.
 *
 * Consumido por: intent-classifier.ts, tool-registry.ts, state-gate.ts
 * Dependências: nenhuma (módulo puro, sem imports)
 */
/**
 * Mapeamento de tools standalone para categorias de intenção.
 */
export const STANDALONE_CATEGORIES = {
    // ── Mutation ────────────────────────────────────────────────────
    "sdd.initialize": ["mutation"],
    "sdd.build_graph": ["mutation", "discovery"],
    "sdd.update_from_answers": ["mutation", "discovery"],
    "sdd.add_node": ["mutation"],
    "sdd.update_node": ["mutation"],
    "sdd.remove_node": ["mutation"],
    "sdd.add_relationship": ["mutation"],
    "sdd.remove_relationship": ["mutation"],
    "sdd.remove_dead_code": ["quality", "mutation"],
    "sdd.graph_prune": ["admin", "mutation"],
    "sdd.whitelist_drift": ["analysis", "mutation"],
    "sdd.unwhitelist_drift": ["analysis", "mutation"],
    "sdd.auto_link_tests": ["implementation", "mutation"],
    "sdd.integrate_tasks": ["workflow", "implementation", "mutation"],
    // ── Query ───────────────────────────────────────────────────────
    "sdd.inspect": ["query"],
    "sdd.query_graph": ["query"],
    "sdd.get_context": ["query"],
    "sdd.list_nodes": ["query"],
    "sdd.count_nodes": ["query"],
    "sdd.get_nodes_by_status": ["query"],
    "sdd.find_path": ["query"],
    "sdd.traverse_outgoing": ["query"],
    "sdd.traverse_incoming": ["query"],
    "sdd.traverse_both": ["query"],
    "sdd.get_subgraph": ["query"],
    "sdd.list_whitelist": ["analysis", "query"],
    "sdd.list_snapshots": ["admin", "query"],
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
    "sdd.check_change_approval": ["admin", "workflow"],
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
    "sdd.config_drift": ["analysis"],
    "sdd.anti_patterns": ["analysis"],
    "sdd.clone_detection": ["analysis"],
    "sdd.contradictions": ["analysis"],
    "sdd.coverage": ["analysis"],
    "sdd.promises": ["analysis"],
    "sdd.constitution": ["analysis"],
    "sdd.quality": ["analysis", "quality"],
    "sdd.graph_health": ["analysis", "admin"],
    "sdd.graph_health_detail": ["analysis", "admin"],
    "sdd.brownfield_scan": ["analysis"],
    "sdd.reverse_engineer": ["discovery", "analysis"],
    "sdd.analyze_codebase": ["quality", "analysis"],
    "sdd.detect_sync_conflicts": ["admin", "analysis"],
    "sdd.security_audit": ["analysis", "enterprise"],
    "sdd.analyze_scalability": ["analysis", "enterprise"],
    "sdd.check_compliance": ["analysis", "enterprise"],
    // ── Quality ─────────────────────────────────────────────────────
    "sdd.analyze_complexity": ["quality"],
    "sdd.code_metrics": ["quality"],
    "sdd.detect_smells": ["quality"],
    "sdd.analyze_dependencies": ["quality"],
    "sdd.verify_usage": ["quality"],
    "sdd.find_dead_code": ["quality"],
    "sdd.parse_symbols": ["quality", "implementation"],
    "sdd.plan_implementation": ["quality", "implementation"],
    "sdd.detect_conventions": ["admin", "quality"],
    "sdd.learn_patterns": ["admin", "quality"],
    // ── Implementation ──────────────────────────────────────────────
    "sdd.generate_code": ["implementation"],
    "sdd.install_hooks": ["implementation"],
    "sdd.generate_cicd": ["implementation", "enterprise"],
    // ── Enterprise ──────────────────────────────────────────────────
    "sdd.bug_fix": ["workflow", "implementation", "enterprise"],
    "sdd.hotfix": ["workflow", "implementation", "enterprise"],
    "sdd.refactoring": ["workflow", "implementation", "enterprise"],
    "sdd.deprecate": ["workflow", "enterprise"],
    "sdd.create_migration": ["workflow", "enterprise"],
    "sdd.create_experiment": ["workflow", "enterprise"],
    "sdd.create_flag": ["workflow", "enterprise"],
    "sdd.create_tenant": ["workflow", "enterprise"],
    "sdd.onboard_developer": ["workflow", "enterprise"],
    "sdd.setup_monitoring": ["workflow", "enterprise"],
    "sdd.generate_dashboard": ["enterprise", "info"],
    "sdd.report_incident": ["workflow", "enterprise"],
    "sdd.create_sla": ["workflow", "enterprise"],
    "sdd.estimate_cost": ["enterprise"],
    "sdd.generate_docs": ["workflow", "enterprise"],
    "sdd.knowledge_transfer": ["workflow", "enterprise"],
    "sdd.disaster_recovery_plan": ["workflow", "enterprise"],
    // ── Admin ───────────────────────────────────────────────────────
    "sdd.toggle": ["admin"],
    "sdd.toggle_status": ["admin"],
    "sdd.sync_status": ["admin"],
    "sdd.sync_pull": ["admin"],
    "sdd.sync_push": ["admin"],
    "sdd.merge_graphs": ["admin"],
    "sdd.create_snapshot": ["admin"],
    "sdd.rollback": ["admin"],
    "sdd.rollback_history": ["admin", "info"],
    "sdd.set_role": ["admin"],
    "sdd.check_permission": ["admin"],
    "sdd.get_user_role": ["admin"],
    "sdd.load_permissions_config": ["admin"],
    "sdd.save_permissions_config": ["admin"],
    "sdd.audit_log": ["admin", "info"],
    "sdd.remote_status": ["admin", "info"],
    "sdd.migrate_storage": ["admin"],
    "sdd.cache_stats": ["admin", "info"],
    "sdd.start_dashboard": ["admin", "info"],
    // ── Info ────────────────────────────────────────────────────────
    "sdd.change_history": ["info"],
    "sdd.session_handoff": ["info"],
    "sdd.workflow_export": ["info"],
    "sdd.mcp_server_info": ["info"],
    "sdd.handle_mcp_tool": ["info"],
    "sdd.telemetry": ["info"],
    "sdd.record_feedback": ["info"],
};
/**
 * Mapeamento de tools composits para categorias de intenção.
 */
export const COMPOSITE_CATEGORIES = {
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
};
/**
 * Obtém as categorias de intenção para uma tool.
 */
export function getToolCategories(toolName) {
    if (STANDALONE_CATEGORIES[toolName])
        return STANDALONE_CATEGORIES[toolName];
    if (COMPOSITE_CATEGORIES[toolName])
        return COMPOSITE_CATEGORIES[toolName];
    return ["info"]; // fallback
}
/**
 * Indica se a tool tem categoria declarada explicitamente (sem fallback).
 */
export function hasToolCategory(toolName) {
    return Boolean(STANDALONE_CATEGORIES[toolName] || COMPOSITE_CATEGORIES[toolName]);
}
/**
 * Obtém todas as tools de uma categoria de intenção.
 */
export function getToolsByCategory(category) {
    const tools = [];
    for (const [name, categories] of Object.entries(STANDALONE_CATEGORIES)) {
        if (categories.includes(category))
            tools.push(name);
    }
    for (const [name, categories] of Object.entries(COMPOSITE_CATEGORIES)) {
        if (categories.includes(category))
            tools.push(name);
    }
    return tools;
}
/**
 * Obtém categorias representadas em um conjunto de tools.
 */
export function getCategoriesInToolSet(toolNames) {
    const categories = new Set();
    for (const name of toolNames) {
        for (const cat of getToolCategories(name)) {
            categories.add(cat);
        }
    }
    return [...categories];
}
/**
 * Keywords associadas a cada categoria de intenção.
 * Usado como sinal auxiliar no intent classifier.
 */
export const CATEGORY_KEYWORDS = {
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
};
