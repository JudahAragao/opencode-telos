export interface TelemetryEvent {
    timestamp: string;
    name: string;
    duration_ms?: number;
    tokens_estimate?: number;
    cache_hit?: boolean;
    metadata?: Record<string, unknown>;
}
/** Local-only telemetry. It never sends project data outside the workspace. */
export declare function recordTelemetry(projectDir: string, event: Omit<TelemetryEvent, "timestamp">): void;
export declare function getTelemetrySummary(projectDir: string): {
    events: number;
    total_duration_ms: number;
    estimated_tokens: number;
    cache_hit_rate: number;
};
export declare function recordFeedback(projectDir: string, feedback: Record<string, unknown>): void;
