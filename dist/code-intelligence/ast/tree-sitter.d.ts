import type { LanguageParser, ParsedFile } from "./ir.js";
export declare class TreeSitterParser implements LanguageParser {
    readonly name = "tree-sitter";
    readonly version = "0.25";
    supports(language: string, extension: string): boolean;
    parse(filePath: string, content: string): ParsedFile;
}
