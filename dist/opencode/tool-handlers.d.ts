/**
 * Internal handler functions for deprecated tools.
 *
 * These functions contain the business logic that was previously wrapped in
 * ToolDefinition objects. They are now called directly by composite tools
 * (tools-composite.ts) instead of being exposed as standalone tools.
 *
 * This file is the ONLY place where this logic lives. The deprecated tool
 * entries have been removed from tools.ts.
 */
type HandlerCtx = {
    directory: string;
};
export declare function savePermissionsConfigHandler(args: Record<string, any>, ctx: HandlerCtx): Promise<string>;
export declare function listSnapshotsHandler(_args: Record<string, any>, ctx: HandlerCtx): Promise<string>;
export declare function verifyUsageHandler(_args: Record<string, any>, ctx: HandlerCtx): Promise<string>;
export declare function findDeadCodeHandler(args: Record<string, any>, ctx: HandlerCtx): Promise<string>;
export declare function removeDeadCodeHandler(args: Record<string, any>, ctx: HandlerCtx): Promise<string>;
export declare function planImplementationHandler(args: Record<string, any>, ctx: HandlerCtx): Promise<string>;
export declare function analyzeCodebaseHandler(_args: Record<string, any>, ctx: HandlerCtx): Promise<string>;
export declare function createMigrationHandler(args: Record<string, any>, ctx: HandlerCtx): Promise<string>;
export declare function createExperimentHandler(args: Record<string, any>, ctx: HandlerCtx): Promise<string>;
export declare function createFlagHandler(args: Record<string, any>, ctx: HandlerCtx): Promise<string>;
export declare function createTenantHandler(args: Record<string, any>, ctx: HandlerCtx): Promise<string>;
export declare function generateDashboardHandler(args: Record<string, any>, ctx: HandlerCtx): Promise<string>;
export declare function reportIncidentHandler(args: Record<string, any>, ctx: HandlerCtx): Promise<string>;
export declare function createSlaHandler(args: Record<string, any>, ctx: HandlerCtx): Promise<string>;
export declare function estimateCostHandler(_args: Record<string, any>, ctx: HandlerCtx): Promise<string>;
export declare function knowledgeTransferHandler(_args: Record<string, any>, ctx: HandlerCtx): Promise<string>;
export declare function disasterRecoveryPlanHandler(_args: Record<string, any>, ctx: HandlerCtx): Promise<string>;
export declare function configDriftHandler(_args: Record<string, any>, ctx: HandlerCtx): Promise<string>;
export declare function workflowExportHandler(_args: Record<string, any>, ctx: HandlerCtx): Promise<string>;
export {};
