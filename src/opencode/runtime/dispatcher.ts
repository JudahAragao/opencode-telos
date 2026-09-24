import type { ToolContext } from "@opencode-ai/plugin"
import { withProjectExecutionLock } from "../../sdd/execution/lock.js"
import type { ToolExecutionResult } from "../../sdd/execution/types.js"
import type { ExecutionContext } from "../../sdd/execution/types.js"

/**
 * Single internal dispatch path for workflow steps.
 * It preserves the OpenCode ToolContext (especially AbortSignal and metadata)
 * while adding the run/step identity used by the execution ledger.
 */
export async function executeSddTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
  ctx: ToolContext,
  executionContext?: Pick<ExecutionContext, "runId" | "stepId" | "signal" | "chainName" | "projectDir" | "sessionId" | "messageId" | "parentRunId">,
): Promise<ToolExecutionResult> {
  if (executionContext?.signal?.aborted) {
    return { status: "cancelled", output: "BLOCKED: step cancelled before tool execution" }
  }

  const { createSddTools } = await import("../tools.js")
  const sddTool = createSddTools()[toolName]
  if (!sddTool) return { status: "failed", output: `Error: Tool ${toolName} not found` }

  const stepContext: ToolContext = {
    ...ctx,
    abort: executionContext?.signal || ctx.abort,
    metadata: (input) => {
      ctx.metadata({
        title: input.title,
        metadata: {
          ...input.metadata,
          execution_id: executionContext?.stepId,
          execution_run_id: executionContext?.runId,
        },
      })
    },
  }
  const result = await withProjectExecutionLock(ctx.directory, () => sddTool.execute(toolArgs, stepContext))
  if (typeof result === "string") {
    return { status: result.includes("BLOCKED") || result.startsWith("Error:") ? "blocked" : "completed", output: result }
  }
  if (result && typeof result === "object" && "output" in result) {
    return {
      status: result.output.includes("BLOCKED") || result.output.startsWith("Error:") ? "blocked" : "completed",
      output: result.output,
      data: result.metadata,
    }
  }
  return { status: "completed", output: JSON.stringify(result) }
}
