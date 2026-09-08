/**
 * Intent Classifier — Classifica a intenção do usuário a partir do input.
 *
 * Combina relevância lexical BM25 com keywords para classificar
 * a intenção em uma das categorias: mutation, query, workflow, analysis, etc.
 *
 * Consumido por: hooks.ts (experimental.chat.system.transform)
 * Dependências: embeddings.ts, categories.ts
 */
import { type IntentCategory } from "./categories.js";
export interface IntentResult {
    category: IntentCategory;
    confidence: number;
    /** Top-3 categorias com scores */
    topCategories: Array<{
        category: IntentCategory;
        score: number;
    }>;
}
/**
 * Classifica a intenção do usuário.
 *
 * @param text - Input do usuário
 * @returns IntentResult com categoria, confidence e top-3
 */
export declare function classifyIntent(text: string): IntentResult;
/**
 * Obtém as tools relevantes para uma intenção, combinando com o state gate.
 *
 * @param intent - Resultado da classificação
 * @param stateTools - Tools visíveis pelo state gate (null = todas)
 * @returns Lista de tools relevantes
 */
export declare function getToolsForIntent(intent: IntentResult, stateTools: Set<string> | null): string[];
