import type { KnowledgeGraph } from "../domain/types.js";
import type { DriftSignals, DuplicateDetectionOptions } from "./signals.js";
export interface DriftDetectionResult {
    has_drift: boolean;
    missing_files: MissingFileDrift[];
    untracked_files: UntrackedFileDrift[];
    spec_code_mismatches: SpecCodeMismatch[];
    signals?: DriftSignals;
}
export interface MissingFileDrift {
    node_id: string;
    file_path: string;
    expected_by: string;
}
export interface UntrackedFileDrift {
    file_path: string;
    full_path?: string;
    severity?: "info" | "warning" | "error";
    suggestion: string;
}
export interface SpecCodeMismatch {
    node_id: string;
    description: string;
    severity: "high" | "medium" | "low";
}
export declare function detectDrift(graph: KnowledgeGraph, projectDir: string, options?: DuplicateDetectionOptions): DriftDetectionResult;
export declare function formatDriftReport(result: DriftDetectionResult): string;
