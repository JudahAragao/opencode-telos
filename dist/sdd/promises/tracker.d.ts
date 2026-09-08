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
export declare function extractPromises(graph: KnowledgeGraph, options?: {
    autoClassify?: boolean;
    customRules?: DependencyRule[];
}): SpecPromise[];
export declare function verifyPromise(graph: KnowledgeGraph, promiseId: string, evidence: string): SpecPromise | null;
export declare function markPromiseViolated(graph: KnowledgeGraph, promiseId: string): SpecPromise | null;
export declare function getPromiseReport(graph: KnowledgeGraph): PromiseReport;
export declare function formatPromiseReport(report: PromiseReport): string;
