/**
 * Semantic Nudge — Sugestões locais por relevância lexical determinística.
 *
 * Calcula relevância BM25 entre o input do usuário e as tool descriptions.
 * Injeta hints no input do LLM com as tools mais relevantes.
 *
 * Consumido por: hooks.ts (chat.message hook)
 * Dependências: embeddings.ts, tool-embeddings.ts, categories.ts
 */
export interface NudgeResult {
    /** Hints formatados para injetar no input */
    hints: string[];
    /** Tools sugeridas com confidence */
    suggestions: Array<{
        tool: string;
        confidence: number;
    }>;
}
/**
 * Calcula nudges semânticos para o input do usuário.
 *
 * @param userInput - Texto do input do usuário
 * @returns NudgeResult com hints e sugestões
 */
export declare function calculateSemanticNudge(userInput: string): NudgeResult;
/**
 * Gera a string de nudge para injetar no input do LLM.
 * Retorna string vazia se não houver nudges relevantes.
 */
export declare function formatNudgeInput(userInput: string): string;
/**
 * Verifica se uma tool específica é sugerida pelo nudge.
 */
export declare function isToolSuggested(userInput: string, toolName: string): boolean;
/**
 * Obtém a tool mais sugerida para o input.
 */
export declare function getTopSuggestion(userInput: string): {
    tool: string;
    confidence: number;
} | null;
