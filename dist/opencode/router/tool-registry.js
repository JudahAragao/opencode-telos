/**
 * Tool Registry — Registry central de tools SDD.
 *
 * Mantém a lista completa de tools, filtra por estado (state gate)
 * e intenção (intent classifier), e fornece o conjunto final para o LLM.
 *
 * Consumido por: hooks.ts (experimental.chat.system.transform)
 * Dependências: state-gate.ts, intent-classifier.ts, tool-taxonomy.ts
 */
import { getVisibleTools, ESCAPE_HATCH_INSTRUCTION, ENFORCEMENT_ORDER_INSTRUCTION } from "./state-gate.js";
import { classifyIntent, getToolsForIntent } from "./intent-classifier.js";
import { TOOL_TAXONOMY, STANDALONE_TOOLS } from "./tool-taxonomy.js";
/**
 * Número mínimo de tools que uma interseção de categoria precisa produzir
 * para ser confiada em vez do conjunto completo do estado. Abaixo disso o
 * agente ficaria cego para entry points essenciais (sdd.enforce, sdd.discover,
 * sdd.validate, ...).
 */
const MIN_INTERSECTION_TOOLS = 10;
/**
 * Conjunto completo de tools conhecidas: as visíveis pelo estado ou, em
 * fallback, todas as registradas.
 */
function allKnownTools(stateTools) {
    if (stateTools)
        return [...stateTools];
    return [...STANDALONE_TOOLS, ...TOOL_TAXONOMY.map((t) => t.name)];
}
/**
 * Obtém o conjunto final de tools para o LLM.
 *
 * Combina state gate (tools visíveis pelo estado do grafo)
 * com intent classifier (tools relevantes para a intenção).
 *
 * @param directory - Diretório do projeto
 * @param userInput - Texto do input do usuário. Quando ausente/vazio (ex: a
 *   injeção no system prompt não recebe a mensagem do usuário), nenhuma
 *   intenção é inferida: o conjunto completo do estado é apresentado.
 * @returns ToolRegistryResult com tools selecionadas e mensagem formatada
 */
export function getToolsForSession(directory, userInput) {
    // 1. State gate: quais tools são visíveis pelo estado do grafo?
    const stateTools = getVisibleTools(directory);
    const input = userInput?.trim() ?? "";
    // 2. Sem input: não fabricar intenção a partir de string vazia. Isso
    // produzia sempre a primeira categoria ("mutation") com 0% de confiança e
    // reduzia o anúncio a 3 tools, escondendo o resto do conjunto do estado.
    if (input.length === 0) {
        const tools = allKnownTools(stateTools);
        const intent = { category: "info", confidence: 0, topCategories: [] };
        return {
            tools,
            intent,
            stateTools,
            formattedMessage: formatToolRegistryMessage(tools, intent, false),
        };
    }
    // 3. Intent classifier: qual a intenção do usuário?
    const intent = classifyIntent(input);
    // 4. Interseção: tools da intenção ∩ tools visíveis
    const tools = getToolsForIntent(intent, stateTools);
    // 5. Interseção fina demais → usar o conjunto completo do estado
    const finalTools = tools.length >= MIN_INTERSECTION_TOOLS ? tools : allKnownTools(stateTools);
    // 6. Formatar mensagem para o system prompt
    const formattedMessage = formatToolRegistryMessage(finalTools, intent, true);
    return {
        tools: finalTools,
        intent,
        stateTools,
        formattedMessage,
    };
}
/**
 * Formata a mensagem do tool registry para o system prompt.
 *
 * @param showIntent - Quando false, omite o header de intenção (não houve
 *   input para classificar).
 */
function formatToolRegistryMessage(tools, intent, showIntent = true) {
    const lines = [];
    // Header com intenção detectada
    if (showIntent) {
        const confidencePct = Math.round(intent.confidence * 100);
        lines.push(`## Intent Detectado: ${intent.category} (${confidencePct}% confiança)`);
        if (intent.topCategories.length > 1) {
            const alternatives = intent.topCategories.slice(1).map(c => `${c.category} (${Math.round(c.score * 100)}%)`).join(", ");
            lines.push(`Alternativas: ${alternatives}`);
        }
        lines.push("");
    }
    lines.push(`### Tools SDD Disponíveis (${tools.length})`);
    // Tools selecionadas
    const standalone = tools.filter(t => STANDALONE_TOOLS.includes(t));
    const composite = tools.filter(t => TOOL_TAXONOMY.find(tc => tc.name === t));
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
    // Contrato de enforcement (mantém o prompt coerente com checkToolAccess)
    lines.push("");
    lines.push(ENFORCEMENT_ORDER_INSTRUCTION);
    // Escape hatch
    lines.push("");
    lines.push(ESCAPE_HATCH_INSTRUCTION);
    return lines.join("\n");
}
/**
 * Obtém descrição de uma tool (standalone ou composite).
 */
export function getToolDescription(toolName) {
    // Tentar standalone primeiro
    if (STANDALONE_TOOLS.includes(toolName)) {
        return `SDD tool: ${toolName}`;
    }
    // Tentar composite
    const composite = TOOL_TAXONOMY.find(t => t.name === toolName);
    if (composite) {
        return composite.description;
    }
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
