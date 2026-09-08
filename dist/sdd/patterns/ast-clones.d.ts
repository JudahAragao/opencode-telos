export interface CloneBlock {
    file: string;
    start_line: number;
    end_line: number;
    content: string;
    fingerprint: string;
}
export interface CloneGroup {
    blocks: CloneBlock[];
    similarity: number;
    token_count: number;
    risk: "low" | "medium" | "high";
}
export interface CloneReport {
    groups: CloneGroup[];
    total_clones: number;
    files_scanned: number;
    tokens_in_clones: number;
    summary: string;
}
export declare function detectAstClones(projectDir: string, threshold?: number): CloneReport;
export declare function formatCloneReport(report: CloneReport): string;
