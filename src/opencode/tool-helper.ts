/**
 * Local stand-in for the V1 `tool()` helper from `@opencode-ai/plugin`.
 *
 * The V1 helper is an identity function whose only extra surface is
 * `tool.schema` (a zod instance). Importing it would make the published bundle
 * depend on `@opencode-ai/plugin` at runtime, which breaks two things:
 *
 *   - a V2-only host has no reason to install the V1 package;
 *   - `scripts/check-import-isolated.cjs` installs production dependencies only,
 *     so `require("dist/index.js")` would throw.
 *
 * All Telos types (`ToolDefinition`, `ToolContext`) stay imported from the real
 * package as `import type`, which is erased at compile time and therefore adds
 * no runtime edge.
 *
 * The catalog is authored against `zod/v4`, shipped by the `zod` dependency this
 * package already declares. Using one single v4 instance — rather than the
 * nested copy inside `@opencode-ai/plugin` — is what lets the V2 adapter rebuild
 * the object schema and validate arguments successfully.
 */

import * as z4 from "zod/v4"
import type { ToolContext, ToolResult } from "@opencode-ai/plugin"

/** The argument-shape type accepted by `tool()`. */
export type ToolArgs = z4.ZodRawShape

/**
 * A declared Telos tool.
 *
 * Declared here rather than imported from `@opencode-ai/plugin` because the
 * plugin's own `ToolDefinition` infers through *its* zod instance; keeping the
 * inference on `zod/v4` preserves the argument typing at all ~70 `tool({...})`
 * call sites. The type-only `ToolContext`/`ToolResult` imports are erased and add
 * no runtime edge.
 */
export interface ToolDefinition<Args extends ToolArgs = any> {
  description: string
  args: Args
  execute(args: z4.infer<z4.ZodObject<Args>>, context: ToolContext): Promise<ToolResult>
}

/**
 * Identity factory: declares a Telos tool without wrapping it.
 *
 * Mirrors `@opencode-ai/plugin`'s `tool()` signature so every existing call site
 * keeps compiling unchanged.
 */
export function tool<Args extends ToolArgs>(input: {
  description: string
  args: Args
  execute(args: z4.infer<z4.ZodObject<Args>>, context: ToolContext): Promise<ToolResult>
}): ToolDefinition<Args> {
  return input as ToolDefinition<Args>
}

/** zod v4, exposed under the name the catalog was authored with. */
tool.schema = z4

export type { ToolContext, ToolResult }
