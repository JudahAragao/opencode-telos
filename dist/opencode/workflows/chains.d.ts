/**
 * Workflow Chains — Definições de workflows de múltiplos steps.
 *
 * Cada chain é uma lista ordenada de steps.
 * O executor (executor.ts) executa cada step sequencialmente.
 *
 * Consumido por: executor.ts, tools-workflow.ts
 * Dependências: nenhuma (módulo puro de definições)
 */
export interface WorkflowStep {
    /** Nome da tool SDD a chamar */
    tool: string;
    /** Args estáticos ou função que gera args do resultado anterior */
    args: Record<string, unknown> | ((prevResult: string, initialParams: Record<string, unknown>, previousSteps: WorkflowStepResult[]) => Record<string, unknown>);
    /** Se true, falha neste step para a chain inteira */
    required: boolean;
    /** Descrição do step para logging */
    description: string;
}
export interface WorkflowStepResult {
    tool: string;
    result: string;
}
export interface WorkflowChain {
    /** Nome da chain (usado como tool name) */
    name: string;
    /** Descrição para o LLM */
    description: string;
    /** Parâmetros aceitos pela chain */
    params: Array<{
        name: string;
        type: string;
        description: string;
        required: boolean;
    }>;
    /** Lista de steps */
    steps: WorkflowStep[];
}
export declare const NEW_FEATURE_CHAIN: WorkflowChain;
export declare const BUG_FIX_CHAIN: WorkflowChain;
export declare const HOTFIX_CHAIN: WorkflowChain;
export declare const REFACTORING_CHAIN: WorkflowChain;
export declare const FULL_CYCLE_CHAIN: WorkflowChain;
export declare const ALL_CHAINS: WorkflowChain[];
/**
 * Obtém uma chain pelo nome.
 */
export declare function getChainByName(name: string): WorkflowChain | undefined;
/**
 * Lista todas as chains disponíveis (nomes + descriptions).
 */
export declare function listChainNames(): Array<{
    name: string;
    description: string;
}>;
