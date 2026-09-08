import type { KnowledgeGraph } from '../domain/types.js';
export interface DocumentationConfig {
    type: 'api' | 'user_guide' | 'developer_guide' | 'architecture';
    language?: string;
}
export declare function generateDocumentation(graph: KnowledgeGraph, config: DocumentationConfig): string;
