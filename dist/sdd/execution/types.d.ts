/**
 * Shared execution identity used by every asynchronous SDD operation.
 *
 * A run is the durable unit of work. Steps and tool calls are children of a
 * run, which makes retries, timeout diagnosis and traceability deterministic.
 */
export type ExecutionStatus = "pending" | "running" | "completed" | "failed" | "timed_out" | "cancelled" | "rolled_back" | "blocked";
export interface ExecutionContext {
    runId: string;
    stepId?: string;
    parentRunId?: string;
    projectDir: string;
    sessionId?: string;
    messageId?: string;
    callId?: string;
    chainName?: string;
    toolName?: string;
    changeId?: string;
    taskId?: string;
    promiseIds?: string[];
    signal?: AbortSignal;
}
export interface ExecutionRecord {
    id: string;
    runId: string;
    stepId?: string;
    parentRunId?: string;
    projectDir: string;
    sessionId?: string;
    messageId?: string;
    callId?: string;
    chainName?: string;
    toolName?: string;
    changeId?: string;
    taskId?: string;
    promiseIds?: string[];
    status: ExecutionStatus;
    startedAt: string;
    completedAt?: string;
    durationMs?: number;
    argsHash?: string;
    args?: Record<string, unknown>;
    output?: string;
    error?: string;
    graphFingerprintBefore?: string;
    graphFingerprintAfter?: string;
    metadata?: Record<string, unknown>;
}
export interface ToolExecutionResult {
    status: ExecutionStatus;
    output: string;
    data?: Record<string, unknown>;
    error?: string;
    executionId?: string;
}
