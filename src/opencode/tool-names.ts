import { ALL_TOOL_NAMES } from "./router/tool-registry.js"

/**
 * OpenCode V2 tool-name normalization.
 *
 * The V2 host registers tools under an *effective* id and performs the
 * normalization itself: "Dots in namespaces and unsupported characters in tool
 * names become _" (https://opencode.ai/v2/docs/build/plugins/). Telos authors
 * its catalog once with canonical dotted names (`sdd.acceptance`) under the
 * `sdd` namespace, and the host exposes `sdd_acceptance` on the wire for every
 * provider — including strict OpenAI-compatible ones that reject dots.
 *
 * These helpers only mirror that documented host rule so enforcement, the
 * system prompt and the tool registry can spell names exactly the way the
 * model sees them. There is no configurable mode, no environment variable and
 * no plugin-side renaming of the registry — the host does the normalization.
 */

/** Effective (wire) name for a canonical `sdd.*` tool name. */
export function toWireToolName(canonicalName: string): string {
  return canonicalName.replaceAll(".", "_")
}

const CANONICAL_BY_WIRE = new Map(ALL_TOOL_NAMES.map((name) => [toWireToolName(name), name]))
const WIRE_TOOL_NAMES = new Set(CANONICAL_BY_WIRE.keys())

/** Map an effective (wire) tool id back to its canonical `sdd.*` name. */
export function toCanonicalToolName(name: string): string {
  return CANONICAL_BY_WIRE.get(name) ?? name
}

/** True when the id is a Telos tool spelled the way the provider sees it. */
export function isWireToolName(name: string): boolean {
  return WIRE_TOOL_NAMES.has(name)
}

/**
 * Rewrite canonical `sdd.x` references inside prompt/description text to the
 * effective wire spelling, so the model never sees a name that is not
 * registered. Longest names first so a name that prefixes another cannot be
 * partially rewritten.
 */
export function rewriteToolNames(text: string): string {
  return [...ALL_TOOL_NAMES]
    .sort((a, b) => b.length - a.length)
    .reduce((result, canonical) => result.split(canonical).join(toWireToolName(canonical)), text)
}
