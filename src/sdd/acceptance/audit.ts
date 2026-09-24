import { addAuditEntry } from "../permissions/access.js"
import type { AcceptanceAuditEvent } from "./service.js"

/**
 * Adapter used by every interface that exposes AcceptanceService.
 * The service owns the lifecycle event; this adapter only persists it in the
 * project's existing audit store.
 */
export function createAcceptanceAuditSink(projectDir: string) {
  return {
    record(event: AcceptanceAuditEvent): void {
      addAuditEntry(
        projectDir,
        event.actor,
        `acceptance.${event.action}`,
        event.criterion_id,
        "allowed",
        JSON.stringify(event),
      )
    },
  }
}
