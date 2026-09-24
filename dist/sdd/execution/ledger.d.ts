import type { ExecutionContext, ExecutionRecord, ExecutionStatus } from "./types.js";
export declare function hashExecutionArgs(args: Record<string, unknown>): string;
export declare function createExecutionId(prefix?: string): string;
export declare function recordExecution(record: ExecutionRecord): void;
export declare function startExecution(context: ExecutionContext, options?: {
    id?: string;
    args?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    graphFingerprintBefore?: string;
}): ExecutionRecord;
export declare function finishExecution(record: ExecutionRecord, status: ExecutionStatus, options?: {
    output?: string;
    error?: string;
    graphFingerprintAfter?: string;
    metadata?: Record<string, unknown>;
}): ExecutionRecord;
export declare function readExecutionRecords(projectDir: string): ExecutionRecord[];
export declare function getExecutionRun(projectDir: string, runId: string): ExecutionRecord[];
export declare function findLatestExecutionByCall(projectDir: string, callId: string): ExecutionRecord | undefined;
