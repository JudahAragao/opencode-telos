/**
 * Tool catalog — Descriptions cacheadas para todas as tools SDD.
 *
 * Mantém o catálogo usado pelo roteamento lexical. Os vetores são hash-based,
 * não embeddings semânticos de um modelo.
 *
 * Consumido por: semantic-nudge.ts
 * Dependências: embeddings.ts, tool-taxonomy.ts
 */
import { getLexicalVector } from "./embeddings.js";
import { TOOL_TAXONOMY, STANDALONE_TOOLS } from "./tool-taxonomy.js";
/**
 * Descriptions das tools standalone (nomes → descriptions representativas).
 * Em produção, extrair das ToolDefinitions reais.
 */
const STANDALONE_DESCRIPTIONS = {
    "sdd.initialize": "Initialize the SDD Knowledge Graph for a project",
    "sdd.inspect": "Inspect the current state of the SDD Knowledge Graph stats",
    "sdd.query_graph": "Query the SDD Knowledge Graph search for nodes",
    "sdd.analyze_impact": "Perform impact analysis for a change request traverse graph",
    "sdd.create_change": "Create a Change node in the SDD Knowledge Graph",
    "sdd.discover": "Analyze a user briefing and return discovery questions",
    "sdd.update_from_answers": "Update the Knowledge Graph based on user answers",
    "sdd.validate": "Validate the SDD Knowledge Graph for structural integrity",
    "sdd.detect_drift": "Detect SDD drift discrepancies between specification and codebase",
    "sdd.get_context": "Build a context pack for a specific node",
    "sdd.approve_change": "Approve a pending change in the SDD graph",
    "sdd.complete_change": "Mark a change as completed check pending promises",
    "sdd.fail_change": "Mark a change as FAILED with a reason",
    "sdd.change_history": "View the full history of all changes in the SDD graph",
    "sdd.impact_report": "Generate a detailed impact report for a specific change",
    "sdd.pending_changes": "List all pending changes in the SDD graph",
    "sdd.generate_code": "Generate project code from the SDD Knowledge Graph",
    "sdd.enforce": "Classify a change request and create a Change node",
    "sdd.enforce_rules": "Show the current SDD enforcement rules",
    "sdd.full_cycle": "Run the complete SDD workflow cycle from enforcement to completion",
    "sdd.toggle": "Toggle SDD enforcement on or off",
    "sdd.constitution": "Manage the project constitution principles",
    "sdd.promises": "Manage promises and commitments in the SDD graph",
    "sdd.quality": "Calculate quality score for the SDD graph",
    "sdd.session_handoff": "Generate a session handoff pack for context continuity",
    "sdd.anti_patterns": "Detect anti-patterns in the SDD graph",
    "sdd.clone_detection": "Detect near-duplicate nodes and AST clones",
    "sdd.contradictions": "Detect contradictions in the SDD graph",
    "sdd.coverage": "Calculate test coverage for requirements",
    "sdd.install_hooks": "Install git hooks for SDD enforcement",
    "sdd.brownfield_scan": "Scan existing project and create SDD nodes for brownfield",
    "sdd.generate_cicd": "Generate CI/CD pipeline configuration from SDD graph",
    "sdd.bug_fix": "Automated bug fix workflow through SDD",
    "sdd.hotfix": "Emergency hotfix workflow bypassing normal enforcement",
    "sdd.refactoring": "Safe refactoring workflow with test validation",
    "sdd.deprecate": "Deprecation workflow with migration guide",
    "sdd.toggle_status": "Show current SDD toggle status",
    "sdd.drift_signals": "Detect advanced drift signals mutant duplicates architecture violations",
    "sdd.build_graph": "Build the entire Knowledge Graph from a project briefing",
    "sdd.auto_link_tests": "Automatically link orphan tests to requirements",
    "sdd.migrate_storage": "Migrate SDD storage between YAML and SQLite backends",
    "sdd.start_dashboard": "Start the SDD dashboard server",
    "sdd.mcp_server_info": "Show MCP server information and capabilities",
    "sdd.handle_mcp_tool": "Handle an MCP tool call from an external client",
};
/**
 * Gera embeddings para todas as tools (standalone + composite).
 */
export function generateAllToolEmbeddings() {
    const embeddings = [];
    // Standalone tools
    for (const name of STANDALONE_TOOLS) {
        const description = STANDALONE_DESCRIPTIONS[name] || `SDD tool: ${name}`;
        embeddings.push({
            name,
            description,
            vector: getLexicalVector(description),
            category: "standalone",
        });
    }
    // Composite tools
    for (const tool of TOOL_TAXONOMY) {
        embeddings.push({
            name: tool.name,
            description: tool.description,
            vector: getLexicalVector(tool.description),
            category: tool.category,
        });
        // Sub-actions também ganham embeddings
        for (const action of tool.actions) {
            embeddings.push({
                name: `${tool.name}:${action.name}`,
                description: `${action.description} (${tool.label})`,
                vector: getLexicalVector(action.description),
                category: tool.category,
            });
        }
    }
    return embeddings;
}
/**
 * Cache global de embeddings.
 */
let cachedEmbeddings = null;
/**
 * Obtém embeddings com cache.
 */
export function getCachedToolEmbeddings() {
    if (!cachedEmbeddings) {
        cachedEmbeddings = generateAllToolEmbeddings();
    }
    return cachedEmbeddings;
}
/**
 * Força regeneração do cache.
 */
export function refreshToolEmbeddings() {
    cachedEmbeddings = generateAllToolEmbeddings();
    return cachedEmbeddings;
}
/**
 * Serializa embeddings para JSON (para persistência).
 */
export function serializeEmbeddings(embeddings) {
    return JSON.stringify(embeddings.map(e => ({
        n: e.name,
        d: e.description,
        v: e.vector,
        c: e.category,
    })), null, 2);
}
/**
 * Desserializa embeddings de JSON.
 */
export function deserializeEmbeddings(json) {
    const data = JSON.parse(json);
    return data.map((e) => ({
        name: e.n,
        description: e.d,
        vector: e.v ?? e.e,
        category: e.c,
    }));
}
