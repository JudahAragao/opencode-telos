/**
 * Tool Registry — Registry central de tools SDD.
 *
 * Anuncia o CATÁLOGO COMPLETO de tools registradas ao agente e destaca as mais
 * relevantes para o estado atual do grafo e para a intenção detectada.
 *
 * Histórico: antes este módulo escondia tools por categoria/estado e reduzia o
 * anúncio a ~3 nomes, o que fazia entry points essenciais (sdd.enforce,
 * sdd.discover, sdd.start_dashboard) nunca chegarem ao modelo. Nenhuma tool é
 * omitida agora — a política de enforcement é quem decide o que pode ser
 * chamado, não o anúncio.
 *
 * Consumido por: hooks.ts (experimental.chat.system.transform)
 * Dependências: state-gate.ts, intent-classifier.ts, categories.ts, tool-taxonomy.ts
 */
import { getRecommendedTools, ESCAPE_HATCH_INSTRUCTION, ENFORCEMENT_ORDER_INSTRUCTION, } from "./state-gate.js";
import { classifyIntent } from "./intent-classifier.js";
import { TOOL_TAXONOMY, STANDALONE_TOOLS } from "./tool-taxonomy.js";
import { getToolCategories } from "./categories.js";
/**
 * Catálogo completo de tools registradas: as standalone (cujo nome vem de
 * STANDALONE_CATEGORIES) mais as compositas da taxonomia.
 *
 * tests/tool-catalog.test.ts garante que esta lista é idêntica às chaves de
 * createSddTools(), então uma tool nova não pode mais ficar invisível.
 */
export const ALL_TOOL_NAMES = [
    ...STANDALONE_TOOLS,
    ...TOOL_TAXONOMY.map((t) => t.name),
];
const COMPOSITE_NAMES = new Set(TOOL_TAXONOMY.map((t) => t.name));
/** Nomes de tools por linha na listagem compacta do prompt. */
const NAMES_PER_LINE = 5;
/** Prioridade de exibição: intenção (0) → recomendada (1) → restante (2). */
function relevanceRank(name, intent, recommended) {
    if (intent && getToolCategories(name).includes(intent.category))
        return 0;
    if (recommended.has(name))
        return 1;
    return 2;
}
/**
 * Obtém o conjunto final de tools para o LLM.
 *
 * @param directory - Diretório do projeto
 * @param userInput - Texto do input do usuário. Quando ausente/vazio (ex: a
 *   injeção no system prompt não recebe a mensagem do usuário), nenhuma
 *   intenção é inferida e as recomendadas do estado lideram a ordenação.
 * @returns ToolRegistryResult com o catálogo completo e a mensagem formatada
 */
export function getToolsForSession(directory, userInput) {
    // 1. State gate: quais tools merecem destaque neste estado do grafo?
    const recommended = getRecommendedTools(directory);
    // 2. Intent classifier: qual a intenção do usuário? (só com input real —
    // inferir de string vazia devolvia sempre a primeira categoria, "mutation")
    const input = userInput?.trim() ?? "";
    const intent = input.length > 0 ? classifyIntent(input) : null;
    // 3. Ordenar por relevância mantendo o catálogo INTEIRO (nada é omitido)
    const tools = [...ALL_TOOL_NAMES].sort((a, b) => {
        const diff = relevanceRank(a, intent, recommended) - relevanceRank(b, intent, recommended);
        return diff !== 0 ? diff : a.localeCompare(b);
    });
    return {
        tools,
        intent: intent ?? { category: "info", confidence: 0, topCategories: [] },
        recommended,
        formattedMessage: formatToolRegistryMessage(tools, intent, recommended),
    };
}
/**
 * Lista compacta de nomes, agrupados em linhas, com destaque das recomendadas.
 */
function formatNameList(names, recommended) {
    const sorted = [...names].sort();
    const lines = [];
    for (let i = 0; i < sorted.length; i += NAMES_PER_LINE) {
        const chunk = sorted
            .slice(i, i + NAMES_PER_LINE)
            .map((name) => `${recommended.has(name) ? "▸" : " "} \`${name}\``);
        lines.push(`- ${chunk.join("")}`);
    }
    return lines.join("\n");
}
/**
 * Formata a mensagem do tool registry para o system prompt.
 *
 * @param intent - null quando não houve input para classificar.
 */
function formatToolRegistryMessage(tools, intent, recommended) {
    const lines = [];
    if (intent) {
        const confidencePct = Math.round(intent.confidence * 100);
        lines.push(`## Intent Detectado: ${intent.category} (${confidencePct}% confiança)`);
        if (intent.topCategories.length > 1) {
            const alternatives = intent.topCategories
                .slice(1)
                .map((c) => `${c.category} (${Math.round(c.score * 100)}%)`)
                .join(", ");
            lines.push(`Alternativas: ${alternatives}`);
        }
        lines.push("");
    }
    lines.push(`### Tools SDD — catálogo completo (${tools.length})`);
    lines.push("Todas estão disponíveis. `▸` marca as recomendadas para o estado atual do grafo.");
    lines.push("");
    const composites = tools.filter((name) => COMPOSITE_NAMES.has(name)).sort();
    const standalone = tools.filter((name) => !COMPOSITE_NAMES.has(name));
    if (composites.length > 0) {
        lines.push("#### Compositas (use `action=` para o sub-comando)");
        for (const name of composites) {
            const tool = TOOL_TAXONOMY.find((tc) => tc.name === name);
            if (!tool)
                continue;
            const actions = tool.actions.map((a) => a.name).join(", ");
            lines.push(`- ${recommended.has(name) ? "▸" : " "} \`${name}\` → [${actions}]`);
        }
        lines.push("");
    }
    lines.push(`#### Individuais (${standalone.length})`);
    lines.push(formatNameList(standalone, recommended));
    lines.push("");
    // Contrato de enforcement (mantém o prompt coerente com checkToolAccess)
    lines.push(ENFORCEMENT_ORDER_INSTRUCTION);
    lines.push("");
    lines.push(ESCAPE_HATCH_INSTRUCTION);
    return lines.join("\n");
}
/**
 * Obtém descrição de uma tool (standalone ou composite).
 */
export function getToolDescription(toolName) {
    const composite = TOOL_TAXONOMY.find((t) => t.name === toolName);
    if (composite)
        return composite.description;
    if (STANDALONE_TOOLS.includes(toolName))
        return `SDD tool: ${toolName}`;
    return `Unknown tool: ${toolName}`;
}
/**
 * Lista todas as tools ativas (composits + standalone) com contagem.
 */
export function listAllTools() {
    return {
        standalone: STANDALONE_TOOLS,
        composite: TOOL_TAXONOMY,
        total: STANDALONE_TOOLS.length + TOOL_TAXONOMY.length,
    };
}
