/**
 * Serviço de Milestones e rastreabilidade por release.
 *
 * Um `milestone` é a âncora de entrega: agrupa changes, tasks, features e
 * requirements e permite responder "o que entra no Release X, o que está
 * implementado e o que não tem evidência de teste".
 *
 * Toda a lógica aqui é pura (opera sobre `KnowledgeGraph`) para ser reutilizada
 * pela tool `sdd.milestone`, pelo backfill de migração e por testes.
 */
import type { KnowledgeGraph, MilestoneNode, NodeStatus, NodeType } from "../domain/types.js";
import { ensureMilestoneNodes } from "../discovery/relationship-inferencer.js";
/** Tipos que podem ser membros diretos de um milestone. */
export declare const MILESTONE_MEMBER_TYPES: ReadonlySet<NodeType>;
export declare function slugifyMilestone(value: string): string;
export interface CreateMilestoneInput {
    name: string;
    release_version?: string;
    target_date?: string;
    objective?: string;
    status?: NodeStatus;
}
export declare function getMilestoneNodes(graph: KnowledgeGraph): MilestoneNode[];
export declare function getMilestone(graph: KnowledgeGraph, id: string): MilestoneNode | undefined;
export declare function createMilestone(graph: KnowledgeGraph, input: CreateMilestoneInput): MilestoneNode;
export interface LinkResult {
    linked: number;
    skipped: number;
    not_found: string[];
}
export declare function linkNodesToMilestone(graph: KnowledgeGraph, milestoneId: string, nodeIds: string[]): LinkResult;
export declare function unlinkNodesFromMilestone(graph: KnowledgeGraph, milestoneId: string, nodeIds: string[]): number;
export declare function moveNodesToMilestone(graph: KnowledgeGraph, fromId: string, toId: string, nodeIds: string[]): LinkResult;
export declare function closeMilestone(graph: KnowledgeGraph, milestoneId: string, status?: NodeStatus): MilestoneNode;
export interface ReleaseCoverage {
    requirements_total: number;
    requirements_tested: number;
    requirements_untested: string[];
    features_total: number;
    features_linked: number;
    features_unlinked: string[];
    endpoints_total: number;
    endpoints_unlinked: string[];
    files_total: number;
    files_unlinked: string[];
}
export interface ReleaseMilestoneReport {
    id: string;
    name: string;
    release_version?: string;
    status: NodeStatus;
    target_date?: string;
    counts: {
        changes: number;
        tasks: number;
        features: number;
        requirements: number;
        endpoints: number;
        files: number;
        tests: number;
    };
    progress_percent: number;
    coverage: ReleaseCoverage;
}
export interface ReleaseReport {
    milestones: ReleaseMilestoneReport[];
    unassigned: {
        changes: string[];
        tasks: string[];
    };
    generated_at: string;
}
export declare function buildReleaseReport(graph: KnowledgeGraph, milestoneId?: string): ReleaseReport;
export declare function formatReleaseReport(report: ReleaseReport, nameOf?: (id: string) => string): string;
export { ensureMilestoneNodes };
