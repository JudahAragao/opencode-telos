import type { KnowledgeGraph } from "../domain/types.js";
export interface ExecutableCheck {
    name: string;
    command: string[];
    status: "passed" | "failed" | "skipped";
    output: string;
}
export interface ExecutableValidationResult {
    passed: boolean;
    verified: boolean;
    checks: ExecutableCheck[];
    created_at: string;
    /** Content fingerprint captured after verification, used to reject stale reports. */
    project_fingerprint: string;
    functional_verified?: boolean;
    functional_gaps?: string[];
}
export declare function validateFunctionalEvidence(graph: KnowledgeGraph, changeId: string): {
    verified: boolean;
    gaps: string[];
};
/**
 * Hash source and manifest contents without including generated SDD reports or
 * dependency trees. This makes a verification report invalid after code or
 * configuration changes, while keeping completion checks reasonably cheap.
 */
export declare function computeProjectFingerprint(projectDir: string): string;
/** Run only project-declared verification scripts; never invent a package manager command. */
export declare function validateExecutableProject(projectDir: string): ExecutableValidationResult;
export declare function isExecutableValidationCurrent(projectDir: string, result: ExecutableValidationResult): boolean;
export declare function saveExecutableValidation(projectDir: string, changeId: string, result: ExecutableValidationResult): void;
export declare function loadExecutableValidation(projectDir: string, changeId: string): ExecutableValidationResult | undefined;
