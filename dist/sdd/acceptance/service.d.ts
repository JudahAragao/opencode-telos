import type { AcceptanceCriterionNode, AcceptanceStatus, AnyNode, KnowledgeGraph } from "../domain/types.js";
export interface AcceptanceEvidence {
    type?: string;
    source?: string;
    id?: string;
    summary?: string;
}
export interface AcceptanceAuditEvent {
    action: "accept" | "reject" | "waive" | "reopen" | "invalidate" | "create" | "update_text";
    criterion_id: string;
    actor: string;
    timestamp: string;
    previous_status?: AcceptanceStatus;
    status: AcceptanceStatus;
    previous_hash?: string;
    content_hash: string;
    observation?: string;
}
export interface AcceptanceAuditSink {
    record(event: AcceptanceAuditEvent): void;
}
export interface AcceptanceMutationInput {
    actor: string;
    observation?: string;
    evidence?: AcceptanceEvidence[];
    expected_version?: number;
    expected_hash?: string;
}
export interface AcceptAllResult {
    requirement_id: string;
    selected: number;
    accepted: string[];
    skipped: string[];
    failed: Array<{
        criterion_id: string;
        reason: string;
    }>;
    timestamp: string;
    actor: string;
    audit: AcceptanceAuditEvent[];
}
export interface AcceptanceSummary {
    total: number;
    pending: number;
    accepted: number;
    rejected: number;
    waived: number;
    all_accepted: boolean;
}
export interface ChangeAcceptanceCheck {
    allowed: boolean;
    requirements: string[];
    pending: string[];
    rejected: string[];
    waived: string[];
    reason: string;
}
export declare function acceptanceContentHash(text: string): string;
export declare function getAcceptanceCriteria(graph: KnowledgeGraph, requirementId: string, includeLegacy?: boolean): AcceptanceCriterionNode[];
export declare function createAcceptanceCriterion(graph: KnowledgeGraph, requirementId: string, text: string, legacySource?: string): AcceptanceCriterionNode;
export declare function updateAcceptanceCriterionText(graph: KnowledgeGraph, criterionId: string, text: string, input: Pick<AcceptanceMutationInput, "actor" | "observation">): AcceptanceCriterionNode;
export declare class AcceptanceService {
    private readonly graph;
    private readonly includeLegacyFallback;
    private readonly auditSink?;
    constructor(graph: KnowledgeGraph, includeLegacyFallback?: boolean, auditSink?: AcceptanceAuditSink | undefined);
    private emit;
    list(requirementId?: string, includeLegacy?: boolean): AcceptanceCriterionNode[];
    summary(requirementId: string, includeLegacy?: boolean, allowWaived?: boolean): AcceptanceSummary;
    create(requirementId: string, text: string, legacySource?: string, actor?: string): AcceptanceCriterionNode;
    updateText(criterionId: string, text: string, input: Pick<AcceptanceMutationInput, "actor" | "observation">): {
        criterion: AcceptanceCriterionNode;
        audit?: AcceptanceAuditEvent;
    };
    transition(criterionId: string, status: AcceptanceStatus, input: AcceptanceMutationInput): {
        criterion: AcceptanceCriterionNode;
        audit: AcceptanceAuditEvent;
    };
    accept(criterionId: string, input: AcceptanceMutationInput): {
        criterion: AcceptanceCriterionNode;
        audit: AcceptanceAuditEvent;
    };
    reject(criterionId: string, input: AcceptanceMutationInput): {
        criterion: AcceptanceCriterionNode;
        audit: AcceptanceAuditEvent;
    };
    waive(criterionId: string, input: AcceptanceMutationInput): {
        criterion: AcceptanceCriterionNode;
        audit: AcceptanceAuditEvent;
    };
    reopen(criterionId: string, input: AcceptanceMutationInput): {
        criterion: AcceptanceCriterionNode;
        audit: AcceptanceAuditEvent;
    };
    acceptAll(requirementId: string, input: AcceptanceMutationInput): AcceptAllResult;
    invalidateForRequirement(requirementId: string, actor: string, observation?: string): AcceptanceAuditEvent[];
    requirementForCriterion(criterionId: string): AnyNode | undefined;
}
export declare function checkChangeAcceptance(graph: KnowledgeGraph, changeId: string, options?: {
    allowWaived?: boolean;
    legacyFallback?: boolean;
}): ChangeAcceptanceCheck;
export interface LegacyAcceptanceMigrationOptions {
    /** Remove legacy copies only after every value was materialized successfully. */
    removeLegacy?: boolean;
}
export declare function materializeLegacyAcceptanceCriteria(graph: KnowledgeGraph, options?: LegacyAcceptanceMigrationOptions): {
    created: number;
    linked: number;
    unresolved: string[];
    removed: number;
};
