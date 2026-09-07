/**
 * Workflow Types — Tipos compartilhados para o módulo de workflows.
 *
 * Consumido por: chains.ts, executor.ts, tools-workflow.ts
 */

import type { ChainExecutionResult } from "./executor.js"

/** Status de uma execução de chain */
export type ChainStatus = "pending" | "running" | "completed" | "failed" | "rolled_back"

/** Registro de uma execução de chain (para auditoria) */
export interface ChainExecutionLog {
  id: string
  chainName: string
  status: ChainStatus
  startedAt: string
  completedAt?: string
  result?: ChainExecutionResult
  params: Record<string, unknown>
}

/** Configuração do executor */
export interface ExecutorConfig {
  /** Timeout máximo por step (ms) */
  stepTimeoutMs: number
  /** Timeout máximo da chain inteira (ms) */
  chainTimeoutMs: number
  /** Se true, faz snapshot antes de cada step */
  snapshotBeforeStep: boolean
  /** Se true, faz rollback automático em falha */
  autoRollback: boolean
}

/** Configuração padrão */
export const DEFAULT_EXECUTOR_CONFIG: ExecutorConfig = {
  stepTimeoutMs: 30_000,
  chainTimeoutMs: 120_000,
  snapshotBeforeStep: true,
  autoRollback: true,
}
