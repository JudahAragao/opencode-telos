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
import { createHash } from "crypto"

/**
 * Submit a prompt to a session without blocking the caller.
 *
 * Each host SDK reaches the session differently — V1 exposes
 * `client.session.promptAsync({ path, body })`, V2 exposes
 * `ctx.session.prompt({ sessionID, text })` — so the bridge stores this
 * capability as a plain function instead of a client object. The returned
 * promise is optional: some hosts answer synchronously.
 */
export type DashboardPromptSubmitter = (
  sessionID: string,
  text: string,
) => Promise<unknown> | unknown

interface DashboardBridge {
  submit: DashboardPromptSubmitter | null
  lastSessionID: string | null
  sessionsByProject: Map<string, string>
  jobs: Map<string, IntegrationJob>
}

interface IntegrationJob {
  id: string
  key: string
  label: string
  status: "queued" | "submitted" | "completed" | "failed"
  createdAt: string
  updatedAt: string
  error?: string
}

const bridge: DashboardBridge = {
  submit: null,
  lastSessionID: null,
  sessionsByProject: new Map(),
  jobs: new Map(),
}

/** Register the host prompt bridge once, at plugin init. */
export function registerDashboardAgentClient(submit: DashboardPromptSubmitter | null | undefined): void {
  bridge.submit = typeof submit === "function" ? submit : null
}

/**
 * Adapt a V1 OpenCode SDK client to the bridge.
 *
 * V1 exposes `session.promptAsync({ path: { id }, body: { parts } })`; this
 * keeps that call shape in one place instead of at every call site.
 */
export function registerDashboardClientV1(client: unknown): void {
  const promptAsync = (
    client as { session?: { promptAsync?: (options: unknown) => unknown } } | null | undefined
  )?.session?.promptAsync
  if (typeof promptAsync !== "function") {
    registerDashboardAgentClient(null)
    return
  }
  registerDashboardAgentClient((sessionID, text) =>
    promptAsync.call((client as { session: unknown }).session, {
      path: { id: sessionID },
      body: { parts: [{ type: "text", text }] },
    }),
  )
}

/** Record the session currently driving an LLM turn. */
export function setDashboardSessionID(sessionID: string | undefined | null, projectDir?: string): void {
  if (typeof sessionID === "string" && sessionID.trim().length > 0) {
    bridge.lastSessionID = sessionID
    if (projectDir) bridge.sessionsByProject.set(projectDir, sessionID)
  }
}

export function getDashboardSessionID(projectDir?: string): string | null {
  return (projectDir ? bridge.sessionsByProject.get(projectDir) : undefined) || bridge.lastSessionID
}

export function hasDashboardAgent(): boolean {
  return bridge.submit !== null && bridge.lastSessionID !== null
}

export interface IntegrationRequestResult {
  queued: boolean
  reason: string
  job_id?: string
  status?: IntegrationJob["status"]
}

/**
 * Ask the active OpenCode session to run a turn with `prompt`. Never throws:
 * a failure just falls back to the tool-based (deterministic) path.
 */
export function requestAgentTurn(
  prompt: string,
  label: string,
  options: { projectDir?: string; dedupeKey?: string } = {},
): IntegrationRequestResult {
  const key = options.dedupeKey || createHash("sha256").update(`${options.projectDir || ""}\n${label}\n${prompt}`).digest("hex")
  const existing = bridge.jobs.get(key)
  if (existing && (existing.status === "queued" || existing.status === "submitted")) {
    return { queued: true, reason: `A ${label} request is already in progress.`, job_id: existing.id, status: existing.status }
  }
  const submit = bridge.submit
  if (!submit) {
    return {
      queued: false,
      reason: `No OpenCode client available; ${label} stays queued for the agent tools.`,
    }
  }

  const sessionID = getDashboardSessionID(options.projectDir)
  if (!sessionID) {
    return {
      queued: false,
      reason: `No active session; ${label} stays queued for the agent tools.`,
    }
  }

  try {
    const job: IntegrationJob = {
      id: `JOB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      key,
      label,
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    bridge.jobs.set(key, job)
    const result = submit(sessionID, prompt) as Promise<unknown> | undefined

    job.status = "submitted"
    job.updatedAt = new Date().toISOString()
    // Fire-and-forget: the HTTP response must not wait on the agent turn.
    if (result && typeof (result as Promise<unknown>).then === "function") {
      ;(result as Promise<unknown>).then(
        () => {
          job.status = "completed"
          job.updatedAt = new Date().toISOString()
        },
        (error: unknown) => {
          job.status = "failed"
          job.error = error instanceof Error ? error.message : String(error)
          job.updatedAt = new Date().toISOString()
          sddDebug("dashboard", `${label} prompt failed: ${String(error)}`)
        },
      )
    }

    return { queued: true, reason: `Integration requested in session ${sessionID}.`, job_id: job.id, status: job.status }
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
export function getDashboardJob(jobId: string): IntegrationJob | null {
  return [...bridge.jobs.values()].find((job) => job.id === jobId) || null
}

export function requestTaskIntegration(taskId: string, name: string, projectDir?: string): IntegrationRequestResult {
  return requestAgentTurn(buildTaskIntegrationPrompt(taskId, name), "task integration", {
    projectDir,
    dedupeKey: `${projectDir || ""}:task:${taskId}`,
  })
}
