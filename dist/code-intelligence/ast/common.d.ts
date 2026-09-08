import type { ParseDiagnostic, ParsedFile, SourcePosition, SourceRange } from "./ir.js";
export declare function contentHash(content: string): string;
export declare function stableId(value: string): string;
export declare function positionAt(content: string, index: number): SourcePosition;
export declare function rangeFromOffsets(content: string, start: number, end: number): SourceRange;
export declare function emptyParsedFile(filePath: string, language: string, parser: string, version: string, content: string, source?: "ast" | "fallback", confidence?: number): ParsedFile;
export declare function addDiagnostic(diagnostics: ParseDiagnostic[], message: string, severity: ParseDiagnostic["severity"], range?: SourceRange): void;
