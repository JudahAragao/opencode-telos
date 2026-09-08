import type { ParsedFile } from "./ir.js";
interface CacheEntry {
    content_hash: string;
    parser: string;
    parser_version: string;
    parsed: ParsedFile;
}
export interface AstCache {
    entries: Map<string, CacheEntry>;
    dirty: boolean;
}
export declare function loadAstCache(projectDir: string): AstCache;
export declare function parseWithCache(projectDir: string, filePath: string, content: string, cache: AstCache): ParsedFile;
export declare function saveAstCache(projectDir: string, cache: AstCache): void;
export {};
