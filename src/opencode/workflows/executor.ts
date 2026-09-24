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
import type { ExecutionContext, ToolExecutionResult } from "../../sdd/execution/types.js"
import { createExecutionId, finishExecution, getExecutionRun, startExecution } from "../../sdd/execution/ledger.js"

export interface StepResult {
  stepIndex: number
  stepId: string
  runId: string
  tool: string
  description: string
  success: boolean
  result: string
  status: ToolExecutionResult["status"]
  data?: Record<string, unknown>
  error?: string
  timestamp: string
}

export interface ChainExecutionResult {
  runId: string
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
export type ToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
  context?: Pick<ExecutionContext, "runId" | "stepId" | "signal" | "chainName" | "projectDir" | "sessionId" | "messageId" | "parentRunId">,
) => Promise<string | ToolExecutionResult>

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
  executionOptions?: Partial<ExecutionContext>,
): Promise<ChainExecutionResult> {
  const startTime = Date.now()
  const runId = executionOptions?.runId || createExecutionId("RUN")
  const projectDir = executionOptions?.projectDir || ""
  if (projectDir) {
    const previousRun = getExecutionRun(projectDir, runId).at(-1)
    const previousResult = previousRun?.metadata?.result
    if (previousRun?.status === "completed" && previousResult && typeof previousResult === "object") {
      return previousResult as ChainExecutionResult
    }
  }
  const chainRecord = projectDir
    ? startExecution({ ...executionOptions, runId, projectDir, chainName: chain.name }, { args: initialParams })
    : undefined
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

  const finishChain = (result: ChainExecutionResult): ChainExecutionResult => {
    if (chainRecord) {
      finishExecution(chainRecord, result.success ? "completed" : "failed", {
        output: result.finalResult,
        metadata: { completedSteps: result.completedSteps, stepCount: result.steps.length, result },
      })
    }
    return result
  }

  for (let i = 0; i < chain.steps.length; i++) {
    if (Date.now() - startTime >= config.chainTimeoutMs) {
      await rollbackIfNeeded(i)
      return finishChain({
        runId,
        chainName: chain.name,
        success: false,
        steps,
        finalResult: `Workflow timed out after ${config.chainTimeoutMs}ms`,
        totalTimeMs: Date.now() - startTime,
        completedSteps,
      })
    }
    const step = chain.steps[i]
    const stepId = `${runId}-STEP-${String(i + 1).padStart(3, "0")}`
    const args = typeof step.args === "function"
      ? step.args(prevResult, initialParams, previousSteps)
      : step.args

    let stepRecord: ReturnType<typeof startExecution> | undefined
    let timedOut = false
    try {
      if (config.snapshotBeforeStep && hooks?.beforeStep) {
        snapshots.push(await hooks.beforeStep(i, step))
      }
      const controller = new AbortController()
      stepRecord = projectDir
        ? startExecution({
          ...executionOptions,
          runId,
          stepId,
          projectDir,
          chainName: chain.name,
          toolName: step.tool,
          signal: controller.signal,
        }, { args })
        : undefined
      const timeout = setTimeout(() => {
        timedOut = true
        controller.abort(new Error(`Step timed out after ${config.stepTimeoutMs}ms`))
      }, config.stepTimeoutMs)
      let rawResult: string | ToolExecutionResult
      try {
        rawResult = await Promise.race([
          executeTool(step.tool, args, {
            runId,
            stepId,
            signal: controller.signal,
            chainName: chain.name,
            projectDir,
            sessionId: executionOptions?.sessionId,
            messageId: executionOptions?.messageId,
            parentRunId: executionOptions?.parentRunId,
          }),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener("abort", () => reject(controller.signal.reason || new Error(`Step timed out after ${config.stepTimeoutMs}ms`)), { once: true })
          }),
        ])
      } finally {
        clearTimeout(timeout)
      }
      const structured: ToolExecutionResult = typeof rawResult === "string"
        ? { status: "completed", output: rawResult }
        : rawResult
      const result = structured.output
      const outputFailure = result.includes("BLOCKED") || result.startsWith("Error:")
      const successful = structured.status === "completed" && !outputFailure
      const stepResult: StepResult = {
        stepIndex: i,
        stepId,
        runId,
        tool: step.tool,
        description: step.description,
        success: successful,
        result,
        status: structured.status,
        data: structured.data,
        error: structured.error,
        timestamp: new Date().toISOString(),
      }
      steps.push(stepResult)
      if (stepRecord) finishExecution(stepRecord, successful ? structured.status : "blocked", { output: result, error: structured.error })
      previousSteps.push({ tool: step.tool, result, stepId, status: structured.status, data: structured.data })
      prevResult = result
      if (successful) completedSteps++

      // Se o resultado indica falha (contém "BLOCKED" ou "Error")
      if (!successful) {
        if (step.required) {
          await rollbackIfNeeded(i)
          return finishChain({
            runId,
            chainName: chain.name,
            success: false,
            steps,
            finalResult: `Step ${i + 1} failed: ${result}`,
            totalTimeMs: Date.now() - startTime,
            completedSteps,
          })
        }
      }
    } catch (error) {
      const stepResult: StepResult = {
        stepIndex: i,
        stepId,
        runId,
        tool: step.tool,
        description: step.description,
        success: false,
        result: error instanceof Error ? error.message : String(error),
        status: timedOut ? "timed_out" : (error instanceof Error && error.name === "AbortError" ? "cancelled" : "failed"),
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }
      steps.push(stepResult)
      if (stepRecord) finishExecution(stepRecord, stepResult.status, { error: stepResult.result })

      if (step.required) {
        await rollbackIfNeeded(i)
        const status = stepResult.status === "cancelled" || stepResult.status === "timed_out" ? stepResult.status : "failed"
        if (chainRecord) finishExecution(chainRecord, status, { error: stepResult.result })
        return {
          runId,
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

  return finishChain({
    runId,
    chainName: chain.name,
    success: true,
    steps,
    finalResult: prevResult,
    totalTimeMs: Date.now() - startTime,
    completedSteps,
  })
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
