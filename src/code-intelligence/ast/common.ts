import { createHash } from "crypto"
import type { ParseDiagnostic, ParsedFile, SourcePosition, SourceRange } from "./ir.js"

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

export function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20)
}

export function positionAt(content: string, index: number): SourcePosition {
  const safeIndex = Math.max(0, Math.min(index, content.length))
  const before = content.slice(0, safeIndex)
  const lineBreak = before.lastIndexOf("\n")
  return { line: before.split("\n").length, column: safeIndex - lineBreak }
}

export function rangeFromOffsets(content: string, start: number, end: number): SourceRange {
  return {
    start: positionAt(content, start),
    end: positionAt(content, end),
    start_index: start,
    end_index: end,
  }
}

export function emptyParsedFile(
  filePath: string,
  language: string,
  parser: string,
  version: string,
  content: string,
  source: "ast" | "fallback" = "ast",
  confidence = 1,
): ParsedFile {
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
  }
}

export function addDiagnostic(
  diagnostics: ParseDiagnostic[],
  message: string,
  severity: ParseDiagnostic["severity"],
  range?: SourceRange,
): void {
  diagnostics.push({ message, severity, range })
}

