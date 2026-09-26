/**
 * Tool catalog primitives.
 *
 * The Telos catalog is authored once here — zod schemas (`zod/v4`, shipped by
 * the `zod` dependency this package already declares) plus a small local
 * context/result contract — and projected onto the OpenCode V2 registry by
 * `./v2/tools.ts`. Keeping the primitives local means the published bundle has
 * no runtime dependency on any host SDK, which keeps
 * `scripts/check-import-isolated.cjs` green: production installs exclude peer
 * dependencies.
 */

import * as z4 from "zod/v4"

/** The argument-shape type accepted by `tool()`. */
export type ToolArgs = z4.ZodRawShape

/**
 * Context handed to every tool executor.
 *
 * The V2 adapter (`./v2/tools.ts`) builds this from the host's tool context:
 * `signal` becomes `abort`, and the resolved project root becomes both
 * `directory` and `worktree`, which is what the handlers use to reach `.sdd/`.
 */
export interface ToolContext {
  readonly sessionID: string
  readonly messageID: string
  readonly agent?: string
  readonly directory: string
  readonly worktree?: string
  readonly abort?: AbortSignal
  metadata(input: { title?: string; metadata?: Record<string, unknown> }): void
  ask?(input: { permission: string; patterns: string[]; always: string[]; metadata: Record<string, unknown> }): Promise<void>
}

/** A tool result: a bare string, or an output envelope with optional metadata. */
export type ToolResult = string | { title?: string; output: string; metadata?: Record<string, unknown> }

/**
 * A declared Telos tool.
 */
export interface ToolDefinition<Args extends ToolArgs = any> {
  description: string
  args: Args
  execute(args: z4.infer<z4.ZodObject<Args>>, context: ToolContext): Promise<ToolResult>
}

/**
 * Identity factory: declares a Telos tool without wrapping it.
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
