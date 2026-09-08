export interface ImportInfo {
    source: string;
    imported_names: string[];
    is_default: boolean;
    is_namespace: boolean;
    line: number;
}
export interface ExportInfo {
    name: string;
    type: 'default' | 'named' | 'reexport';
    line: number;
}
export interface ImportAnalysis {
    file_path: string;
    imports: ImportInfo[];
    exports: ExportInfo[];
    dependencies: string[];
    summary: {
        total_imports: number;
        total_exports: number;
        external_deps: string[];
        internal_deps: string[];
    };
    issues: ImportIssue[];
}
export interface ImportIssue {
    type: 'circular' | 'unused_import' | 'missing_import' | 'deep_import' | 'barrel_import';
    severity: 'warning' | 'error';
    message: string;
    line?: number;
}
export interface ImportAnalysisOptions {
    /** Only analyze imports from these module patterns. */
    focusModules?: string[];
    /** Skip these module patterns. */
    excludeModules?: string[];
    /** Max depth for circular dependency detection (default: unlimited). */
    maxDepth?: number;
    /** Cache for analysis results (filePath → result). */
    fileCache?: Map<string, {
        analysis: ImportAnalysis;
        contentHash: string;
    }>;
    /** Hash of the source content for cache invalidation. */
    contentHash?: string;
}
export declare function analyzeImports(sourceCode: string, filePath: string, options?: ImportAnalysisOptions): ImportAnalysis;
export declare function formatImportAnalysis(analysis: ImportAnalysis): string;
