/**
 * Dashboard ↔ agent bridge.
 *
 * The dashboard is an in-process HTTP server with no LLM of its own. To make
 * "save a card → the AI integrates it into the SDD" work, the plugin registers
 * the OpenCode SDK client here and hooks record the active session id. The
 * server can then ask the agent to run `sdd.integrate_tasks` in that session.
 *
 * This is best-effort by design: when there is no client or no session, the
 * task simply stays flagged as `integration_status: "pending"` and the agent
 * picks it up on the next turn (system prompt) or via the `sdd.integrate_tasks`
 * tool. Nothing here ever writes to the graph directly.
 */
interface IntegrationJob {
    id: string;
    key: string;
    label: string;
    status: "queued" | "submitted" | "completed" | "failed";
    createdAt: string;
    updatedAt: string;
    error?: string;
}
/** Register the OpenCode client once, at plugin init. */
export declare function registerDashboardAgentClient(client: unknown): void;
/** Record the session currently driving an LLM turn. */
export declare function setDashboardSessionID(sessionID: string | undefined | null, projectDir?: string): void;
export declare function getDashboardSessionID(projectDir?: string): string | null;
export declare function hasDashboardAgent(): boolean;
export interface IntegrationRequestResult {
    queued: boolean;
    reason: string;
    job_id?: string;
    status?: IntegrationJob["status"];
}
/**
 * Ask the active OpenCode session to run a turn with `prompt`. Never throws:
 * a failure just falls back to the tool-based (deterministic) path.
 */
export declare function requestAgentTurn(prompt: string, label: string, options?: {
    projectDir?: string;
    dedupeKey?: string;
}): IntegrationRequestResult;
/**
 * Ask the active OpenCode session to integrate a task into the SDD.
 */
export declare function getDashboardJob(jobId: string): IntegrationJob | null;
export declare function requestTaskIntegration(taskId: string, name: string, projectDir?: string): IntegrationRequestResult;
export {};
