import type { KnowledgeGraph, GapClassification } from "../domain/types.js";
export interface BriefingAnalysis {
    known_facts: Record<string, string>;
    missing_information: MissingInfo[];
    ambiguities: string[];
    contradictions: string[];
    inferred_entities: string[];
    inferred_architecture: string[];
    inferred_auth: string | null;
    domain_detected: string | null;
    tech_stack: DetectedTechStack;
    file_references: FileReference[];
}
/**
 * Options for controlling briefing analysis scope.
 */
export interface BriefingAnalysisOptions {
    /** Only run these detection categories (e.g., ["tech", "domain", "entity"]). */
    focusCategories?: string[];
    /** Skip these detection categories. */
    excludeCategories?: string[];
    /** Skip these specific entity patterns. */
    excludeEntities?: string[];
    /** Skip these specific domain patterns. */
    excludeDomains?: string[];
    /** Additional entity patterns to detect. */
    customEntities?: Array<{
        pattern: string;
        name: string;
    }>;
    /** Additional domain patterns to detect. */
    customDomains?: Array<{
        name: string;
        pattern: string;
    }>;
    /** Cache for analysis results (briefing_hash → result). */
    analysisCache?: Map<string, {
        result: BriefingAnalysis;
        timestamp: number;
    }>;
    /** Hash of the briefing text to check cache validity. */
    briefingHash?: string;
}
export interface DetectedTechStack {
    frontend: string | null;
    backend: string | null;
    database: string | null;
    auth: string | null;
    language: string | null;
    testing: string | null;
    other: string[];
}
export interface FileReference {
    path: string;
    context: string;
}
export interface MissingInfo {
    category: string;
    description: string;
    classification: GapClassification;
    already_answered: boolean;
    question_for_user: QuestionForUser | null;
}
export interface QuestionForUser {
    question: string;
    header: string;
    options: Array<{
        label: string;
        description: string;
    }>;
    multiple?: boolean;
}
export interface DiscoveryResult {
    analysis: BriefingAnalysis;
    questions_for_agent: QuestionForUser[];
    sufficient: boolean;
    summary: string;
    update_commands: UpdateCommand[];
}
export interface UpdateCommand {
    type: "add_node" | "add_relationship" | "update_node";
    node_type?: string;
    node_name?: string;
    metadata?: Record<string, unknown>;
    from?: string;
    to?: string;
    relationship_type?: string;
}
export declare function analyzeBriefing(briefing: string, options?: BriefingAnalysisOptions): BriefingAnalysis;
/**
 * Options for controlling question generation scope.
 */
export interface QuestionGenerationOptions {
    /** Skip these categories (e.g., ["auth", "frontend"]). */
    excludeCategories?: string[];
    /** Only generate questions for these categories. */
    focusCategories?: string[];
    /** Questions already asked by the IA — skip these. */
    alreadyAsked?: string[];
    /** Maximum questions to generate. */
    maxQuestions?: number;
    /** Only generate questions at these classifications. */
    focusClassifications?: Array<"CRITICAL" | "IMPORTANT" | "OPTIONAL" | "UNKNOWN">;
}
export declare function generateDiscoveryQuestions(analysis: BriefingAnalysis, options?: QuestionGenerationOptions): QuestionForUser[];
export declare function updateGraphFromAnswers(graph: KnowledgeGraph, answers: Record<string, string>): void;
export declare function isBriefingSufficient(analysis: BriefingAnalysis): boolean;
export declare function formatDiscoverySummary(analysis: BriefingAnalysis): string;
