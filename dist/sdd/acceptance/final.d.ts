import type { ChangeNode, KnowledgeGraph } from "../domain/types.js";
export type FinalAcceptanceStatus = "PENDING" | "ACCEPTED" | "REJECTED";
export interface FinalAcceptanceInput {
    actor: string;
    observation?: string;
    evidence?: Array<Record<string, unknown>>;
    expected_version?: number;
}
export interface FinalAcceptanceResult {
    change: ChangeNode;
    previous_status: FinalAcceptanceStatus;
    status: FinalAcceptanceStatus;
    actor: string;
    timestamp: string;
}
export declare function transitionFinalAcceptance(graph: KnowledgeGraph, changeId: string, status: Exclude<FinalAcceptanceStatus, "PENDING">, input: FinalAcceptanceInput): FinalAcceptanceResult;
export declare function getFinalAcceptanceStatus(change: ChangeNode): FinalAcceptanceStatus;
