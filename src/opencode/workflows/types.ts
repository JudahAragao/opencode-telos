/**
 * Workflow Types — Shared types for the workflows module.
 *
 * Consumido por: chains.ts, executor.ts, tools-workflow.ts
 */

import type { ChainExecutionResult } from "./executor.js"

/** Status of a chain execution */
export type ChainStatus = "pending" | "running" | "completed" | "failed" | "rolled_back"

/** Record of a chain execution (for auditing) */
export interface ChainExecutionLog {
  id: string
  runId?: string
  chainName: string
  status: ChainStatus
  startedAt: string
  completedAt?: string
  result?: ChainExecutionResult
  params: Record<string, unknown>
  error?: string
}

/** Executor configuration */
export interface ExecutorConfig {
  /** Maximum timeout per step (ms) */
  stepTimeoutMs: number
  /** Maximum timeout for the whole chain (ms) */
  chainTimeoutMs: number
  /** Se true, faz snapshot antes de cada step */
  snapshotBeforeStep: boolean
  /** If true, rolls back automatically on failure */
  autoRollback: boolean
}

/** Default configuration */
export const DEFAULT_EXECUTOR_CONFIG: ExecutorConfig = {
  stepTimeoutMs: 30_000,
  chainTimeoutMs: 120_000,
  snapshotBeforeStep: true,
  autoRollback: true,
}
