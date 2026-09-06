/**
 * Progress Event Emitter for SDD Dashboard
 * Emits real-time events during graph build and other operations
 */

export interface ProgressEvent {
  type: "progress" | "step" | "error" | "complete" | "info"
  timestamp: string
  step: string
  message: string
  progress?: number // 0-100
  details?: Record<string, unknown>
}

type EventHandler = (event: ProgressEvent) => void

class ProgressEventEmitter {
  private handlers: Set<EventHandler> = new Set()
  private currentBuild: {
    id: string
    startTime: number
    steps: string[]
    currentStep: number
  } | null = null

  /**
   * Subscribe to progress events
   */
  on(handler: EventHandler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  /**
   * Emit a progress event to all subscribers
   */
  emit(event: Omit<ProgressEvent, "timestamp">): void {
    const fullEvent: ProgressEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    }

    for (const handler of this.handlers) {
      try {
        handler(fullEvent)
      } catch {
        // Handler error should not break the emitter
      }
    }
  }

  /**
   * Start tracking a new build operation
   */
  startBuild(buildId: string, steps: string[]): void {
    this.currentBuild = {
      id: buildId,
      startTime: Date.now(),
      steps,
      currentStep: 0,
    }

    this.emit({
      type: "info",
      step: "build_start",
      message: `Build started: ${buildId}`,
      progress: 0,
      details: { buildId, totalSteps: steps.length },
    })
  }

  /**
   * Report progress on the current build step
   */
  stepProgress(stepName: string, message: string, progress?: number): void {
    this.emit({
      type: "progress",
      step: stepName,
      message,
      progress,
    })
  }

  /**
   * Move to the next step in the build
   */
  nextStep(stepName: string, message: string): void {
    if (this.currentBuild) {
      this.currentBuild.currentStep++
      const progress = Math.round(
        (this.currentBuild.currentStep / this.currentBuild.steps.length) * 100,
      )

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
      })
    } else {
      this.emit({
        type: "step",
        step: stepName,
        message,
      })
    }
  }

  /**
   * Report an error during build
   */
  error(stepName: string, message: string, details?: Record<string, unknown>): void {
    this.emit({
      type: "error",
      step: stepName,
      message,
      details,
    })
  }

  /**
   * Complete the current build
   */
  complete(summary: string, details?: Record<string, unknown>): void {
    const duration = this.currentBuild
      ? Date.now() - this.currentBuild.startTime
      : 0

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
    })

    this.currentBuild = null
  }

  /**
   * Get the number of active subscribers
   */
  getSubscriberCount(): number {
    return this.handlers.size
  }

  /**
   * Check if a build is currently in progress
   */
  isBuilding(): boolean {
    return this.currentBuild !== null
  }

  /**
   * Get current build info
   */
  getCurrentBuild(): { id: string; progress: number; currentStep: string } | null {
    if (!this.currentBuild) return null

    const progress = Math.round(
      (this.currentBuild.currentStep / this.currentBuild.steps.length) * 100,
    )

    return {
      id: this.currentBuild.id,
      progress,
      currentStep: this.currentBuild.steps[this.currentBuild.currentStep] || "unknown",
    }
  }
}

// Singleton instance
export const progressEmitter = new ProgressEventEmitter()
