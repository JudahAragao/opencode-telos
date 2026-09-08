import type { LanguageParser, ParsedFile } from "./ir.js";
export declare function getLanguageParser(filePath: string): LanguageParser;
export declare function parseSourceFile(filePath: string, content: string): ParsedFile;
export declare function listLanguageParsers(): string[];
