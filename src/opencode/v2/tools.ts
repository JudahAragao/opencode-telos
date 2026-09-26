/**
 * V2 tool registration.
 *
 * The Telos catalog stays authored once, in `createSddTools()` (zod schemas, V1
 * `ToolDefinition` shape). This module projects it onto the V2 registry:
 *
 *   - `sdd.acceptance` → namespace `sdd` + tool `acceptance` → effective id
 *     `sdd_acceptance`. The V2 core performs this normalization itself (dots and
 *     unsupported characters in a namespace become `_`), so the plugin does not
 *     rename anything by hand.
 *   - `input` becomes JSON Schema, derived from the same zod raw shape. V2 also
 *     accepts a Standard Schema there, but the published JSON Schema keeps the
 *     model-facing contract explicit and matches the official examples.
 *   - `execute` re-validates the arguments with zod and delegates to the V1
 *     implementation, so validation and business rules are identical on both
 *     hosts. The V1 return value (`string | { output }`) is mapped to the V2
 *     `Result` shape (`{ content }`).
 *
 * Because the model only ever sees `sdd_acceptance`, every description is
 * rewritten to the wire name — otherwise the prompt would advertise tool names
 * that are not registered.
 */

import { tool, type ToolDefinition, type ToolContext as V1ToolContext } from "../tool-helper.js"
import { toolArgsToJsonSchema, type JsonSchema, type ZodSchemaLike } from "./json-schema.js"
import { rewriteToolNames, toWireToolName } from "../tool-names.js"
import { ALL_TOOL_NAMES } from "../router/tool-registry.js"

/** The namespace every Telos tool is registered under in V2. */
export const SDD_NAMESPACE = "sdd"

/** Namespace description shown to the model when Code Mode is enabled. */
export const SDD_NAMESPACE_DESCRIPTION =
  "Spec-Driven Development (SDD) tools. The Knowledge Graph in .sdd/ is the source of truth: " +
  "run sdd_enforce before writing code, sdd_update_from_answers to update the specification, and " +
  "sdd_approve_change to authorize the implementation."

/**
 * A V2 tool, shaped like `Tool.Info` from `@opencode/schema/tool` but declared
 * structurally so the published package keeps zero runtime dependency on the
 * host SDK (see `scripts/check-import-isolated.cjs`). `src/index.ts` asserts the
 * real V2 editor accepts these at compile time.
 */
export interface V2ToolDefinition {
  readonly name: string
  readonly description: string
  readonly input: JsonSchema
  readonly options: { readonly namespace: string; readonly codemode: false }
  readonly execute: (input: unknown, context: V2ToolContext) => Promise<{ content: string }>
}

/**
 * The subset of the V2 `ToolContext` (`@opencode/plugin/promise`) the Telos
 * executors rely on. `signal` and `progress` are the only V2-specific members.
 */
export interface V2ToolContext {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly signal: AbortSignal
  readonly progress: (update: Record<string, unknown>) => Promise<void>
}

/** Effective (wire) name for a canonical Telos tool name. */
export function toEffectiveToolName(canonicalName: string): string {
  return toWireToolName(canonicalName, true)
}

/** Split `sdd.acceptance` into its namespace and bare tool name. */
export function splitToolName(canonicalName: string): { namespace: string; name: string } {
  const separator = canonicalName.indexOf(".")
  if (separator === -1) return { namespace: SDD_NAMESPACE, name: canonicalName }
  return { namespace: canonicalName.slice(0, separator), name: canonicalName.slice(separator + 1) }
}

/**
 * Build the V1 `ToolContext` the Telos executors expect from a V2 context.
 *
 * The only meaningful difference is `abort`: V1 passes an `AbortSignal` as
 * `abort`, V2 as `signal`. `directory` and `worktree` are the resolved project
 * root, which is what the handlers use to reach `.sdd/`.
 */
export function toV1ToolContext(
  context: V2ToolContext,
  projectDir: string,
  ask: (input: { permission: string; patterns: string[]; always: string[]; metadata: Record<string, unknown> }) => Promise<void>,
): V1ToolContext {
  return {
    sessionID: context.sessionID,
    messageID: context.messageID,
    agent: context.agent,
    directory: projectDir,
    worktree: projectDir,
    abort: context.signal,
    metadata: () => {},
    ask,
  }
}

/**
 * Normalize a V1 tool result into the V2 `Result` shape.
 *
 * V1 tools return either a bare string or `{ title?, output, metadata? }`. V2
 * renders `content`; `output` is left unset because Telos output is already
 * human/model readable text.
 */
export function toV2Result(result: string | { title?: string; output: string; metadata?: Record<string, unknown> }): { content: string } {
  if (typeof result === "string") return { content: result }
  return { content: result.output }
}

/** A zod validation issue, described structurally. */
interface ValidationIssue {
  path: ReadonlyArray<PropertyKey>
  message: string
}

/**
 * Rebuild the object schema with the very zod instance the catalog was authored
 * with.
 *
 * The Telos tools are declared through `tool()` from `@opencode-ai/plugin`,
 * whose `tool.schema` is a nested zod v4. Importing the repo's own `zod` here
 * would mix two majors and fail at runtime (`_parse is not a function`), so the
 * catalog's own instance is the only correct source.
 */
function objectSchemaFor(shape: Record<string, unknown>): {
  safeParse(input: unknown): { success: true; data: Record<string, unknown> } | { success: false; error: { issues: ValidationIssue[] } }
} {
  const z = tool.schema as unknown as {
    object(shape: Record<string, unknown>): ReturnType<typeof objectSchemaFor>
  }
  return z.object(shape)
}

/** Format a zod validation failure as an actionable tool error. */
export function formatValidationError(toolName: string, error: { issues: ValidationIssue[] }): string {
  const details = error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)"
      return `  - ${path}: ${issue.message}`
    })
    .join("\n")
  return [
    `[SDD INVALID ARGUMENTS] ${toolName} received arguments that do not match its schema.`,
    details,
    "",
    "Fix the arguments and call the tool again.",
  ].join("\n")
}

export interface V2ToolCatalog {
  /** Definitions in V2 registry shape, keyed by canonical `sdd.*` name. */
  definitions: Map<string, V2ToolDefinition>
  /** Canonical `sdd.*` → effective `sdd_*` name. */
  effectiveNames: Map<string, string>
  /** Effective `sdd_*` → canonical `sdd.*` name. */
  canonicalNames: Map<string, string>
}

/**
 * Project the whole Telos catalog onto the V2 registry shape.
 *
 * @param tools  the catalog from `createSddTools()`
 * @param projectDir  resolved project root, used to build the V1 tool context
 * @param ask  permission bridge. V2 has no equivalent of the V1 per-tool `ask`
 *   helper, so the host's `permission.hook("evaluate")` is the single decision
 *   point and the Telos tools accept what the host already authorized.
 */
export function buildV2ToolCatalog(
  tools: Record<string, ToolDefinition>,
  projectDir: string,
  ask: (input: { permission: string; patterns: string[]; always: string[]; metadata: Record<string, unknown> }) => Promise<void>,
): V2ToolCatalog {
  const definitions = new Map<string, V2ToolDefinition>()
  const effectiveNames = new Map<string, string>()
  const canonicalNames = new Map<string, string>()
  const canonicalList = Object.keys(tools)

  for (const [canonicalName, definition] of Object.entries(tools)) {
    const { namespace, name } = splitToolName(canonicalName)
    const effective = toEffectiveToolName(canonicalName)

    if (canonicalNames.has(effective)) {
      throw new Error(
        `Tool name collision in the V2 namespace: ${canonicalName} and ${canonicalNames.get(effective)} both resolve to ${effective}`,
      )
    }

    const shape = definition.args as unknown as Record<string, ZodSchemaLike>
    const schema = objectSchemaFor(shape)
    const input = toolArgsToJsonSchema(shape)
    // The model calls the tool by its effective name, so the description and any
    // `sdd.x` reference inside it must use the wire spelling.
    const description = rewriteToolNames(definition.description, canonicalList, true)

    definitions.set(canonicalName, {
      name,
      description,
      input,
      // Code Mode exposes tools as TypeScript declarations instead of callable
      // tools, which would bypass the per-call enforcement in `execute.before`.
      // The catalog is large and action-driven, so direct calls stay on.
      options: { namespace, codemode: false },
      execute: async (rawInput, context) => {
        const parsed = schema.safeParse(rawInput ?? {})
        if (!parsed.success) return { content: formatValidationError(canonicalName, parsed.error) }

        const result = await definition.execute(parsed.data, toV1ToolContext(context, projectDir, ask))
        return toV2Result(result)
      },
    })

    effectiveNames.set(canonicalName, effective)
    canonicalNames.set(effective, canonicalName)
  }

  return { definitions, effectiveNames, canonicalNames }
}

/**
 * The V2 system prompt must advertise effective names.
 *
 * V2 always projects `sdd.x` → `sdd_x` because the core normalizes namespaces,
 * so this is unconditional there (unlike V1, where the projection depends on the
 * configured compatibility mode).
 */
export function rewriteForV2(text: string): string {
  return rewriteToolNames(text, ALL_TOOL_NAMES, true)
}
