import type { KnowledgeGraph, ChangeNode, MigrationNode } from '../domain/types.js';
export interface DataMigrationWorkflow {
    id: string;
    source_schema: string;
    target_schema: string;
    description: string;
    data_transformations?: string[];
}
export declare function createMigrationChange(_graph: KnowledgeGraph, workflow: DataMigrationWorkflow): {
    change: ChangeNode;
    migration: MigrationNode;
};
export declare function getMigrationInstructions(migration: MigrationNode): string;
