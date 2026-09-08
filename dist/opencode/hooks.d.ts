import type { Hooks } from "@opencode-ai/plugin";
/**
 * Detect if a shell command attempts to write source code files.
 * Returns extracted file paths that match source patterns.
 * Exported for testing.
 */
export declare function detectShellFileWrites(command: string): string[];
export declare function createSddHooks(projectDir: string): Hooks;
