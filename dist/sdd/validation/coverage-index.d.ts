import type { KnowledgeGraph } from "../domain/types.js";
import { type SmartValidationResult } from "./smart-validator.js";
/**
 * Represents the verification status of a single subsystem.
 */
export interface SubsystemCoverage {
    subsystem: string;
    verified: boolean;
    nodes_checked: number;
    errors_found: number;
    warnings_found: number;
    verified_at?: string;
    duration_ms?: number;
}
/**
 * Overall coverage report for the graph validation.
 */
export interface CoverageReport {
    total_subsystems: number;
    verified_count: number;
    unverified_count: number;
    coverage_percent: number;
    subsystems: SubsystemCoverage[];
    last_full_validation?: string;
    last_incremental_validation?: string;
}
/**
 * A request from the AI to verify a specific area.
 */
export interface VerificationRequest {
    /** Subsystems to verify (empty = auto-detect from dirty nodes). */
    subsystems?: string[];
    /** Specific node IDs to include in verification. */
    nodeIds?: string[];
    /** If true, verify everything regardless of what was already checked. */
    forceFull?: boolean;
    /** If true, skip previously verified subsystems. */
    skipVerified?: boolean;
    /** Maximum nodes to verify in this request. */
    maxNodes?: number;
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
export declare class ValidationIndex {
    private coverage;
    private lastFullValidation?;
    private lastIncrementalValidation?;
    private nodeVerificationHistory;
    /**
     * Record the result of a validation run.
     */
    recordValidation(result: SmartValidationResult, duration_ms?: number): void;
    /**
     * Record which specific nodes were verified in a subsystem.
     */
    recordNodesVerified(subsystem: string, nodeIds: string[]): void;
    /**
     * Get the current coverage report.
     */
    getCoverage(): CoverageReport;
    /**
     * Get subsystems that haven't been verified yet.
     */
    getUnverifiedSubsystems(): string[];
    /**
     * Get subsystems that have been verified.
     */
    getVerifiedSubsystems(): string[];
    /**
     * Check if a specific subsystem has been verified.
     */
    isVerified(subsystem: string): boolean;
    /**
     * Get the list of node IDs that were verified in a subsystem.
     */
    getVerifiedNodes(subsystem: string): string[];
    /**
     * Check if specific nodes have been verified in a subsystem.
     */
    areNodesVerified(subsystem: string, nodeIds: string[]): {
        verified: string[];
        unverified: string[];
    };
    /**
     * Build a verification request for unchecked areas.
     * The AI can call this to get a smart request for what to verify next.
     */
    buildVerificationRequest(graph: KnowledgeGraph, dirtyNodeIds?: Set<string>): VerificationRequest;
    /**
     * Process a verification request and return the subsystems to validate.
     */
    processVerificationRequest(request: VerificationRequest, graph: KnowledgeGraph, dirtyNodeIds: Set<string>): {
        subsystems: string[];
        nodeIds: Set<string>;
    };
    /**
     * Reset coverage for a specific subsystem (force re-verification).
     */
    resetSubsystem(subsystem: string): void;
    /**
     * Reset all coverage (full re-verification needed).
     */
    resetAll(): void;
    /**
     * Format a human-readable coverage report.
     */
    formatCoverageReport(): string;
}
