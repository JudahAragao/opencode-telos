import { existsSync } from "fs"
import { resolve, sep } from "path"
import { sddDebug } from "./log.js"

/**
 * Resolve the correct project directory from the plugin context.
 *
 * OpenCode may pass directory = "/" when the plugin is installed globally
 * or loaded from a path unrelated to the active workspace. This helper
 * detects that situation and falls back to worktree, then process.cwd(),
 * and finally validates that the result is a real directory that is not
 * the filesystem root.
 */
export function resolveProjectDir(
  ctxDirectory: string,
  ctxWorktree?: string,
): string {
  const candidates = [
    ctxDirectory,
    ctxWorktree,
  ].filter((d): d is string => typeof d === "string" && d.length > 0)

  for (const candidate of candidates) {
    const resolved = resolve(candidate)
    // Reject filesystem root – plugins loaded globally often get "/" here
    if (resolved === sep) continue
    if (existsSync(resolved)) {
      sddDebug("project-dir", `Resolved project directory: ${resolved}`)
      return resolved
    }
  }

  // Last resort: process.cwd(), but never return root
  const cwd = process.cwd()
  if (cwd !== sep) {
    sddDebug("project-dir", `Falling back to process.cwd(): ${cwd}`)
    return cwd
  }

  // If everything fails, return the original ctxDirectory and let the
  // caller deal with the likely broken path. Logging a warning first.
  const fallback = ctxDirectory || "."
  sddDebug(
    "project-dir",
    `WARNING: Could not resolve a valid project directory. Using: ${fallback}`,
  )
  return fallback
}
