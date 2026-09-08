/**
 * State Gate — Determina quais tools são visíveis para cada estado do grafo.
 *
 * Reduz o espaço de escolha do LLM mostrando apenas tools relevantes.
 * Fallback: se o resultado for vazio, mostra todas as tools.
 *
 * Consumido por: hooks.ts (experimental.chat.system.transform)
 * Dependências: graph-state-snapshot.ts, tool-taxonomy.ts
 */
import { getGraphSnapshot } from "./graph-state-snapshot.js";
import { TOOL_TAXONOMY } from "./tool-taxonomy.js";
/** Tools que são sempre visíveis (essenciais) */
const ALWAYS_VISIBLE = new Set([
    "sdd.inspect",
    "sdd.query_graph",
    "sdd.validate",
    "sdd.detect_drift",
    "sdd.get_context",
]);
/** Tools de composits que são sempre visíveis */
const ALWAYS_VISIBLE_COMPOSITES = new Set([
    "sdd.graph_query",
    "sdd.graph_mutation",
    "sdd.traverse",
]);
/**
 * Mapeamento de estado → tools composits visíveis.
 * Keys são subconjuntos de GraphState.
 */
const STATE_TOOLS = {
    error: {
        composite: [],
        standalone: ["sdd.inspect", "sdd.validate", "sdd.initialize"],
    },
    uninitialized: {
        composite: [],
        standalone: ["sdd.initialize", "sdd.build_graph", "sdd.discover"],
    },
    empty: {
        composite: ["sdd.graph_mutation"],
        standalone: ["sdd.build_graph", "sdd.discover", "sdd.inspect"],
    },
    partial: {
        composite: ["sdd.graph_mutation", "sdd.graph_query"],
        standalone: [
            "sdd.discover", "sdd.update_from_answers", "sdd.inspect",
            "sdd.build_graph", "sdd.enforce",
        ],
    },
    ready: {
        composite: [
            "sdd.graph_mutation", "sdd.graph_query", "sdd.traverse",
            "sdd.code_quality", "sdd.graph_admin",
        ],
        standalone: [
            "sdd.enforce", "sdd.build_graph", "sdd.discover",
            "sdd.pending_changes", "sdd.change_history",
        ],
    },
    has_change: {
        composite: [
            "sdd.graph_mutation", "sdd.graph_query", "sdd.traverse",
            "sdd.code_quality", "sdd.graph_admin", "sdd.permissions",
        ],
        standalone: [
            "sdd.enforce", "sdd.approve_change", "sdd.update_from_answers",
            "sdd.pending_changes", "sdd.change_history", "sdd.impact_report",
        ],
    },
    has_approved_change: {
        composite: [
            "sdd.graph_mutation", "sdd.graph_query", "sdd.traverse",
            "sdd.code_quality", "sdd.graph_admin", "sdd.permissions",
            "sdd.snapshot", "sdd.sync",
        ],
        standalone: [
            "sdd.generate_code", "sdd.complete_change", "sdd.fail_change",
            "sdd.validate", "sdd.detect_drift",
        ],
    },
    emergency: {
        composite: [
            "sdd.graph_mutation", "sdd.graph_query", "sdd.traverse",
            "sdd.snapshot",
        ],
        standalone: [
            "sdd.hotfix", "sdd.validate", "sdd.complete_change",
        ],
    },
};
/**
 * Categorias de tools que ficam ocultas em certos estados.
 */
const CATEGORY_HIDDEN = {
    error: ["quality", "sync", "enterprise", "admin"],
    uninitialized: ["quality", "sync", "enterprise", "admin"],
    empty: ["quality", "sync", "enterprise"],
    partial: ["sync", "enterprise"],
    ready: ["sync"],
    has_change: [],
    has_approved_change: [],
    emergency: ["quality", "sync", "enterprise"],
};
/**
 * Obtém as tools visíveis para o estado atual do grafo.
 *
 * @param directory - Diretório do projeto
 * @returns Set de nomes de tools visíveis. Se vazio (fallback), retorna null para indicar "todas".
 */
export function getVisibleTools(directory) {
    const snapshot = getGraphSnapshot(directory);
    const stateConfig = STATE_TOOLS[snapshot.state];
    const hiddenCategories = CATEGORY_HIDDEN[snapshot.state] || [];
    const visible = new Set();
    // Adicionar sempre-visíveis
    for (const t of ALWAYS_VISIBLE)
        visible.add(t);
    for (const t of ALWAYS_VISIBLE_COMPOSITES)
        visible.add(t);
    // Adicionar tools do estado
    for (const t of stateConfig.standalone)
        visible.add(t);
    for (const t of stateConfig.composite)
        visible.add(t);
    // Adicionar composits de categories não-ocultas
    for (const tool of TOOL_TAXONOMY) {
        if (!hiddenCategories.includes(tool.category)) {
            visible.add(tool.name);
        }
    }
    // Se o resultado é muito pequeno (< 5 tools), retornar null (fallback: todas)
    if (visible.size < 5) {
        return null;
    }
    return visible;
}
/**
 * Formata a lista de tools visíveis para injeção no system prompt.
 */
export function formatVisibleTools(visibleTools) {
    if (!visibleTools) {
        return "[Todas as tools SDD disponíveis]";
    }
    const lines = ["## Tools SDD Disponíveis para Este Estado\n"];
    // Agrupar por tipo
    const standalone = [];
    const composite = [];
    for (const name of visibleTools) {
        if (TOOL_TAXONOMY.find(t => t.name === name)) {
            composite.push(name);
        }
        else {
            standalone.push(name);
        }
    }
    if (standalone.length > 0) {
        lines.push("### Tools Individuais");
        for (const t of standalone.sort()) {
            lines.push(`- \`${t}\``);
        }
    }
    if (composite.length > 0) {
        lines.push("\n### Tools Compositas (use action= para sub-comando)");
        for (const t of composite.sort()) {
            const tool = TOOL_TAXONOMY.find(tc => tc.name === t);
            if (tool) {
                const actions = tool.actions.map(a => a.name).join(", ");
                lines.push(`- \`${t}\` → [${actions}]`);
            }
        }
    }
    return lines.join("\n");
}
/**
 * Escape hatch: instrução para o LLM mostrar todas as tools se necessário.
 */
export const ESCAPE_HATCH_INSTRUCTION = `
### Tools SDD Não Listadas?
Se precisar de uma tool que não está na lista acima, você pode:
1. Usar a tool original diretamente (todas ainda existem)
2. Pedir ao usuário para usar \`/sdd status\` para ver todas as tools disponíveis
`.trim();
