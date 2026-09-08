import type { KnowledgeGraph } from "../domain/types.js";
export interface GeneratedFile {
    path: string;
    content: string;
    description: string;
}
export interface GenerationPlan {
    files: GeneratedFile[];
    directories: string[];
    summary: string;
}
export interface TechStack {
    frontend?: string;
    backend?: string;
    database?: string;
    language?: string;
    orm?: string;
    testFramework?: string;
}
export declare function detectTechStack(graph: KnowledgeGraph): TechStack;
export declare function hasCodegenSupport(stack: TechStack): boolean;
export declare function generateProject(graph: KnowledgeGraph, stack?: TechStack): GenerationPlan;
export interface GeneratedWriteOptions {
    /** Existing files are never replaced unless the approved caller opts in. */
    overwrite?: boolean;
    /** Save a recoverable copy before an approved replacement. */
    backup?: boolean;
}
export interface GeneratedWriteResult {
    written: number;
    created: number;
    unchanged: number;
    conflicts: string[];
    backups: string[];
    errors: string[];
}
/**
 * Materialize a plan without silently destroying brownfield code.  The caller
 * receives all conflicts and must explicitly request overwrite after review.
 */
export declare function writeGeneratedFiles(projectDir: string, plan: GenerationPlan, options?: GeneratedWriteOptions): GeneratedWriteResult;
