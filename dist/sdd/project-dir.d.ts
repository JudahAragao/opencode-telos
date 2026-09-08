/**
 * Resolve the correct project directory from the plugin context.
 *
 * OpenCode may pass directory = "/" when the plugin is installed globally
 * or loaded from a path unrelated to the active workspace. This helper
 * detects that situation and falls back to worktree, then process.cwd(),
 * and finally validates that the result is a real directory that is not
 * the filesystem root.
 */
export declare function resolveProjectDir(ctxDirectory: string, ctxWorktree?: string): string;
