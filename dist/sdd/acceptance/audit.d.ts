import type { AcceptanceAuditEvent } from "./service.js";
/**
 * Adapter used by every interface that exposes AcceptanceService.
 * The service owns the lifecycle event; this adapter only persists it in the
 * project's existing audit store.
 */
export declare function createAcceptanceAuditSink(projectDir: string): {
    record(event: AcceptanceAuditEvent): void;
};
