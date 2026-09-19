import { type ToolDefinition } from "@opencode-ai/plugin";
/** Call after any operation that changes the active storage backend. */
export declare function invalidateCachedRepo(directory: string): void;
/**
 * Invalidate cache for specific node types after a mutation.
 */
export declare function invalidateCacheForMutation(directory: string, nodeTypes: string[], relTypes?: string[]): void;
export declare const invalidateCache: typeof invalidateCacheForMutation;
export declare function createSddTools(): Record<string, ToolDefinition>;
