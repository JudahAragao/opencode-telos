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
import { type IntentResult } from "./intent-classifier.js";
import { type CompositeTool } from "./tool-taxonomy.js";
export interface ToolRegistryResult {
    /** Catálogo completo, ordenado por relevância */
    tools: string[];
    /** Resultado da classificação de intenção (zeroed quando não há input) */
    intent: IntentResult;
    /** Tools recomendadas para o estado atual do grafo (destaque, nunca filtro) */
    recommended: Set<string>;
    /** Mensagem formatada para injeção no system prompt */
    formattedMessage: string;
}
/**
 * Catálogo completo de tools registradas: as standalone (cujo nome vem de
 * STANDALONE_CATEGORIES) mais as compositas da taxonomia.
 *
 * tests/tool-catalog.test.ts garante que esta lista é idêntica às chaves de
 * createSddTools(), então uma tool nova não pode mais ficar invisível.
 */
export declare const ALL_TOOL_NAMES: readonly string[];
/**
 * Obtém o conjunto final de tools para o LLM.
 *
 * @param directory - Diretório do projeto
 * @param userInput - Texto do input do usuário. Quando ausente/vazio (ex: a
 *   injeção no system prompt não recebe a mensagem do usuário), nenhuma
 *   intenção é inferida e as recomendadas do estado lideram a ordenação.
 * @returns ToolRegistryResult com o catálogo completo e a mensagem formatada
 */
export declare function getToolsForSession(directory: string, userInput?: string): ToolRegistryResult;
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
