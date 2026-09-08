import type { SymbolNode } from '../domain/types.js';
export interface ParsedSymbol {
    name: string;
    symbol_type: SymbolNode['metadata']['symbol_type'];
    file_path: string;
    line_start: number;
    line_end: number;
    visibility: 'public' | 'private' | 'protected' | 'exported';
    is_async: boolean;
    parameters?: string[];
    return_type?: string;
}
export interface SymbolParseResult {
    symbols: ParsedSymbol[];
    summary: {
        total: number;
        functions: number;
        classes: number;
        interfaces: number;
        types: number;
        methods: number;
        variables: number;
    };
}
export declare function parseSymbols(sourceCode: string, filePath: string): SymbolParseResult;
export declare function convertToSymbolNodes(result: SymbolParseResult): SymbolNode[];
export declare function formatSymbolParseResult(result: SymbolParseResult): string;
