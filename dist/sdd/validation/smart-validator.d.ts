import type { KnowledgeGraph } from "../domain/types.js";
import { GraphIndices } from "../graph/index.js";
import { type ValidationResult, type ValidationPolicy } from "./validator.js";
import { ValidationIndex } from "./coverage-index.js";
/**
 * Which validation subsystems exist and what they check.
 */
type ValidationSubsystem = "requirements" | "features" | "entities" | "endpoints" | "api" | "architecture" | "cross-layer" | "persistence" | "files" | "semantic" | "constitution" | "completeness" | "structural" | "references";
/**
 * Smart validation result with subsystem breakdown.
 */
export interface SmartValidationResult extends ValidationResult {
    subsystems_checked: string[];
    subsystems_skipped: string[];
    nodes_checked: number;
    nodes_skipped: number;
}
/**
 * Options for controlling smart validation scope.
 * The AI can use these to request additional subsystems or exclude specific ones.
 */
export interface SmartValidationOptions {
    /** Project directory used to verify persisted graph integrity. */
    projectDir?: string;
    /** Additional subsystems to validate beyond what was automatically detected. */
    additionalSubsystems?: ValidationSubsystem[];
    /** Subsystems to skip even if they were automatically detected. */
    excludeSubsystems?: ValidationSubsystem[];
    /** If true, validate ALL subsystems (ignore auto-detection). */
    validateAll?: boolean;
    /** Maximum number of subsystems to validate (safety limit). */
    maxSubsystems?: number;
    /** Shared validation index for coverage tracking across runs. */
    coverageIndex?: ValidationIndex;
    /** Skip subsystems already verified in the coverage index. */
    skipVerified?: boolean;
    /** Project-level severity policy for semantic validation. */
    policy?: ValidationPolicy;
}
/**
 * Determine which subsystems are affected by a set of changed nodes.
 */
export declare function getAffectedSubsystems(dirtyNodeIds: Set<string>, indices: GraphIndices): {
    subsystems: Set<ValidationSubsystem>;
    nodeIds: Set<string>;
};
/**
 * Smart validation: only checks subsystems affected by the changed nodes.
 * Falls back to full validation if >50% of subsystems are affected.
 *
 * Uses GraphIndices for O(1) node lookups instead of O(n) array scans.
 */
export declare function validateSmart(graph: KnowledgeGraph, dirtyNodeIds: Set<string>, options?: SmartValidationOptions): SmartValidationResult;
export {};
