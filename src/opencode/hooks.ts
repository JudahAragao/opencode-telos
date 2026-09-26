import type { Hooks } from "@opencode-ai/plugin"
import {
  annotateToolDefinition,
  buildSystemPromptSections,
  createRuntimeState,
  enforceToolExecution,
  observeToolExecution,
  releaseRuntimeResources,
  rewriteSddCommandMessages,
  shouldAutoAllowPermission,
  type SddRuntimeState,
} from "./sdd-runtime.js"

export { detectShellFileWrites } from "./sdd-runtime.js"

/**
 * V1 host adapter (OpenCode 1.18 `Hooks`).
 *
 * The host delivers `(input, output)` pairs; every rule itself lives in
 * `./sdd-runtime.ts` and is shared verbatim with the V2 adapter in `./v2/hooks.ts`.
 */
export function createSddHooks(projectDir: string, safeToolNames = false): Hooks {
  const state: SddRuntimeState = createRuntimeState()

  return {
    "experimental.chat.system.transform": async (input, output) => {
      const sections = await buildSystemPromptSections(projectDir, input.sessionID, safeToolNames, state)
      for (const section of sections) output.system.push(section)
    },

    // `/sdd ...` commands are executed deterministically by the plugin
    // (see createSddCommandHooks). OpenCode 1.18 has no way to skip the LLM
    // turn after command.execute.before, so the command's result must reach
    // the model. This hook rewrites the command message to the deterministic
    // result text — the model only ever sees the outcome, never the raw
    // command, so it cannot re-execute or "investigate" it.
    "experimental.chat.messages.transform": async (_input, output) => {
      rewriteSddCommandMessages(projectDir, output.messages as never)
    },

    "tool.execute.before": async (input, output) => {
      const blocked = enforceToolExecution(
        projectDir,
        input.sessionID,
        input.callID,
        input.tool,
        output.args as Record<string, unknown> | undefined,
        state,
        safeToolNames,
      )
      if (blocked) throw new Error(blocked)
    },

    "tool.execute.after": async (input, output) => {
      const outputText = typeof output.output === "string" ? output.output : String(output.output || "")
      observeToolExecution(projectDir, input.sessionID, input.callID, input.tool, outputText, state, safeToolNames)

      if (!output.metadata) return
      const timestamp = new Date().toISOString()
      output.metadata.sdd_tool = true
      output.metadata.sdd_timestamp = timestamp
    },

    "tool.definition": async (input, output) => {
      const description = annotateToolDefinition(input.toolID, output.description)
      if (description !== undefined) output.description = description
    },

    "permission.ask": async (input, output) => {
      const patterns = typeof input.pattern === "string" ? [input.pattern] : input.pattern
      if (!Array.isArray(patterns)) return
      if (patterns.some((pattern: string) => shouldAutoAllowPermission(pattern, [], safeToolNames))) {
        output.status = "allow"
      }
    },

    dispose: async () => {
      releaseRuntimeResources(projectDir)
    },
  }
}
