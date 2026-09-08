/**
 * Progress Event Emitter for SDD Dashboard
 * Emits real-time events during graph build and other operations
 */
export interface ProgressEvent {
    type: "progress" | "step" | "error" | "complete" | "info";
    timestamp: string;
    step: string;
    message: string;
    progress?: number;
    details?: Record<string, unknown>;
}
type EventHandler = (event: ProgressEvent) => void;
declare class ProgressEventEmitter {
    private handlers;
    private currentBuild;
    /**
     * Subscribe to progress events
     */
    on(handler: EventHandler): () => void;
    /**
     * Emit a progress event to all subscribers
     */
    emit(event: Omit<ProgressEvent, "timestamp">): void;
    /**
     * Start tracking a new build operation
     */
    startBuild(buildId: string, steps: string[]): void;
    /**
     * Report progress on the current build step
     */
    stepProgress(stepName: string, message: string, progress?: number): void;
    /**
     * Move to the next step in the build
     */
    nextStep(stepName: string, message: string): void;
    /**
     * Report an error during build
     */
    error(stepName: string, message: string, details?: Record<string, unknown>): void;
    /**
     * Complete the current build
     */
    complete(summary: string, details?: Record<string, unknown>): void;
    /**
     * Get the number of active subscribers
     */
    getSubscriberCount(): number;
    /**
     * Check if a build is currently in progress
     */
    isBuilding(): boolean;
    /**
     * Get current build info
     */
    getCurrentBuild(): {
        id: string;
        progress: number;
        currentStep: string;
    } | null;
}
export declare const progressEmitter: ProgressEventEmitter;
export {};
