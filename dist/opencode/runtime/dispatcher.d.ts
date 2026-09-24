import type { ToolContext } from "@opencode-ai/plugin";
import type { ToolExecutionResult } from "../../sdd/execution/types.js";
import type { ExecutionContext } from "../../sdd/execution/types.js";
/**
 * Single internal dispatch path for workflow steps.
 * It preserves the OpenCode ToolContext (especially AbortSignal and metadata)
 * while adding the run/step identity used by the execution ledger.
 */
export declare function executeSddTool(toolName: string, toolArgs: Record<string, unknown>, ctx: ToolContext, executionContext?: Pick<ExecutionContext, "runId" | "stepId" | "signal" | "chainName" | "projectDir" | "sessionId" | "messageId" | "parentRunId">): Promise<ToolExecutionResult>;
