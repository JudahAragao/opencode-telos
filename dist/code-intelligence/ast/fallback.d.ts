import type { LanguageParser, ParsedFile } from "./ir.js";
export declare function languageForPath(filePath: string): string | undefined;
export declare class FallbackParser implements LanguageParser {
    readonly name = "regex-fallback";
    readonly version = "1";
    supports(): boolean;
    parse(filePath: string, content: string): ParsedFile;
}
