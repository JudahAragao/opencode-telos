/**
 * Workflow Tools — Tool definitions para workflow chains.
 *
 * Cada tool chain é uma tool SDD que o LLM pode chamar diretamente.
 * Internamente, executa a chain de steps usando o executor.
 *
 * Consumido por: createSddTools() em tools.ts
 * Dependências: chains.ts, executor.ts
 */
import { type ToolDefinition } from "@opencode-ai/plugin";
/**
 * Cria todas as tools de workflow chains.
 * Retorna um Record compatível com createSddTools().
 */
export declare function createWorkflowTools(): Record<string, ToolDefinition>;
/**
 * Lista todas as workflow tools disponíveis.
 */
export declare function listWorkflowTools(): Array<{
    name: string;
    description: string;
    params: string[];
}>;
