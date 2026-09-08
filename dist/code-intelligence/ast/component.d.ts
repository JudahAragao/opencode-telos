import type { LanguageParser, ParsedFile } from "./ir.js";
/** Parse only script blocks while preserving original offsets and line numbers. */
export declare class ComponentParser implements LanguageParser {
    readonly name = "component-script-typescript";
    readonly version = "1";
    private readonly scriptParser;
    supports(language: string): boolean;
    parse(filePath: string, content: string): ParsedFile;
}
