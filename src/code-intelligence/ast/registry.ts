import { extname } from "path"
import { ComponentParser } from "./component.js"
import { FallbackParser, languageForPath } from "./fallback.js"
import { TreeSitterParser } from "./tree-sitter.js"
import { TypeScriptParser } from "./typescript.js"
import type { LanguageParser, ParsedFile } from "./ir.js"

const typescriptParser = new TypeScriptParser()
const treeSitterParser = new TreeSitterParser()
const componentParser = new ComponentParser()
const fallbackParser = new FallbackParser()

const parsers: LanguageParser[] = [typescriptParser, treeSitterParser, componentParser]

export function getLanguageParser(filePath: string): LanguageParser {
  const extension = extname(filePath).toLowerCase()
  const language = languageForPath(filePath) || "unknown"
  return parsers.find((parser) => parser.supports(language, extension)) || fallbackParser
}

export function parseSourceFile(filePath: string, content: string): ParsedFile {
  return getLanguageParser(filePath).parse(filePath, content)
}

export function listLanguageParsers(): string[] {
  return parsers.map((parser) => parser.name)
}

