/**
 * State Gate — Prioriza as tools mais relevantes para cada estado do grafo.
 *
 * ATENÇÃO: este módulo NÃO esconde tools. O catálogo completo é sempre
 * anunciado ao agente por tool-registry.ts; aqui só calculamos o subconjunto
 * que merece destaque para o estado atual. A decisão final de o que pode ser
 * chamado é da política de enforcement (checkToolAccess).
 *
 * Esconder tools por categoria foi a causa de entry points essenciais
 * (sdd.start_dashboard, sdd.enforce, ...) nunca chegarem ao prompt.
 *
 * Consumido por: tool-registry.ts
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
    // Workflow entry points: exempt from the enforcement policy and required to
    // start a Change in ANY graph state, so they must never be hidden.
    "sdd.enforce",
    "sdd.renew_workflow",
    "sdd.update_from_answers",
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
 * Obtém as tools recomendadas (destaques) para o estado atual do grafo.
 *
 * @param directory - Diretório do projeto
 * @returns Set de nomes de tools recomendadas. Nunca indica "ocultar".
 */
export function getRecommendedTools(directory) {
    const snapshot = getGraphSnapshot(directory);
    const stateConfig = STATE_TOOLS[snapshot.state];
    const hiddenCategories = CATEGORY_HIDDEN[snapshot.state] || [];
    const recommended = new Set();
    // Adicionar sempre-visíveis
    for (const t of ALWAYS_VISIBLE)
        recommended.add(t);
    for (const t of ALWAYS_VISIBLE_COMPOSITES)
        recommended.add(t);
    // Adicionar tools do estado
    for (const t of stateConfig.standalone)
        recommended.add(t);
    for (const t of stateConfig.composite)
        recommended.add(t);
    // Adicionar composits de categories não-ocultas
    for (const tool of TOOL_TAXONOMY) {
        if (!hiddenCategories.includes(tool.category)) {
            recommended.add(tool.name);
        }
    }
    return recommended;
}
/** @deprecated Use getRecommendedTools — nenhuma tool é ocultada do agente. */
export const getVisibleTools = getRecommendedTools;
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
 * Contrato de enforcement anunciado junto com a lista de tools.
 *
 * Mantém o prompt coerente com a política aplicada por checkToolAccess: as
 * tools de mutação são recusadas enquanto não houver um Change ativo, então a
 * ordem de bootstrap precisa estar explícita para o agente.
 */
export const ENFORCEMENT_ORDER_INSTRUCTION = `
### Ordem obrigatória (enforcement ativo)
Sem um Change ativo, as tools que mutam o grafo são recusadas pelo hook. Sequência:
1. \`sdd.enforce\` — classifica a requisição e cria o Change
2. atualizar a spec (\`sdd.build_graph\`, \`sdd.graph_mutation\`, \`sdd.update_from_answers\`)
3. \`sdd.approve_change\` — aprova o Change
4. escrever código (\`sdd.generate_code\` ou Write/Edit)
5. \`sdd.verify_implementation\` → \`sdd.complete_change\`

Se a janela expirar no meio da tarefa, use \`sdd.renew_workflow\` (ou \`/sdd renew\`) para estender o MESMO Change e preservar o laudo — \`sdd.enforce\` criaria um Change novo. Aprovar um Change sem \`affected_files\` é recusado porque nenhum Write/Edit seria liberado.
`.trim();
/**
 * Como escolher a tool: a lista anunciada é o catálogo completo, então a
 * instrução passa a ser de priorização, não de descoberta.
 */
export const ESCAPE_HATCH_INSTRUCTION = `
### Como escolher a tool
A lista acima é o catálogo COMPLETO — não existe tool SDD fora dela.
Comece pelas recomendadas (▸) e, antes de mutar o grafo, confirme o estado
com \`sdd.inspect\` ou \`sdd.query_graph\`.
`.trim();
