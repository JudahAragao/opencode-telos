import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
const MAX_VALUE_LENGTH = 12_000;
function executionsDir(projectDir) {
    return join(projectDir, ".sdd", "executions");
}
function ledgerPath(projectDir) {
    return join(executionsDir(projectDir), "events.jsonl");
}
function truncate(value) {
    return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
}
function safeArgs(args) {
    if (!args)
        return undefined;
    try {
        return JSON.parse(JSON.stringify(args));
    }
    catch {
        return { value: String(args) };
    }
}
export function hashExecutionArgs(args) {
    const normalize = (value) => {
        if (Array.isArray(value))
            return value.map(normalize);
        if (value && typeof value === "object") {
            return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
        }
        return value;
    };
    return createHash("sha256").update(JSON.stringify(normalize(args))).digest("hex");
}
export function createExecutionId(prefix = "EXE") {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
export function recordExecution(record) {
    const dir = executionsDir(record.projectDir);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    appendFileSync(ledgerPath(record.projectDir), `${JSON.stringify({ ...record, output: record.output ? truncate(record.output) : undefined, error: record.error ? truncate(record.error) : undefined })}\n`, "utf8");
}
export function startExecution(context, options = {}) {
    const now = new Date().toISOString();
    const record = {
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
    };
    recordExecution(record);
    return record;
}
export function finishExecution(record, status, options = {}) {
    const completedAt = new Date().toISOString();
    const finished = {
        ...record,
        status,
        completedAt,
        durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(record.startedAt)),
        output: options.output,
        error: options.error,
        graphFingerprintAfter: options.graphFingerprintAfter,
        metadata: { ...record.metadata, ...options.metadata },
    };
    recordExecution(finished);
    return finished;
}
export function readExecutionRecords(projectDir) {
    const file = ledgerPath(projectDir);
    if (!existsSync(file))
        return [];
    return readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => {
        try {
            return [JSON.parse(line)];
        }
        catch {
            return [];
        }
    });
}
export function getExecutionRun(projectDir, runId) {
    return readExecutionRecords(projectDir).filter((record) => record.runId === runId);
}
export function findLatestExecutionByCall(projectDir, callId) {
    return readExecutionRecords(projectDir).filter((record) => record.callId === callId).at(-1);
}
