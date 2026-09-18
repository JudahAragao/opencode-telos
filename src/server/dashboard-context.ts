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

import { buildTaskIntegrationPrompt } from "../sdd/tasks/board.js"
import { sddDebug } from "../sdd/log.js"

/** Minimal structural type for the OpenCode SDK client (avoids a hard dep). */
interface OpenCodeSessionClient {
  session?: {
    promptAsync?: (options: {
      path: { id: string }
      body: { parts: Array<{ type: "text"; text: string }> }
    }) => unknown
  }
}

interface DashboardBridge {
  client: OpenCodeSessionClient | null
  lastSessionID: string | null
}

const bridge: DashboardBridge = {
  client: null,
  lastSessionID: null,
}

/** Register the OpenCode client once, at plugin init. */
export function registerDashboardAgentClient(client: unknown): void {
  bridge.client = (client as OpenCodeSessionClient) ?? null
}

/** Record the session currently driving an LLM turn. */
export function setDashboardSessionID(sessionID: string | undefined | null): void {
  if (typeof sessionID === "string" && sessionID.trim().length > 0) {
    bridge.lastSessionID = sessionID
  }
}

export function getDashboardSessionID(): string | null {
  return bridge.lastSessionID
}

export function hasDashboardAgent(): boolean {
  return bridge.client !== null && bridge.lastSessionID !== null
}

export interface IntegrationRequestResult {
  queued: boolean
  reason: string
}

/**
 * Ask the active OpenCode session to run a turn with `prompt`. Never throws:
 * a failure just falls back to the tool-based (deterministic) path.
 */
export function requestAgentTurn(prompt: string, label: string): IntegrationRequestResult {
  const client = bridge.client
  if (!client?.session?.promptAsync) {
    return {
      queued: false,
      reason: `No OpenCode client available; ${label} stays queued for the agent tools.`,
    }
  }

  const sessionID = bridge.lastSessionID
  if (!sessionID) {
    return {
      queued: false,
      reason: `No active session; ${label} stays queued for the agent tools.`,
    }
  }

  try {
    const result = client.session.promptAsync({
      path: { id: sessionID },
      body: { parts: [{ type: "text", text: prompt }] },
    }) as Promise<unknown> | undefined

    // Fire-and-forget: the HTTP response must not wait on the agent turn.
    if (result && typeof (result as Promise<unknown>).then === "function") {
      ;(result as Promise<unknown>).then(
        () => {},
        (error: unknown) => {
          sddDebug("dashboard", `${label} prompt failed: ${String(error)}`)
        },
      )
    }

    return { queued: true, reason: `Integration requested in session ${sessionID}.` }
  } catch (error) {
    return {
      queued: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Ask the active OpenCode session to integrate a task into the SDD.
 */
export function requestTaskIntegration(taskId: string, name: string): IntegrationRequestResult {
  return requestAgentTurn(buildTaskIntegrationPrompt(taskId, name), "task integration")
}
