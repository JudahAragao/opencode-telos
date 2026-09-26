/**
 * V2 host registration (`@opencode/plugin` 2.x).
 *
 * Every rule is delegated to `./sdd-runtime.ts`, the same module the V1 adapter
 * uses, so enforcement, audit, ledger, telemetry, cache and command behaviour
 * cannot drift between hosts. This file only translates between the V2 context
 * and that shared runtime.
 *
 * Hook mapping (per the official V1 → V2 migration table):
 *
 *   experimental.chat.system.transform   → ctx.session.hook("context")
 *   experimental.chat.messages.transform → ctx.session.hook("context") (event.messages)
 *   tool.execute.before / after          → ctx.tool.hook("execute.before" / "execute.after")
 *   permission.ask                       → ctx.permission.hook("evaluate")
 *   tool.definition                      → ctx.tool.transform + editor.update
 *   command config + execute.before     → ctx.command.transform
 *   dispose                              → the Cleanup returned by setup
 */

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
} from "../sdd-runtime.js"
import {
  buildV2ToolCatalog,
  rewriteForV2,
  SDD_NAMESPACE,
  SDD_NAMESPACE_DESCRIPTION,
  type V2ToolCatalog,
} from "./tools.js"
import { createSddTools } from "../tools.js"
import {
  extractSddCommandText,
  renderSddCommandMessage,
  runSddCommand,
  SDD_COMMAND_DESCRIPTION,
  SDD_COMMAND_NAME,
} from "../command.js"
import { sddDebug } from "../../sdd/log.js"

/** A V2 system-prompt part (`@opencode/ai` `SystemPart`). */
interface V2SystemPart {
  type: "text"
  text: string
}

/** A V2 chat message, narrowed to the fields the rewrite needs. */
interface V2Message {
  role?: string
  id?: string
  content?: Array<{ type: string; text?: string }>
}

/** Structural view of the V2 tool editor (`ToolEditor`). */
export interface V2ToolEditor {
  namespace(namespace: { name: string; description: string }): void
  add(tool: unknown): void
  update(id: string, update: (tool: { description: string }) => void): void
  get(id: string): unknown
}

/** A V2 command definition (`CommandDefinition`). */
interface V2CommandDefinition {
  name: string
  description?: string
  execute(input: {
    sessionID: string
    prompt: { text: string }
    delivery: "steer" | "queue"
  }): Promise<void>
}

/** Structural view of the parts of `Context` that Telos depends on. */
export interface V2Context {
  readonly location: { readonly directory: string }
  readonly tool: {
    transform(callback: (editor: V2ToolEditor) => void): Promise<{ dispose(): Promise<void> }>
    hook(name: string, callback: (event: never) => unknown): Promise<{ dispose(): Promise<void> }>
  }
  readonly session: {
    hook(name: string, callback: (event: never) => unknown): Promise<{ dispose(): Promise<void> }>
    prompt(input: { sessionID: string; text: string; delivery?: "steer" | "queue" }): Promise<unknown>
    synthetic(input: { sessionID: string; text: string; resume?: boolean }): Promise<unknown>
  }
  readonly permission: {
    hook(name: string, callback: (event: never) => unknown): Promise<{ dispose(): Promise<void> }>
  }
  readonly command: {
    transform(callback: (editor: { add(definition: V2CommandDefinition): void }) => void): Promise<{ dispose(): Promise<void> }>
  }
}

export interface V2RegistrationResult {
  /** Canonical `sdd.*` → effective `sdd_*`, for diagnostics and tests. */
  effectiveNames: Map<string, string>
  /** Effective `sdd_*` → canonical `sdd.*`. */
  canonicalNames: Map<string, string>
  /** Releases host-independent runtime state (cache handles, timer handles). */
  release: () => void
}

/**
 * Host terminal tool ids Telos annotates, across V1 and V2 spellings.
 *
 * `editor.update` ignores a missing id, so listing several spellings is safe on
 * every host.
 */
const TERMINAL_TOOL_IDS = ["run_terminal_command", "bash", "shell", "terminal"]

/**
 * Register the whole Telos surface on a V2 host.
 *
 * Returns the name maps and a `release` function so the entrypoint (and tests)
 * can assert and clean up without reaching into the host.
 */
export async function registerSddV2(
  ctx: V2Context,
  projectDir: string,
  options: { debug?: boolean } = {},
): Promise<V2RegistrationResult> {
  const state: SddRuntimeState = createRuntimeState()
  // V2 always normalizes the namespace to underscores, so the tool-name
  // projection is unconditional on this host.
  const safeToolNames = true

  // ── Tools ────────────────────────────────────────────────────────────────
  // V1 offers a per-tool `ctx.ask` permission helper; V2 has no equivalent, and
  // the host's `permission.hook("evaluate")` below is the single decision point.
  // Telos tools therefore accept what the host already authorized.
  const catalog: V2ToolCatalog = buildV2ToolCatalog(createSddTools(), projectDir, async () => {})

  await ctx.tool.transform((editor) => {
    editor.namespace({ name: SDD_NAMESPACE, description: SDD_NAMESPACE_DESCRIPTION })
    for (const definition of catalog.definitions.values()) {
      editor.add(definition)
    }
  })

  // ── Enforcement ──────────────────────────────────────────────────────────
  // Throwing from `execute.before` is the documented way to block a call.
  await ctx.tool.hook("execute.before", (event) => {
    const toolEvent = event as unknown as {
      tool: string
      sessionID: string
      id: string
      input: unknown
    }
    const blocked = enforceToolExecution(
      projectDir,
      toolEvent.sessionID,
      toolEvent.id,
      toolEvent.tool,
      (toolEvent.input ?? {}) as Record<string, unknown>,
      state,
      safeToolNames,
    )
    if (blocked) throw new Error(blocked)
  })

  await ctx.tool.hook("execute.after", (event) => {
    const toolEvent = event as unknown as {
      tool: string
      sessionID: string
      id: string
      status: "completed" | "error"
      result?: { content?: string | ReadonlyArray<{ type: string; text?: string }> }
      error?: { message?: string }
    }
    const text =
      toolEvent.status === "error"
        ? `Error: ${toolEvent.error?.message ?? "unknown error"}`
        : renderResultContent(toolEvent.result)
    observeToolExecution(projectDir, toolEvent.sessionID, toolEvent.id, toolEvent.tool, text, state, safeToolNames)
  })

  // ── Tool descriptions ────────────────────────────────────────────────────
  // Replaces the V1 `tool.definition` hook: Telos annotates the host's terminal
  // tool so the model knows shell writes are gated.
  await ctx.tool.transform((editor) => {
    for (const id of TERMINAL_TOOL_IDS) {
      const existing = editor.get(id) as { description?: string } | undefined
      const description = annotateToolDefinition(id, existing?.description)
      editor.update(id, (tool) => {
        tool.description = description ?? tool.description
      })
    }
  })

  // ── System prompt + stored command messages ──────────────────────────────
  // Awaited (not fire-and-forget): the host must see the mutations before it
  // builds the model request.
  await ctx.session.hook("context", async (event) => {
    const contextEvent = event as unknown as {
      sessionID: string
      system: V2SystemPart[]
      messages: V2Message[]
    }

    // `/sdd ...` stored in history must reach the model as its deterministic
    // result, never as the raw command (see sdd-runtime for the rationale).
    rewriteSddCommandMessages(projectDir, contextEvent.messages)

    const sections = await buildSystemPromptSections(
      projectDir,
      contextEvent.sessionID,
      safeToolNames,
      state,
    )
    for (const section of sections) {
      contextEvent.system.push({ type: "text", text: rewriteForV2(section) })
    }
  })

  // ── Prompt admission ─────────────────────────────────────────────────────
  // Safety net for an `/sdd ...` that reaches the model as plain text — for
  // example when it is typed into a client that does not resolve commands. The
  // command transform below is the primary path.
  await ctx.session.hook("prompt", (event) => {
    const promptEvent = event as unknown as { sessionID: string; prompt: { text: string } }
    const text = promptEvent.prompt?.text
    if (typeof text !== "string") return
    const raw = extractSddCommandText(text)
    if (!raw) return
    promptEvent.prompt.text = renderSddCommandMessage(projectDir, raw, undefined, promptEvent.sessionID)
  })

  // ── Permissions ──────────────────────────────────────────────────────────
  await ctx.permission.hook("evaluate", (event) => {
    const permissionEvent = event as unknown as {
      action: string
      resources: ReadonlyArray<string>
      effect: "allow" | "ask" | "deny"
    }
    // V1 evaluated the permission *pattern*; V2 reports an action plus the
    // resources it targets, so both are offered to the shared rule.
    const allowed = permissionEvent.resources.some((resource) =>
      shouldAutoAllowPermission(resource, [], safeToolNames),
    ) || shouldAutoAllowPermission(permissionEvent.action, [], safeToolNames)
    if (allowed) permissionEvent.effect = "allow"
  })

  // ── `/sdd` command ───────────────────────────────────────────────────────
  await ctx.command.transform((editor) => {
    editor.add({
      name: SDD_COMMAND_NAME,
      description: SDD_COMMAND_DESCRIPTION,
      execute: async ({ sessionID, prompt, delivery }) => {
        // The plugin owns the command, so it is executed here — no LLM turn.
        // `runSddCommand` is the same deterministic router the V1 host uses.
        //
        // V1 received `command` + `arguments`; V2 hands over the parsed command
        // name plus `prompt.text`, which the host may or may not still prefix
        // with `sdd`. Normalize both into the canonical `sdd <sub>` form, exactly
        // as `createSddCommandHooks` does for V1.
        const args = `${prompt?.text ?? ""}`.replace(/^[/\s]+/, "").trim().toLowerCase()
        const raw = args.startsWith(SDD_COMMAND_NAME) ? args : `${SDD_COMMAND_NAME} ${args}`.trim()
        const result = runSddCommand(projectDir, raw, sessionID)
        if (!result.matched) return

        try {
          // `resume: false` records the message durably in the session inbox
          // without scheduling a model request, which is what makes
          // `/sdd status` genuinely free.
          await ctx.session.synthetic({ sessionID, text: result.text, resume: false })
        } catch (error) {
          if (options.debug) sddDebug("v2", `synthetic delivery failed: ${String(error)}`)
          // Fall back to a normal prompt for hosts without synthetic messages.
          await ctx.session.prompt({ sessionID, text: result.text, delivery })
        }
      },
    })
  })

  return {
    effectiveNames: catalog.effectiveNames,
    canonicalNames: catalog.canonicalNames,
    release: () => releaseRuntimeResources(projectDir),
  }
}

/** Flatten a V2 tool result into the text the ledger and telemetry record. */
function renderResultContent(
  result: { content?: string | ReadonlyArray<{ type: string; text?: string }> } | undefined,
): string {
  const content = result?.content
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("\n")
  }
  return ""
}
