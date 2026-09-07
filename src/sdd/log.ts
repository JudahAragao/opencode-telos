/**
 * Lightweight debug logger for the SDD system.
 *
 * Enable by setting SDD_DEBUG=1 or SDD_DEBUG=true in the environment.
 * All output goes to stderr so it never contaminates tool output.
 */

const enabled = process.env.SDD_DEBUG === "1" || process.env.SDD_DEBUG === "true"

export function sddDebug(component: string, message: string, details?: unknown): void {
  if (!enabled) return
  const suffix = details !== undefined ? ` ${JSON.stringify(details)}` : ""
  process.stderr.write(`[sdd:${component}] ${message}${suffix}\n`)
}

export function sddWarn(component: string, message: string, details?: unknown): void {
  const suffix = details !== undefined ? ` ${JSON.stringify(details)}` : ""
  process.stderr.write(`[sdd:${component}] WARNING ${message}${suffix}\n`)
}

export function sddError(component: string, message: string, error?: unknown): void {
  const suffix = error instanceof Error ? ` ${error.message}` : error !== undefined ? ` ${String(error)}` : ""
  process.stderr.write(`[sdd:${component}] ERROR ${message}${suffix}\n`)
}
