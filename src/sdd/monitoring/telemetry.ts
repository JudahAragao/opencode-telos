import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"

export interface TelemetryEvent {
  timestamp: string
  name: string
  duration_ms?: number
  tokens_estimate?: number
  cache_hit?: boolean
  metadata?: Record<string, unknown>
}

function eventsPath(projectDir: string): string {
  return join(projectDir, ".sdd", "telemetry.jsonl")
}

/** Local-only telemetry. It never sends project data outside the workspace. */
export function recordTelemetry(projectDir: string, event: Omit<TelemetryEvent, "timestamp">): void {
  const dir = join(projectDir, ".sdd")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const payload: TelemetryEvent = { timestamp: new Date().toISOString(), ...event }
  writeFileSync(eventsPath(projectDir), `${JSON.stringify(payload)}\n`, { encoding: "utf-8", flag: "a" })
}

export function getTelemetrySummary(projectDir: string): {
  events: number; total_duration_ms: number; estimated_tokens: number; cache_hit_rate: number
} {
  const path = eventsPath(projectDir)
  if (!existsSync(path)) return { events: 0, total_duration_ms: 0, estimated_tokens: 0, cache_hit_rate: 0 }
  const events = readFileSync(path, "utf-8").split("\n").flatMap((line) => {
    try { return line ? [JSON.parse(line) as TelemetryEvent] : [] } catch { return [] }
  })
  const cacheEvents = events.filter((event) => typeof event.cache_hit === "boolean")
  return {
    events: events.length,
    total_duration_ms: events.reduce((sum, event) => sum + (event.duration_ms || 0), 0),
    estimated_tokens: events.reduce((sum, event) => sum + (event.tokens_estimate || 0), 0),
    cache_hit_rate: cacheEvents.length ? cacheEvents.filter((event) => event.cache_hit).length / cacheEvents.length : 0,
  }
}

export function recordFeedback(projectDir: string, feedback: Record<string, unknown>): void {
  recordTelemetry(projectDir, { name: "precision_feedback", metadata: feedback })
}
