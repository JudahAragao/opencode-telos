/**
 * Progress Event Emitter for SDD Dashboard
 * Emits real-time events during graph build and other operations
 */
class ProgressEventEmitter {
    handlers = new Set();
    builds = new Map();
    activeBuildId = null;
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
        const build = {
            id: buildId,
            startTime: Date.now(),
            steps,
            currentStep: 0,
        };
        this.builds.set(buildId, build);
        this.activeBuildId = buildId;
        this.currentBuild = build;
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
    stepProgress(stepName, message, progress, buildId) {
        const build = buildId ? this.builds.get(buildId) : this.currentBuild;
        this.emit({
            type: "progress",
            step: stepName,
            message,
            progress,
            details: build ? { buildId: build.id } : undefined,
        });
    }
    /**
     * Move to the next step in the build
     */
    nextStep(stepName, message, buildId) {
        const build = buildId ? this.builds.get(buildId) : this.currentBuild;
        if (build) {
            build.currentStep++;
            const progress = Math.round((build.currentStep / build.steps.length) * 100);
            this.emit({
                type: "step",
                step: stepName,
                message,
                progress,
                details: {
                    buildId: build.id,
                    stepIndex: build.currentStep,
                    totalSteps: build.steps.length,
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
    error(stepName, message, details, buildId) {
        this.emit({
            type: "error",
            step: stepName,
            message,
            details: buildId ? { ...details, buildId } : details,
        });
    }
    /**
     * Complete the current build
     */
    complete(summary, details, buildId) {
        const build = buildId ? this.builds.get(buildId) : this.currentBuild;
        const duration = build
            ? Date.now() - build.startTime
            : 0;
        this.emit({
            type: "complete",
            step: "build_complete",
            message: summary,
            progress: 100,
            details: {
                ...details,
                durationMs: duration,
                buildId: build?.id,
            },
        });
        if (build)
            this.builds.delete(build.id);
        if (this.activeBuildId === build?.id) {
            this.activeBuildId = null;
            this.currentBuild = null;
        }
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
        return this.builds.size > 0;
    }
    /**
     * Get current build info
     */
    getCurrentBuild() {
        const build = this.currentBuild;
        if (!build)
            return null;
        const progress = Math.round((build.currentStep / build.steps.length) * 100);
        return {
            id: build.id,
            progress,
            currentStep: build.steps[build.currentStep] || "unknown",
        };
    }
}
// Singleton instance
export const progressEmitter = new ProgressEventEmitter();
