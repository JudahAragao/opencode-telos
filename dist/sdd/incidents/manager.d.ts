import type { KnowledgeGraph, IncidentNode } from '../domain/types.js';
export interface IncidentWorkflow {
    id: string;
    title: string;
    severity: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';
    impact: string;
}
export declare function createIncident(_graph: KnowledgeGraph, workflow: IncidentWorkflow): IncidentNode;
export declare function getIncidentInstructions(incident: IncidentNode): string;
