/**
 * Intent Classifier — Classifica a intenção do usuário a partir do input.
 *
 * Combina relevância lexical BM25 com keywords para classificar
 * a intenção em uma das categorias: mutation, query, workflow, analysis, etc.
 *
 * Consumido por: hooks.ts (experimental.chat.system.transform)
 * Dependências: embeddings.ts, categories.ts
 */
import { rankSimilarity } from "./embeddings.js";
import { CATEGORY_KEYWORDS, getToolsByCategory, } from "./categories.js";
/**
 * Embeddings pré-computados para descrições de categorias.
 * Cada categoria tem uma descrição representativa.
 */
const CATEGORY_DESCRIPTIONS = {
    mutation: "Create, add, update, or remove nodes and relationships in the knowledge graph",
    query: "Search, query, list, inspect, or retrieve information from the knowledge graph",
    workflow: "Manage changes, approvals, enforcement, lifecycle of specifications",
    analysis: "Analyze impact, validate, detect drift, check integrity of the specification",
    quality: "Code quality metrics, complexity, smells, dependencies, dead code detection",
    enterprise: "Enterprise workflows: migrations, experiments, feature flags, security, compliance",
    admin: "Administration: permissions, roles, sync, snapshots, cache, configuration",
    discovery: "Discover requirements, analyze briefings, ask questions, elicit specifications",
    implementation: "Generate code, plan implementation, create files from specification",
    info: "Get status, history, help, general information about the project",
};
/**
 * Calcula score de keywords para cada categoria.
 */
function keywordScore(text) {
    const normalized = text.toLowerCase();
    const scores = {};
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        let score = 0;
        for (const keyword of keywords) {
            if (normalized.includes(keyword.toLowerCase())) {
                score += 1;
            }
        }
        scores[category] = score;
    }
    return scores;
}
/**
 * Calcula score lexical para cada categoria.
 */
function lexicalScore(text) {
    const options = Object.entries(CATEGORY_DESCRIPTIONS).map(([category, description]) => ({
        label: category,
        text: description,
    }));
    const ranked = rankSimilarity(text, options);
    const scores = {};
    for (const r of ranked) {
        scores[r.label] = r.score;
    }
    return scores;
}
/**
 * Combina keyword score e relevância lexical com pesos.
 * Keywords: 0.4, lexical relevance: 0.6
 */
function combinedScore(text) {
    const kw = keywordScore(text);
    const lexical = lexicalScore(text);
    const combined = {};
    for (const category of Object.keys(kw)) {
        combined[category] = (kw[category] * 0.4) + ((lexical[category] || 0) * 0.6);
    }
    return combined;
}
/**
 * Classifica a intenção do usuário.
 *
 * @param text - Input do usuário
 * @returns IntentResult com categoria, confidence e top-3
 */
export function classifyIntent(text) {
    const scores = combinedScore(text);
    // Ordenar por score decrescente
    const sorted = Object.entries(scores)
        .map(([category, score]) => ({ category: category, score }))
        .sort((a, b) => b.score - a.score);
    const top = sorted[0];
    const totalScore = sorted.reduce((sum, s) => sum + Math.max(0, s.score), 0);
    const confidence = totalScore > 0 ? top.score / totalScore : 0;
    return {
        category: top.category,
        confidence: Math.min(1, Math.max(0, confidence)),
        topCategories: sorted.slice(0, 3),
    };
}
/**
 * Obtém as tools relevantes para uma intenção, combinando com o state gate.
 *
 * @param intent - Resultado da classificação
 * @param stateTools - Tools visíveis pelo state gate (null = todas)
 * @returns Lista de tools relevantes
 */
export function getToolsForIntent(intent, stateTools) {
    const categoryTools = getToolsByCategory(intent.category);
    if (!stateTools)
        return categoryTools;
    // Interseção: tools da categoria ∩ tools visíveis pelo estado
    return categoryTools.filter(t => stateTools.has(t));
}
