import type { AnyNode, FindingCategory, FindingEvidence, FindingNode, FindingStatus, KnowledgeGraph, SddPurpose } from "../domain/types.js";
import type { BrownfieldAnalysis } from "./scanner.js";
export interface FindingInput {
    category: FindingCategory;
    severity: "critical" | "high" | "medium" | "low";
    title: string;
    observed_behavior: string;
    expected_behavior?: string;
    purpose: SddPurpose;
    confidence?: number;
    source_files?: string[];
    source_node_ids?: string[];
    evidence?: FindingEvidence[];
    remediation?: string;
    target_behavior?: string;
    fingerprint?: string;
}
export interface FindingResolutionInput {
    findingId: string;
    description: string;
    status?: Extract<FindingStatus, "resolved" | "closed" | "accepted" | "wont_fix">;
    changeId?: string;
    taskId?: string;
    targetNodeIds?: string[];
    evidence?: FindingEvidence[];
    actor?: string;
}
export interface FindingScanResult {
    findings: FindingInput[];
    filesInspected: number;
    detectors: string[];
}
export declare function findingFingerprint(input: Pick<FindingInput, "category" | "title" | "source_files" | "observed_behavior">): string;
export declare function upsertFinding(graph: KnowledgeGraph, input: FindingInput): FindingNode;
export declare function createFindingTask(graph: KnowledgeGraph, finding: FindingNode, options?: {
    purpose: SddPurpose;
    targetNodeId?: string;
    blocked?: boolean;
}): AnyNode;
export declare function resolveFinding(graph: KnowledgeGraph, input: FindingResolutionInput): FindingNode;
export declare function transitionFinding(graph: KnowledgeGraph, findingId: string, status: FindingStatus, reason?: string, actor?: string): FindingNode;
export declare function getFindings(graph: KnowledgeGraph, status?: FindingStatus): FindingNode[];
export declare function formatFindingsReport(graph: KnowledgeGraph, purpose?: SddPurpose): string;
export declare function detectBrownfieldFindings(projectDir: string, brownfield: BrownfieldAnalysis, purpose: SddPurpose): FindingScanResult;
