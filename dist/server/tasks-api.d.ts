/**
 * HTTP layer for the Kanban task API exposed by the dashboard server.
 *
 * Validation lives here (zod) and persistence goes through the same repository
 * used by the SDD tools, so `.sdd/` stays the single source of truth. Mutations
 * only ever touch the graph — they never write source files, which is why the
 * write hook does not need to intervene.
 */
export interface TasksApiResult {
    status: number;
    body: unknown;
}
export declare function handleListTasks(projectDir: string, query?: Record<string, string>): TasksApiResult;
export declare function handleCreateTask(projectDir: string, raw: unknown): TasksApiResult;
export declare function handleUpdateTask(projectDir: string, id: string, raw: unknown): TasksApiResult;
export declare function handleDeleteTask(projectDir: string, id: string): TasksApiResult;
export declare function handleIntegrateTask(projectDir: string, id: string): TasksApiResult;
/**
 * Open (or return) the SDD Change that authorizes the code of a task.
 *
 * When the Change ends up APPROVED the agent is asked to implement it — the
 * dashboard never writes source code itself.
 */
export declare function handleOpenChange(projectDir: string, id: string, raw: unknown): TasksApiResult;
/** Mark a task as integrated (called by the agent tool once it is done). */
export declare function handleMarkIntegrated(projectDir: string, id: string): TasksApiResult;
