/**
 * Semantic Nudge — Sugestões locais por relevância lexical determinística.
 *
 * Calcula relevância BM25 entre o input do usuário e as tool descriptions.
 * Injeta hints no input do LLM com as tools mais relevantes.
 *
 * Consumido por: hooks.ts (chat.message hook)
 * Dependências: embeddings.ts, tool-embeddings.ts, categories.ts
 */
import { rankSimilarity } from "./embeddings.js";
import { getCachedToolEmbeddings } from "./tool-embeddings.js";
/** Minimum lexical relevance for a suggestion. BM25 scores are unbounded. */
const CONFIDENCE_THRESHOLD = 0.35;
/** Máximo de sugestões */
const MAX_SUGGESTIONS = 3;
/**
 * Calcula nudges semânticos para o input do usuário.
 *
 * @param userInput - Texto do input do usuário
 * @returns NudgeResult com hints e sugestões
 */
export function calculateSemanticNudge(userInput) {
    const toolEmbeddings = getCachedToolEmbeddings();
    const topLevelTools = toolEmbeddings.filter((tool) => !tool.name.includes(":"));
    const ranked = rankSimilarity(userInput, topLevelTools.map((tool) => ({
        label: tool.name,
        text: `${tool.name} ${tool.description}`,
    })));
    const byName = new Map(topLevelTools.map((tool) => [tool.name, tool]));
    const scores = ranked
        .filter((item) => item.score >= CONFIDENCE_THRESHOLD)
        .map((item) => ({ tool: byName.get(item.label), score: item.score }));
    // Ordenar por score e pegar top-N
    scores.sort((a, b) => b.score - a.score);
    const topScores = scores.slice(0, MAX_SUGGESTIONS);
    // Gerar hints
    const hints = [];
    const suggestions = [];
    if (topScores.length > 0) {
        hints.push("[SDD Tools Sugeridas]");
        for (const { tool, score } of topScores) {
            const confidencePct = Math.round(score * 100);
            hints.push(`- ${tool.name} (${confidencePct}%): ${tool.description}`);
            suggestions.push({ tool: tool.name, confidence: score });
        }
    }
    return { hints, suggestions };
}
/**
 * Gera a string de nudge para injetar no input do LLM.
 * Retorna string vazia se não houver nudges relevantes.
 */
export function formatNudgeInput(userInput) {
    const result = calculateSemanticNudge(userInput);
    if (result.hints.length === 0)
        return "";
    return result.hints.join("\n");
}
/**
 * Verifica se uma tool específica é sugerida pelo nudge.
 */
export function isToolSuggested(userInput, toolName) {
    const result = calculateSemanticNudge(userInput);
    return result.suggestions.some(s => s.tool === toolName);
}
/**
 * Obtém a tool mais sugerida para o input.
 */
export function getTopSuggestion(userInput) {
    const result = calculateSemanticNudge(userInput);
    return result.suggestions[0] || null;
}
