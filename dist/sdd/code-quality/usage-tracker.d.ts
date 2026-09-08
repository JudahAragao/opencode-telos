import type { KnowledgeGraph } from '../domain/types.js';
export interface UsageReport {
    files: FileUsage[];
    symbols: SymbolUsage[];
    summary: {
        total_files: number;
        used_files: number;
        unused_files: number;
        total_symbols: number;
        used_symbols: number;
        unused_symbols: number;
    };
    unused_code: UnusedCode[];
}
export interface FileUsage {
    file_path: string;
    imported_by: ImportUsage[];
    used_by: string[];
    is_entry_point: boolean;
    is_connected_to_spec: boolean;
    connected_spec_nodes: string[];
    status: 'used' | 'unused' | 'orphan' | 'disconnected';
}
export interface ImportUsage {
    importing_file: string;
    imported_symbols: string[];
    actually_used_symbols: string[];
    unused_imports: string[];
    is_effectively_used: boolean;
}
export interface SymbolUsage {
    symbol_name: string;
    file_path: string;
    symbol_type: string;
    imported_by: ImportUsage[];
    called_by: string[];
    referenced_by: string[];
    is_connected_to_spec: boolean;
    connected_spec_nodes: string[];
    status: 'used' | 'unused' | 'dead' | 'disconnected';
}
export interface UnusedCode {
    type: 'file' | 'symbol' | 'import' | 'export';
    name: string;
    file_path: string;
    reason: string;
    severity: 'warning' | 'error' | 'info';
    recommendation: string;
    is_connected_to_spec: boolean;
    connected_spec_nodes: string[];
    details?: {
        importing_file?: string;
        imported_symbols?: string[];
        unused_symbols?: string[];
    };
}
export declare function trackUsage(graph: KnowledgeGraph, sourceFiles: Map<string, string>): UsageReport;
export declare function formatUsageReport(report: UsageReport): string;
