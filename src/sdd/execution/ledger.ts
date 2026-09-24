import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs"
import { createHash } from "crypto"
import { join } from "path"
import type { ExecutionContext, ExecutionRecord, ExecutionStatus } from "./types.js"

const MAX_VALUE_LENGTH = 12_000

function executionsDir(projectDir: string): string {
  return join(projectDir, ".sdd", "executions")
}

function ledgerPath(projectDir: string): string {
  return join(executionsDir(projectDir), "events.jsonl")
}

function truncate(value: string): string {
  return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value
}

function safeArgs(args: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!args) return undefined
  try {
    return JSON.parse(JSON.stringify(args)) as Record<string, unknown>
  } catch {
    return { value: String(args) }
  }
}

export function hashExecutionArgs(args: Record<string, unknown>): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize)
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]))
    }
    return value
  }
  return createHash("sha256").update(JSON.stringify(normalize(args))).digest("hex")
}

export function createExecutionId(prefix = "EXE"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function recordExecution(record: ExecutionRecord): void {
  const dir = executionsDir(record.projectDir)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  appendFileSync(ledgerPath(record.projectDir), `${JSON.stringify({ ...record, output: record.output ? truncate(record.output) : undefined, error: record.error ? truncate(record.error) : undefined })}\n`, "utf8")
}

export function startExecution(
  context: ExecutionContext,
  options: {
    id?: string
    args?: Record<string, unknown>
    metadata?: Record<string, unknown>
    graphFingerprintBefore?: string
  } = {},
): ExecutionRecord {
  const now = new Date().toISOString()
  const record: ExecutionRecord = {
    id: options.id || createExecutionId(),
    runId: context.runId,
    stepId: context.stepId,
    parentRunId: context.parentRunId,
    projectDir: context.projectDir,
    sessionId: context.sessionId,
    messageId: context.messageId,
    callId: context.callId,
    chainName: context.chainName,
    toolName: context.toolName,
    changeId: context.changeId,
    taskId: context.taskId,
    promiseIds: context.promiseIds,
    status: "running",
    startedAt: now,
    argsHash: options.args ? hashExecutionArgs(options.args) : undefined,
    args: safeArgs(options.args),
    graphFingerprintBefore: options.graphFingerprintBefore,
    metadata: options.metadata,
  }
  recordExecution(record)
  return record
}

export function finishExecution(
  record: ExecutionRecord,
  status: ExecutionStatus,
  options: { output?: string; error?: string; graphFingerprintAfter?: string; metadata?: Record<string, unknown> } = {},
): ExecutionRecord {
  const completedAt = new Date().toISOString()
  const finished: ExecutionRecord = {
    ...record,
    status,
    completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(record.startedAt)),
    output: options.output,
    error: options.error,
    graphFingerprintAfter: options.graphFingerprintAfter,
    metadata: { ...record.metadata, ...options.metadata },
  }
  recordExecution(finished)
  return finished
}

export function readExecutionRecords(projectDir: string): ExecutionRecord[] {
  const file = ledgerPath(projectDir)
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as ExecutionRecord]
      } catch {
        return []
      }
    })
}

export function getExecutionRun(projectDir: string, runId: string): ExecutionRecord[] {
  return readExecutionRecords(projectDir).filter((record) => record.runId === runId)
}

export function findLatestExecutionByCall(projectDir: string, callId: string): ExecutionRecord | undefined {
  return readExecutionRecords(projectDir).filter((record) => record.callId === callId).at(-1)
}
