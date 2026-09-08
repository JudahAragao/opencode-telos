import { type ToolDefinition } from "@opencode-ai/plugin";
/**
 * Invalidate cache for specific node types after a mutation.
 */
export declare function invalidateCacheForMutation(directory: string, nodeTypes: string[], relTypes?: string[]): void;
export declare const invalidateCache: typeof invalidateCacheForMutation;
export declare function createSddTools(): Record<string, ToolDefinition>;
