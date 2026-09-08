/**
 * Composite Tools — Tools compostas que substituem múltiplas tools originais.
 *
 * Cada tool composta aceita um parâmetro `action` e delega para a lógica
 * correspondente nos módulos SDD. As tools originais são mantidas como
 * deprecated por compatibilidade.
 *
 * Consumido por: createSddTools() em tools.ts
 */
import { type ToolDefinition } from "@opencode-ai/plugin";
export declare function createGraphMutationTool(): ToolDefinition;
export declare function createGraphQueryTool(): ToolDefinition;
export declare function createTraverseTool(): ToolDefinition;
export declare function createPermissionsTool(): ToolDefinition;
export declare function createSnapshotTool(): ToolDefinition;
export declare function createSyncTool(): ToolDefinition;
export declare function createGraphAdminTool(): ToolDefinition;
export declare function createCodeQualityTool(): ToolDefinition;
export declare function createEnterpriseTool(): ToolDefinition;
export declare function createDriftWhitelistTool(): ToolDefinition;
