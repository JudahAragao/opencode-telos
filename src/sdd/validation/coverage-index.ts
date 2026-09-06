import type { KnowledgeGraph, NodeType } from "../domain/types.js"
import { GraphIndices } from "../graph/index.js"
import { getAffectedSubsystems, type SmartValidationResult } from "./smart-validator.js"

/**
 * Represents the verification status of a single subsystem.
 */
export interface SubsystemCoverage {
  subsystem: string
  verified: boolean
  nodes_checked: number
  errors_found: number
  warnings_found: number
  verified_at?: string
  duration_ms?: number
}

/**
 * Overall coverage report for the graph validation.
 */
export interface CoverageReport {
  total_subsystems: number
  verified_count: number
  unverified_count: number
  coverage_percent: number
  subsystems: SubsystemCoverage[]
  last_full_validation?: string
  last_incremental_validation?: string
}

/**
 * A request from the AI to verify a specific area.
 */
export interface VerificationRequest {
  /** Subsystems to verify (empty = auto-detect from dirty nodes). */
  subsystems?: string[]
  /** Specific node IDs to include in verification. */
  nodeIds?: string[]
  /** If true, verify everything regardless of what was already checked. */
  forceFull?: boolean
  /** If true, skip previously verified subsystems. */
  skipVerified?: boolean
  /** Maximum nodes to verify in this request. */
  maxNodes?: number
}

/**
 * ValidationIndex: tracks coverage across validation runs and allows
 * the AI to request verification in specific areas.
 *
 * The AI can:
 * 1. Query what was already verified (getCoverage)
 * 2. Request verification in unchecked areas (requestVerification)
 * 3. Skip previously verified areas (skipVerified option)
 * 4. Get a full coverage report (getCoverageReport)
 */
export class ValidationIndex {
  private coverage: Map<string, SubsystemCoverage> = new Map()
  private lastFullValidation?: string
  private lastIncrementalValidation?: string
  private nodeVerificationHistory: Map<string, Set<string>> = new Map() // subsystem → verified node IDs

  /**
   * Record the result of a validation run.
   */
  recordValidation(result: SmartValidationResult, duration_ms?: number): void {
    const now = new Date().toISOString()

    for (const subsystem of result.subsystems_checked) {
      const existing = this.coverage.get(subsystem)
      const nodesInSubsystem = result.nodes_checked // Approximate

      this.coverage.set(subsystem, {
        subsystem,
        verified: true,
        nodes_checked: nodesInSubsystem,
        errors_found: result.errors.length,
        warnings_found: result.warnings.length,
        verified_at: now,
        duration_ms,
      })
    }

    if (result.subsystems_checked.length >= 14) {
      this.lastFullValidation = now
    } else {
      this.lastIncrementalValidation = now
    }
  }

  /**
   * Record which specific nodes were verified in a subsystem.
   */
  recordNodesVerified(subsystem: string, nodeIds: string[]): void {
    const existing = this.nodeVerificationHistory.get(subsystem) || new Set()
    for (const id of nodeIds) {
      existing.add(id)
    }
    this.nodeVerificationHistory.set(subsystem, existing)
  }

  /**
   * Get the current coverage report.
   */
  getCoverage(): CoverageReport {
    const allSubsystems = [
      "structural", "references", "requirements", "features", "entities",
      "endpoints", "api", "architecture", "cross-layer", "persistence",
      "files", "semantic", "constitution", "completeness",
    ]

    const subsystems: SubsystemCoverage[] = allSubsystems.map(sub => {
      const existing = this.coverage.get(sub)
      return existing || {
        subsystem: sub,
        verified: false,
        nodes_checked: 0,
        errors_found: 0,
        warnings_found: 0,
      }
    })

    const verifiedCount = subsystems.filter(s => s.verified).length

    return {
      total_subsystems: allSubsystems.length,
      verified_count: verifiedCount,
      unverified_count: allSubsystems.length - verifiedCount,
      coverage_percent: Math.round((verifiedCount / allSubsystems.length) * 100),
      subsystems,
      last_full_validation: this.lastFullValidation,
      last_incremental_validation: this.lastIncrementalValidation,
    }
  }

  /**
   * Get subsystems that haven't been verified yet.
   */
  getUnverifiedSubsystems(): string[] {
    const allSubsystems = [
      "structural", "references", "requirements", "features", "entities",
      "endpoints", "api", "architecture", "cross-layer", "persistence",
      "files", "semantic", "constitution", "completeness",
    ]

    return allSubsystems.filter(sub => {
      const coverage = this.coverage.get(sub)
      return !coverage || !coverage.verified
    })
  }

  /**
   * Get subsystems that have been verified.
   */
  getVerifiedSubsystems(): string[] {
    return [...this.coverage.entries()]
      .filter(([_, c]) => c.verified)
      .map(([sub, _]) => sub)
  }

  /**
   * Check if a specific subsystem has been verified.
   */
  isVerified(subsystem: string): boolean {
    const coverage = this.coverage.get(subsystem)
    return coverage?.verified === true
  }

  /**
   * Get the list of node IDs that were verified in a subsystem.
   */
  getVerifiedNodes(subsystem: string): string[] {
    return [...(this.nodeVerificationHistory.get(subsystem) || [])]
  }

  /**
   * Check if specific nodes have been verified in a subsystem.
   */
  areNodesVerified(subsystem: string, nodeIds: string[]): { verified: string[]; unverified: string[] } {
    const verified = this.nodeVerificationHistory.get(subsystem) || new Set()
    return {
      verified: nodeIds.filter(id => verified.has(id)),
      unverified: nodeIds.filter(id => !verified.has(id)),
    }
  }

  /**
   * Build a verification request for unchecked areas.
   * The AI can call this to get a smart request for what to verify next.
   */
  buildVerificationRequest(
    graph: KnowledgeGraph,
    dirtyNodeIds?: Set<string>,
  ): VerificationRequest {
    const unverified = this.getUnverifiedSubsystems()

    if (unverified.length === 0) {
      // Everything verified — suggest a full re-validation
      return { forceFull: true }
    }

    if (dirtyNodeIds && dirtyNodeIds.size > 0) {
      // Use smart detection to find affected subsystems
      const indices = GraphIndices.from(graph)
      const { subsystems: affected } = getAffectedSubsystems(dirtyNodeIds, indices)

      // Filter to only unverified affected subsystems
      const toVerify = [...affected].filter(sub => unverified.includes(sub))

      if (toVerify.length > 0) {
        return { subsystems: toVerify, nodeIds: [...dirtyNodeIds] }
      }
    }

    // No dirty nodes specified — suggest verifying all unverified subsystems
    return { subsystems: unverified, skipVerified: true }
  }

  /**
   * Process a verification request and return the subsystems to validate.
   */
  processVerificationRequest(
    request: VerificationRequest,
    graph: KnowledgeGraph,
    dirtyNodeIds: Set<string>,
  ): { subsystems: string[]; nodeIds: Set<string> } {
    const indices = GraphIndices.from(graph)

    if (request.forceFull) {
      const allSubsystems = [
        "structural", "references", "requirements", "features", "entities",
        "endpoints", "api", "architecture", "cross-layer", "persistence",
        "files", "semantic", "constitution", "completeness",
      ]
      return { subsystems: allSubsystems, nodeIds: new Set(graph.nodes.map(n => n.id)) }
    }

    // Start with auto-detected subsystems
    let targetSubsystems = new Set<string>()
    const { subsystems: autoDetected, nodeIds: autoNodeIds } =
      getAffectedSubsystems(dirtyNodeIds, indices)

    for (const sub of autoDetected) {
      targetSubsystems.add(sub)
    }

    // Add explicitly requested subsystems
    if (request.subsystems) {
      for (const sub of request.subsystems) {
        targetSubsystems.add(sub)
      }
    }

    // Skip verified subsystems if requested
    if (request.skipVerified) {
      for (const sub of this.getVerifiedSubsystems()) {
        targetSubsystems.delete(sub)
      }
    }

    // Add explicitly requested node IDs
    const targetNodeIds = new Set(autoNodeIds)
    if (request.nodeIds) {
      for (const id of request.nodeIds) {
        targetNodeIds.add(id)
      }
    }

    // Apply max nodes limit
    if (request.maxNodes && targetNodeIds.size > request.maxNodes) {
      const arr = [...targetNodeIds].slice(0, request.maxNodes)
      return { subsystems: [...targetSubsystems], nodeIds: new Set(arr) }
    }

    return { subsystems: [...targetSubsystems], nodeIds: targetNodeIds }
  }

  /**
   * Reset coverage for a specific subsystem (force re-verification).
   */
  resetSubsystem(subsystem: string): void {
    this.coverage.delete(subsystem)
    this.nodeVerificationHistory.delete(subsystem)
  }

  /**
   * Reset all coverage (full re-verification needed).
   */
  resetAll(): void {
    this.coverage.clear()
    this.nodeVerificationHistory.clear()
    this.lastFullValidation = undefined
    this.lastIncrementalValidation = undefined
  }

  /**
   * Format a human-readable coverage report.
   */
  formatCoverageReport(): string {
    const report = this.getCoverage()
    const lines: string[] = []

    lines.push(`## Validation Coverage: ${report.coverage_percent}%\n`)
    lines.push(`**Verified:** ${report.verified_count}/${report.total_subsystems} subsystems`)
    lines.push(`**Unverified:** ${report.unverified_count}/${report.total_subsystems} subsystems\n`)

    if (report.last_full_validation) {
      lines.push(`**Last full validation:** ${report.last_full_validation}`)
    }
    if (report.last_incremental_validation) {
      lines.push(`**Last incremental validation:** ${report.last_incremental_validation}`)
    }
    lines.push("")

    // Verified subsystems
    const verified = report.subsystems.filter(s => s.verified)
    if (verified.length > 0) {
      lines.push("### ✅ Verified")
      for (const s of verified) {
        const time = s.verified_at ? ` (${s.verified_at})` : ""
        const errs = s.errors_found > 0 ? ` ⚠️ ${s.errors_found} errors` : ""
        lines.push(`- **${s.subsystem}**${time}${errs}`)
      }
      lines.push("")
    }

    // Unverified subsystems
    const unverified = report.subsystems.filter(s => !s.verified)
    if (unverified.length > 0) {
      lines.push("### ❌ Unverified")
      for (const s of unverified) {
        lines.push(`- **${s.subsystem}** — not yet checked`)
      }
      lines.push("")
    }

    return lines.join("\n")
  }
}
