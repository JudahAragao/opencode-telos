/**
 * Progress Event Emitter for SDD Dashboard
 * Emits real-time events during graph build and other operations
 */
class ProgressEventEmitter {
    handlers = new Set();
    currentBuild = null;
    /**
     * Subscribe to progress events
     */
    on(handler) {
        this.handlers.add(handler);
        return () => {
            this.handlers.delete(handler);
        };
    }
    /**
     * Emit a progress event to all subscribers
     */
    emit(event) {
        const fullEvent = {
            ...event,
            timestamp: new Date().toISOString(),
        };
        for (const handler of this.handlers) {
            try {
                handler(fullEvent);
            }
            catch {
                // Handler error should not break the emitter
            }
        }
    }
    /**
     * Start tracking a new build operation
     */
    startBuild(buildId, steps) {
        this.currentBuild = {
            id: buildId,
            startTime: Date.now(),
            steps,
            currentStep: 0,
        };
        this.emit({
            type: "info",
            step: "build_start",
            message: `Build started: ${buildId}`,
            progress: 0,
            details: { buildId, totalSteps: steps.length },
        });
    }
    /**
     * Report progress on the current build step
     */
    stepProgress(stepName, message, progress) {
        this.emit({
            type: "progress",
            step: stepName,
            message,
            progress,
        });
    }
    /**
     * Move to the next step in the build
     */
    nextStep(stepName, message) {
        if (this.currentBuild) {
            this.currentBuild.currentStep++;
            const progress = Math.round((this.currentBuild.currentStep / this.currentBuild.steps.length) * 100);
            this.emit({
                type: "step",
                step: stepName,
                message,
                progress,
                details: {
                    buildId: this.currentBuild.id,
                    stepIndex: this.currentBuild.currentStep,
                    totalSteps: this.currentBuild.steps.length,
                },
            });
        }
        else {
            this.emit({
                type: "step",
                step: stepName,
                message,
            });
        }
    }
    /**
     * Report an error during build
     */
    error(stepName, message, details) {
        this.emit({
            type: "error",
            step: stepName,
            message,
            details,
        });
    }
    /**
     * Complete the current build
     */
    complete(summary, details) {
        const duration = this.currentBuild
            ? Date.now() - this.currentBuild.startTime
            : 0;
        this.emit({
            type: "complete",
            step: "build_complete",
            message: summary,
            progress: 100,
            details: {
                ...details,
                durationMs: duration,
                buildId: this.currentBuild?.id,
            },
        });
        this.currentBuild = null;
    }
    /**
     * Get the number of active subscribers
     */
    getSubscriberCount() {
        return this.handlers.size;
    }
    /**
     * Check if a build is currently in progress
     */
    isBuilding() {
        return this.currentBuild !== null;
    }
    /**
     * Get current build info
     */
    getCurrentBuild() {
        if (!this.currentBuild)
            return null;
        const progress = Math.round((this.currentBuild.currentStep / this.currentBuild.steps.length) * 100);
        return {
            id: this.currentBuild.id,
            progress,
            currentStep: this.currentBuild.steps[this.currentBuild.currentStep] || "unknown",
        };
    }
}
// Singleton instance
export const progressEmitter = new ProgressEventEmitter();
