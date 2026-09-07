/**
 * Workflow Executor — Executa workflow chains step by step.
 *
 * Cada step é executado sequencialmente.
 * Se um step required falha, a chain para e faz rollback.
 *
 * Consumido por: tools-workflow.ts
 * Dependências: chains.ts
 */

import type { WorkflowChain, WorkflowStepResult } from "./chains.js"
import type { ExecutorConfig } from "./types.js"
import { DEFAULT_EXECUTOR_CONFIG } from "./types.js"

export interface StepResult {
  stepIndex: number
  tool: string
  description: string
  success: boolean
  result: string
  timestamp: string
}

export interface ChainExecutionResult {
  chainName: string
  success: boolean
  steps: StepResult[]
  finalResult: string
  totalTimeMs: number
  /** Steps completados antes da falha (para rollback) */
  completedSteps: number
}

/**
 * Tipo da função que executa uma tool SDD.
 * Recebe (toolName, args) e retorna a string de resultado.
 */
export type ToolExecutor = (toolName: string, args: Record<string, unknown>) => Promise<string>

export interface WorkflowExecutorHooks {
  beforeStep?: (stepIndex: number, step: WorkflowChain["steps"][number]) => Promise<unknown> | unknown
  rollback?: (snapshots: unknown[], failedStepIndex: number) => Promise<void> | void
}

/**
 * Executa uma workflow chain.
 *
 * @param chain - A chain a executar
 * @param initialParams - Parâmetros iniciais da chain
 * @param executeTool - Função que executa uma tool SDD
 * @returns Resultado da execução
 */
export async function executeChain(
  chain: WorkflowChain,
  initialParams: Record<string, unknown>,
  executeTool: ToolExecutor,
  config: ExecutorConfig = DEFAULT_EXECUTOR_CONFIG,
  hooks?: WorkflowExecutorHooks,
): Promise<ChainExecutionResult> {
  const startTime = Date.now()
  const steps: StepResult[] = []
  const initialValue = Object.values(initialParams).find((value) => typeof value === "string")
  let prevResult = typeof initialValue === "string" ? initialValue : JSON.stringify(initialParams)
  let completedSteps = 0
  const previousSteps: WorkflowStepResult[] = []
  const snapshots: unknown[] = []

  const rollbackIfNeeded = async (stepIndex: number): Promise<void> => {
    if (config.autoRollback && hooks?.rollback && snapshots.length > 0) {
      await hooks.rollback(snapshots, stepIndex)
    }
  }

  for (let i = 0; i < chain.steps.length; i++) {
    if (Date.now() - startTime >= config.chainTimeoutMs) {
      await rollbackIfNeeded(i)
      return {
        chainName: chain.name,
        success: false,
        steps,
        finalResult: `Workflow timed out after ${config.chainTimeoutMs}ms`,
        totalTimeMs: Date.now() - startTime,
        completedSteps,
      }
    }
    const step = chain.steps[i]
    const args = typeof step.args === "function"
      ? step.args(prevResult, initialParams, previousSteps)
      : step.args

    try {
      if (config.snapshotBeforeStep && hooks?.beforeStep) {
        snapshots.push(await hooks.beforeStep(i, step))
      }
      const result = await Promise.race([
        executeTool(step.tool, args),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error(`Step timed out after ${config.stepTimeoutMs}ms`)), config.stepTimeoutMs)),
      ])
      const stepResult: StepResult = {
        stepIndex: i,
        tool: step.tool,
        description: step.description,
        success: true,
        result,
        timestamp: new Date().toISOString(),
      }
      steps.push(stepResult)
      previousSteps.push({ tool: step.tool, result })
      prevResult = result
      completedSteps++

      // Se o resultado indica falha (contém "BLOCKED" ou "Error")
      if (result.includes("BLOCKED") || result.startsWith("Error:")) {
        if (step.required) {
          await rollbackIfNeeded(i)
          return {
            chainName: chain.name,
            success: false,
            steps,
            finalResult: `Step ${i + 1} failed: ${result}`,
            totalTimeMs: Date.now() - startTime,
            completedSteps,
          }
        }
      }
    } catch (error) {
      const stepResult: StepResult = {
        stepIndex: i,
        tool: step.tool,
        description: step.description,
        success: false,
        result: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }
      steps.push(stepResult)

      if (step.required) {
        await rollbackIfNeeded(i)
        return {
          chainName: chain.name,
          success: false,
          steps,
          finalResult: `Step ${i + 1} (${step.description}) failed: ${stepResult.result}`,
          totalTimeMs: Date.now() - startTime,
          completedSteps,
        }
      }
    }
  }

  return {
    chainName: chain.name,
    success: true,
    steps,
    finalResult: prevResult,
    totalTimeMs: Date.now() - startTime,
    completedSteps,
  }
}

/**
 * Formata o resultado de uma execução de chain para exibição.
 */
export function formatChainResult(result: ChainExecutionResult): string {
  const lines: string[] = []

  const statusIcon = result.success ? "✅" : "❌"
  lines.push(`## ${statusIcon} Workflow: ${result.chainName}\n`)
  lines.push(`**Tempo:** ${result.totalTimeMs}ms`)
  lines.push(`**Steps:** ${result.completedSteps}/${result.steps.length}\n`)

  // Steps
  for (const step of result.steps) {
    const icon = step.success ? "✅" : "❌"
    lines.push(`### ${icon} Step ${step.stepIndex + 1}: ${step.description}`)
    lines.push(`Tool: \`${step.tool}\``)
    if (!step.success) {
      lines.push(`Erro: ${step.result}`)
    }
    lines.push("")
  }

  // Resultado final
  if (result.success) {
    lines.push("### Resultado Final")
    lines.push(result.finalResult)
  } else {
    lines.push("### Falha na Chain")
    lines.push(result.finalResult)
  }

  return lines.join("\n")
}

/**
 * Rollback: desfaz os steps completados.
 * Nota: Na prática, o rollback é feito via snapshots do SDD.
 * Esta função apenas informa o que precisa ser desfeito.
 */
export function getRollbackPlan(result: ChainExecutionResult): string[] {
  const plan: string[] = []

  for (const step of result.steps) {
    if (step.success) {
      plan.push(`Reverter step ${step.stepIndex + 1}: ${step.description} (${step.tool})`)
    }
  }

  return plan
}
