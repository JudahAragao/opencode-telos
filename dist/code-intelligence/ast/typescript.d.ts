import type { LanguageParser, ParsedFile } from "./ir.js";
export declare class TypeScriptParser implements LanguageParser {
    readonly name = "typescript-compiler-api";
    readonly version: string;
    supports(language: string, extension: string): boolean;
    parse(filePath: string, content: string): ParsedFile;
}
