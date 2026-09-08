import { createHash } from "crypto";
export function contentHash(content) {
    return createHash("sha256").update(content).digest("hex");
}
export function stableId(value) {
    return createHash("sha256").update(value).digest("hex").slice(0, 20);
}
export function positionAt(content, index) {
    const safeIndex = Math.max(0, Math.min(index, content.length));
    const before = content.slice(0, safeIndex);
    const lineBreak = before.lastIndexOf("\n");
    return { line: before.split("\n").length, column: safeIndex - lineBreak };
}
export function rangeFromOffsets(content, start, end) {
    return {
        start: positionAt(content, start),
        end: positionAt(content, end),
        start_index: start,
        end_index: end,
    };
}
export function emptyParsedFile(filePath, language, parser, version, content, source = "ast", confidence = 1) {
    return {
        path: filePath,
        language,
        parser,
        parser_version: version,
        content_hash: contentHash(content),
        analysis_source: source,
        confidence,
        imports: [],
        exports: [],
        symbols: [],
        relations: [],
        test_names: [],
        diagnostics: [],
    };
}
export function addDiagnostic(diagnostics, message, severity, range) {
    diagnostics.push({ message, severity, range });
}
