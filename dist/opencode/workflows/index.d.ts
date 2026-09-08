/**
 * Workflows Module — Barrel export.
 *
 * Exporta todas as funções públicas do módulo de workflows.
 * Consumido por: tools.ts
 */
export { ALL_CHAINS, getChainByName, listChainNames } from "./chains.js";
export type { WorkflowChain, WorkflowStep } from "./chains.js";
export { executeChain, formatChainResult, getRollbackPlan } from "./executor.js";
export type { ChainExecutionResult, StepResult, ToolExecutor } from "./executor.js";
export { DEFAULT_EXECUTOR_CONFIG } from "./types.js";
export type { ChainStatus, ChainExecutionLog, ExecutorConfig } from "./types.js";
export { createWorkflowTools, listWorkflowTools } from "./tools-workflow.js";
