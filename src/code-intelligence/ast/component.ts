import { basename } from "path"
import { TypeScriptParser } from "./typescript.js"
import { contentHash } from "./common.js"
import type { LanguageParser, ParsedFile } from "./ir.js"

/** Parse only script blocks while preserving original offsets and line numbers. */
export class ComponentParser implements LanguageParser {
  readonly name = "component-script-typescript"
  readonly version = "1"
  private readonly scriptParser = new TypeScriptParser()

  supports(language: string): boolean { return language === "vue" || language === "svelte" }

  parse(filePath: string, content: string): ParsedFile {
    const language = filePath.toLowerCase().endsWith(".vue") ? "vue" : "svelte"
    const masked: string[] = Array.from(content, (character) => character === "\n" || character === "\r" ? character : " ")
    const blocks = [...content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)]
    for (const match of blocks) {
      const start = (match.index || 0) + match[0].indexOf(">") + 1
      const script = match[1] || ""
      for (let index = 0; index < script.length; index++) masked[start + index] = script[index]
    }
    // Svelte also permits a top-level script block without HTML around it;
    // when no block is present the whole file is parsed for diagnostics.
    if (blocks.length === 0 && language === "svelte") {
      for (let index = 0; index < content.length; index++) masked[index] = content[index]
    }

    const parsed = this.scriptParser.parse(`${filePath}.ts`, masked.join(""))
    parsed.path = filePath
    parsed.language = language
    parsed.parser = this.name
    parsed.parser_version = this.version
    parsed.package_name = basename(filePath)
    parsed.content_hash = contentHash(content)
    if (blocks.length === 0) parsed.diagnostics.push({ message: "No script block found in component", severity: "info" })
    return parsed
  }
}
