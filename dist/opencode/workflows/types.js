/**
 * Workflow Types — Tipos compartilhados para o módulo de workflows.
 *
 * Consumido por: chains.ts, executor.ts, tools-workflow.ts
 */
/** Configuração padrão */
export const DEFAULT_EXECUTOR_CONFIG = {
    stepTimeoutMs: 30_000,
    chainTimeoutMs: 120_000,
    snapshotBeforeStep: true,
    autoRollback: true,
};
