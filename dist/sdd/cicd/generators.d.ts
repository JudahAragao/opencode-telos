import type { KnowledgeGraph } from "../domain/types.js";
export type CicdPlatform = "github" | "gitlab" | "jenkins" | "docker" | "circleci" | "azure" | "aws" | "travis" | "npm" | "compose" | "maven" | "pip" | "all";
export interface CicdConfig {
    platform: CicdPlatform;
    projectDir: string;
    graph: KnowledgeGraph;
}
export interface CicdResult {
    platform: string;
    file_path: string;
    content: string;
}
export declare function generateCicd(config: CicdConfig): CicdResult[];
export declare function writeCicdFiles(results: CicdResult[], projectDir?: string): string[];
export declare function formatCicdResults(results: CicdResult[]): string;
