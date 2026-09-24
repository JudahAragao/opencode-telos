export interface ExtractedFeature {
    name: string;
    description: string;
    priority: "critical" | "high" | "medium" | "low";
    phase?: number;
}
export interface ExtractedEntity {
    name: string;
    description: string;
    fields: Array<{
        name: string;
        type: string;
        required?: boolean;
        unique?: boolean;
    }>;
}
export interface ExtractedEndpoint {
    method: string;
    path: string;
    description: string;
    relatedEntity?: string;
}
export interface ExtractedBusinessRule {
    name: string;
    description: string;
    relatedFeature?: string;
}
export interface ExtractedArchitectureComponent {
    name: string;
    layer: "frontend" | "backend" | "database" | "infrastructure" | "external";
    technology: string;
    description: string;
}
export interface ExtractedDecision {
    title: string;
    context: string;
    decision: string;
    consequences: string;
}
export interface ExtractedRequirement {
    name: string;
    description: string;
    type: "functional" | "non_functional";
    priority: "critical" | "high" | "medium" | "low";
    acceptanceCriteria: string[];
}
/**
 * Work item derived from a requirement/feature during graph bootstrap.
 * Tasks are deliberately separate from requirements: a requirement describes
 * the desired behaviour, while a task describes the implementation work that
 * will later be integrated into an SDD Change.
 */
export interface ExtractedTask {
    name: string;
    description: string;
    goal?: string;
    files?: string[];
    acceptance?: string[];
    priority?: "critical" | "high" | "medium" | "low";
    requirement?: string;
    feature?: string;
    endpoint?: string;
}
export interface ExtractedRelationship {
    from: string;
    to: string;
    type: string;
}
export interface BriefingDeepAnalysis {
    features: ExtractedFeature[];
    entities: ExtractedEntity[];
    endpoints: ExtractedEndpoint[];
    businessRules: ExtractedBusinessRule[];
    architectureComponents: ExtractedArchitectureComponent[];
    decisions: ExtractedDecision[];
    requirements: ExtractedRequirement[];
    tasks: ExtractedTask[];
    relationships: ExtractedRelationship[];
    domains: string[];
    techStack: Record<string, string>;
}
export declare function analyzeBriefingDeep(text: string): BriefingDeepAnalysis;
export declare function formatDeepAnalysis(analysis: BriefingDeepAnalysis): string;
