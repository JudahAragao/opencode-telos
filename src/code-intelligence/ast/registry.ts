import { extname } from "path"
import { ComponentParser } from "./component.js"
import { FallbackParser, languageForPath } from "./fallback.js"
import { TreeSitterParser } from "./tree-sitter.js"
import type { LanguageParser, ParsedFile } from "./ir.js"

let TypeScriptParser: (new () => LanguageParser) | undefined
function lazyTypeScriptParser(): LanguageParser {
  if (!TypeScriptParser) {
    try {
      const mod = require("./typescript.js")
      TypeScriptParser = mod.TypeScriptParser as (new () => LanguageParser) | undefined
    } catch {
      TypeScriptParser = undefined
    }
  }
  if (!TypeScriptParser) throw new Error("typescript parser unavailable")
  return new TypeScriptParser()
}

const treeSitterParser = new TreeSitterParser()
const componentParser = new ComponentParser()
const fallbackParser = new FallbackParser()

const parsers: LanguageParser[] = [treeSitterParser, componentParser]

export function getLanguageParser(filePath: string): LanguageParser {
  const extension = extname(filePath).toLowerCase()
  const language = languageForPath(filePath) || "unknown"

  // Try static parsers first; only load TypeScript on demand.
  for (const parser of parsers) {
    if (parser.supports(language, extension)) return parser
  }

  if (extension.toLowerCase() === ".ts" || extension.toLowerCase() === ".tsx" ||
      extension.toLowerCase() === ".mts" || extension.toLowerCase() === ".cts" ||
      language === "typescript" || language === "javascript") {
    try {
      const tsParser = lazyTypeScriptParser()
      if (tsParser.supports(language, extension)) return tsParser
    } catch {
      // TypeScript not available — degrade gracefully to fallback.
    }
  }

  return fallbackParser
}

export function parseSourceFile(filePath: string, content: string): ParsedFile {
  return getLanguageParser(filePath).parse(filePath, content)
}

export function listLanguageParsers(): string[] {
  const available: string[] = []
  for (const parser of parsers) available.push(parser.name)
  try {
    lazyTypeScriptParser()
    if (TypeScriptParser) available.push("typescript-compiler-api")
  } catch {}
  available.push(fallbackParser.name)
  return available
}
