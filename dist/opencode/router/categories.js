/**
 * Categories — Mapeamento de tools para categorias de intenção.
 *
 * Cada tool é classificada em uma ou mais categorias.
 * O intent classifier usa isso para filtrar tools por categoria.
 *
 * Consumido por: intent-classifier.ts, tool-registry.ts
 * Dependências: tool-taxonomy.ts
 */
/**
 * Mapeamento de tools standalone para categorias de intenção.
 */
const STANDALONE_CATEGORIES = {
    // Mutation
    "sdd.initialize": ["mutation"],
    "sdd.build_graph": ["mutation", "discovery"],
    "sdd.update_from_answers": ["mutation", "discovery"],
    "sdd.discover": ["discovery"],
    // Query
    "sdd.inspect": ["query"],
    "sdd.query_graph": ["query"],
    "sdd.get_context": ["query"],
    // Workflow
    "sdd.enforce": ["workflow"],
    "sdd.enforce_rules": ["workflow"],
    "sdd.full_cycle": ["workflow"],
    "sdd.create_change": ["workflow"],
    "sdd.approve_change": ["workflow"],
    "sdd.complete_change": ["workflow"],
    "sdd.fail_change": ["workflow"],
    "sdd.pending_changes": ["workflow", "info"],
    "sdd.change_history": ["info"],
    "sdd.impact_report": ["analysis"],
    "sdd.toggle": ["admin"],
    "sdd.toggle_status": ["admin"],
    // Analysis
    "sdd.analyze_impact": ["analysis"],
    "sdd.validate": ["analysis"],
    "sdd.detect_drift": ["analysis"],
    "sdd.drift_signals": ["analysis"],
    "sdd.anti_patterns": ["analysis"],
    "sdd.clone_detection": ["analysis"],
    "sdd.contradictions": ["analysis"],
    "sdd.coverage": ["analysis"],
    "sdd.promises": ["analysis"],
    // Implementation
    "sdd.generate_code": ["implementation"],
    "sdd.auto_link_tests": ["implementation"],
    // Quality (individual tools, não composits)
    "sdd.quality": ["quality"],
    "sdd.constitution": ["analysis"],
    // Enterprise
    "sdd.bug_fix": ["workflow", "implementation"],
    "sdd.hotfix": ["workflow", "implementation"],
    "sdd.refactoring": ["workflow", "implementation"],
    "sdd.deprecate": ["workflow"],
    "sdd.install_hooks": ["implementation"],
    "sdd.brownfield_scan": ["analysis"],
    "sdd.generate_cicd": ["implementation"],
    "sdd.session_handoff": ["info"],
    "sdd.migrate_storage": ["admin"],
    // Info
    "sdd.start_dashboard": ["admin"],
    "sdd.mcp_server_info": ["info"],
    "sdd.handle_mcp_tool": ["info"],
};
/**
 * Mapeamento de tools composits para categorias de intenção.
 */
const COMPOSITE_CATEGORIES = {
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
