import type { KnowledgeGraph } from "../domain/types.js";
import type { IntegrityReport } from "../graph/integrity.js";
export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    integrity?: IntegrityReport;
}
export interface ValidationError {
    code: string;
    message: string;
    node_id?: string;
    relationship_id?: string;
}
export interface ValidationWarning {
    code: string;
    message: string;
    node_id?: string;
}
export interface ValidationPolicy {
    critical_requirement_without_test: "error" | "warning";
    missing_verification_scenario: "error" | "warning";
}
export declare const DEFAULT_VALIDATION_POLICY: ValidationPolicy;
/**
 * Full graph validation. Checks structural integrity, semantic correctness,
 * references, completeness, constitution, promises, contradictions, and graph integrity.
 */
export declare function validateGraph(graph: KnowledgeGraph, policy?: ValidationPolicy, projectDir?: string): ValidationResult;
/**
 * Check if an entity has a valid persistence mapping.
 * Supports multiple strategies:
 * 1. Relationship: persists_to → database/table node
 * 2. Metadata: metadata.table, tableName, stored_in, persists_in, uses, mapped_to
 * 3. Unified schema: entity has fields defined (acceptable for schema.sql patterns)
 */
export declare function hasPersistenceMapping(entity: any, graph: KnowledgeGraph): boolean;
export declare function formatValidationResult(result: ValidationResult): string;
