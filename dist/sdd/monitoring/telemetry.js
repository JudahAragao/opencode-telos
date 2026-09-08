import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
function eventsPath(projectDir) {
    return join(projectDir, ".sdd", "telemetry.jsonl");
}
/** Local-only telemetry. It never sends project data outside the workspace. */
export function recordTelemetry(projectDir, event) {
    const dir = join(projectDir, ".sdd");
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    const payload = { timestamp: new Date().toISOString(), ...event };
    // O_APPEND makes each JSONL record append atomically for concurrent writers.
    appendFileSync(eventsPath(projectDir), `${JSON.stringify(payload)}\n`, { encoding: "utf-8" });
}
export function getTelemetrySummary(projectDir) {
    const path = eventsPath(projectDir);
    if (!existsSync(path))
        return { events: 0, total_duration_ms: 0, estimated_tokens: 0, cache_hit_rate: 0 };
    const events = readFileSync(path, "utf-8").split("\n").flatMap((line) => {
        try {
            return line ? [JSON.parse(line)] : [];
        }
        catch {
            return [];
        }
    });
    const cacheEvents = events.filter((event) => typeof event.cache_hit === "boolean");
    return {
        events: events.length,
        total_duration_ms: events.reduce((sum, event) => sum + (event.duration_ms || 0), 0),
        estimated_tokens: events.reduce((sum, event) => sum + (event.tokens_estimate || 0), 0),
        cache_hit_rate: cacheEvents.length ? cacheEvents.filter((event) => event.cache_hit).length / cacheEvents.length : 0,
    };
}
export function recordFeedback(projectDir, feedback) {
    recordTelemetry(projectDir, { name: "precision_feedback", metadata: feedback });
}
