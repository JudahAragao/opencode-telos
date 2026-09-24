import { addAuditEntry } from "../permissions/access.js";
/**
 * Adapter used by every interface that exposes AcceptanceService.
 * The service owns the lifecycle event; this adapter only persists it in the
 * project's existing audit store.
 */
export function createAcceptanceAuditSink(projectDir) {
    return {
        record(event) {
            addAuditEntry(projectDir, event.actor, `acceptance.${event.action}`, event.criterion_id, "allowed", JSON.stringify(event));
        },
    };
}
