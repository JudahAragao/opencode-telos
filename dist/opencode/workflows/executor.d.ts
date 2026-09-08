/**
 * Workflow Executor — Executa workflow chains step by step.
 *
 * Cada step é executado sequencialmente.
 * Se um step required falha, a chain para e faz rollback.
 *
 * Consumido por: tools-workflow.ts
 * Dependências: chains.ts
 */
import type { WorkflowChain } from "./chains.js";
import type { ExecutorConfig } from "./types.js";
export interface StepResult {
    stepIndex: number;
    tool: string;
    description: string;
    success: boolean;
    result: string;
    timestamp: string;
}
export interface ChainExecutionResult {
    chainName: string;
    success: boolean;
    steps: StepResult[];
    finalResult: string;
    totalTimeMs: number;
    /** Steps completados antes da falha (para rollback) */
    completedSteps: number;
}
/**
 * Tipo da função que executa uma tool SDD.
 * Recebe (toolName, args) e retorna a string de resultado.
 */
export type ToolExecutor = (toolName: string, args: Record<string, unknown>) => Promise<string>;
export interface WorkflowExecutorHooks {
    beforeStep?: (stepIndex: number, step: WorkflowChain["steps"][number]) => Promise<unknown> | unknown;
    rollback?: (snapshots: unknown[], failedStepIndex: number) => Promise<void> | void;
}
/**
 * Executa uma workflow chain.
 *
 * @param chain - A chain a executar
 * @param initialParams - Parâmetros iniciais da chain
 * @param executeTool - Função que executa uma tool SDD
 * @returns Resultado da execução
 */
export declare function executeChain(chain: WorkflowChain, initialParams: Record<string, unknown>, executeTool: ToolExecutor, config?: ExecutorConfig, hooks?: WorkflowExecutorHooks): Promise<ChainExecutionResult>;
/**
 * Formata o resultado de uma execução de chain para exibição.
 */
export declare function formatChainResult(result: ChainExecutionResult): string;
/**
 * Rollback: desfaz os steps completados.
 * Nota: Na prática, o rollback é feito via snapshots do SDD.
 * Esta função apenas informa o que precisa ser desfeito.
 */
export declare function getRollbackPlan(result: ChainExecutionResult): string[];
