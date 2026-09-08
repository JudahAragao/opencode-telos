export interface ProjectStructure {
    directories: string[];
    files: string[];
    languages: Record<string, number>;
    frameworks: string[];
    package_manager: string | null;
    total_files: number;
    total_lines: number;
    estimated_complexity: "low" | "medium" | "high";
}
export interface BrownfieldAnalysis {
    structure: ProjectStructure;
    entry_points: string[];
    config_files: string[];
    test_files: string[];
    documentation_files: string[];
    summary: string;
}
export interface ScanOptions {
    /** Only scan these directories (relative to projectDir). */
    focusDirs?: string[];
    /** Max directory depth to walk (default: 5). */
    maxDepth?: number;
    /** Skip these directory names. */
    excludeDirs?: string[];
    /** Max files to collect (default: unlimited). */
    maxFiles?: number;
}
export declare function scanExistingProject(projectDir: string, options?: ScanOptions): BrownfieldAnalysis;
export declare function formatBrownfieldAnalysis(analysis: BrownfieldAnalysis): string;
