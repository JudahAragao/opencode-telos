import type { KnowledgeGraph } from '../domain/types.js';
export interface DependencyNode {
    id: string;
    name: string;
    type: string;
    dependencies: string[];
    dependents: string[];
}
export interface DependencyReport {
    nodes: DependencyNode[];
    cycles: string[][];
    coupling: {
        afferent: Record<string, number>;
        efferent: Record<string, number>;
        instability: Record<string, number>;
    };
    summary: {
        total_nodes: number;
        total_dependencies: number;
        cycles_found: number;
        most_coupled: string;
        least_stable: string;
    };
}
export declare function analyzeDependencies(graph: KnowledgeGraph): DependencyReport;
export declare function formatDependencyReport(report: DependencyReport): string;
