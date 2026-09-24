import type { KnowledgeGraph, SpecPromise } from "../domain/types.js";
import { type DependencyRule } from "./classifier.js";
export interface PromiseReport {
    total: number;
    pending: number;
    fulfilled: number;
    violated: number;
    unverifiable: number;
    fulfillment_rate: number;
    promises: SpecPromise[];
}
export interface PromiseVerificationInput {
    evidence: string;
    evidence_refs?: SpecPromise["evidence_refs"];
    execution_id?: string;
    project_dir?: string;
}
/** Stable identity: reordering acceptance criteria must not change the promise. */
export declare function stablePromiseId(sourceNodeId: string, description: string, kind?: string): string;
export declare function extractPromises(graph: KnowledgeGraph, options?: {
    autoClassify?: boolean;
    customRules?: DependencyRule[];
}): SpecPromise[];
export declare function verifyPromise(graph: KnowledgeGraph, promiseId: string, input: string | PromiseVerificationInput): SpecPromise | null;
export declare function markPromiseViolated(graph: KnowledgeGraph, promiseId: string, reason?: string): SpecPromise | null;
export declare function getPromiseReport(graph: KnowledgeGraph): PromiseReport;
export declare function formatPromiseReport(report: PromiseReport): string;
