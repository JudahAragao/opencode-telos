import { extname } from "path"
import { emptyParsedFile, rangeFromOffsets } from "./common.js"
import type { LanguageParser, ParsedFile } from "./ir.js"

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".go": "go", ".rs": "rust", ".java": "java", ".rb": "ruby",
  ".vue": "vue", ".svelte": "svelte",
}

export function languageForPath(filePath: string): string | undefined {
  return LANGUAGE_BY_EXTENSION[extname(filePath).toLowerCase()]
}

export class FallbackParser implements LanguageParser {
  readonly name = "regex-fallback"
  readonly version = "1"

  supports(): boolean { return true }

  parse(filePath: string, content: string): ParsedFile {
    const language = languageForPath(filePath) || "unknown"
    const result = emptyParsedFile(filePath, language, this.name, this.version, content, "fallback", 0.25)
    const addSymbol = (name: string, kind: "class" | "function", start: number, exported = false) => {
      result.symbols.push({
        name,
        qualified_name: name,
        kind,
        range: rangeFromOffsets(content, start, start + name.length),
        exported,
      })
    }
    for (const match of content.matchAll(/\b(?:class|interface|struct|enum)\s+([A-Za-z_]\w*)/g)) {
      addSymbol(match[1], "class", match.index || 0)
    }
    for (const match of content.matchAll(/\b(?:function|def|fn)\s+([A-Za-z_]\w*)/g)) {
      addSymbol(match[1], "function", match.index || 0)
    }
    result.diagnostics.push({ message: "No structured parser is available for this file; fallback results are non-authoritative", severity: "warning" })
    return result
  }
}

