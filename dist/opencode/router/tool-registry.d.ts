/**
 * Tool Registry — Registry central de tools SDD.
 *
 * Mantém a lista completa de tools, filtra por estado (state gate)
 * e intenção (intent classifier), e fornece o conjunto final para o LLM.
 *
 * Consumido por: hooks.ts (experimental.chat.system.transform)
 * Dependências: state-gate.ts, intent-classifier.ts, tool-taxonomy.ts
 */
import { type IntentResult } from "./intent-classifier.js";
import { type CompositeTool } from "./tool-taxonomy.js";
export interface ToolRegistryResult {
    /** Tools finais selecionadas para o LLM */
    tools: string[];
    /** Resultado da classificação de intenção */
    intent: IntentResult;
    /** Se null, todas as tools estão disponíveis (fallback) */
    stateTools: Set<string> | null;
    /** Mensagem formatada para injeção no system prompt */
    formattedMessage: string;
}
/**
 * Obtém o conjunto final de tools para o LLM.
 *
 * Combina state gate (tools visíveis pelo estado do grafo)
 * com intent classifier (tools relevantes para a intenção).
 *
 * @param directory - Diretório do projeto
 * @param userInput - Texto do input do usuário
 * @returns ToolRegistryResult com tools selecionadas e mensagem formatada
 */
export declare function getToolsForSession(directory: string, userInput: string): ToolRegistryResult;
/**
 * Obtém descrição de uma tool (standalone ou composite).
 */
export declare function getToolDescription(toolName: string): string;
/**
 * Lista todas as tools ativas (composits + standalone) com contagem.
 */
export declare function listAllTools(): {
    standalone: string[];
    composite: CompositeTool[];
    total: number;
};
