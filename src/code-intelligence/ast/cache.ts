import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs"
import { join, relative } from "path"
import { contentHash } from "./common.js"
import { getLanguageParser } from "./registry.js"
import type { ParsedFile } from "./ir.js"

interface CacheEntry {
  content_hash: string
  parser: string
  parser_version: string
  parsed: ParsedFile
}

interface CacheDocument {
  version: 1
  entries: Record<string, CacheEntry>
}

export interface AstCache {
  entries: Map<string, CacheEntry>
  dirty: boolean
}

function cachePath(projectDir: string): string {
  return join(projectDir, ".sdd", "ast-cache.json")
}

export function loadAstCache(projectDir: string): AstCache {
  const path = cachePath(projectDir)
  if (!existsSync(path)) return { entries: new Map(), dirty: false }
  try {
    const document = JSON.parse(readFileSync(path, "utf-8")) as CacheDocument
    return { entries: new Map(Object.entries(document.entries || {})), dirty: false }
  } catch {
    return { entries: new Map(), dirty: false }
  }
}

export function parseWithCache(projectDir: string, filePath: string, content: string, cache: AstCache): ParsedFile {
  const key = relative(projectDir, filePath).replaceAll("\\", "/")
  const hash = contentHash(content)
  const parser = getLanguageParser(filePath)
  const cached = cache.entries.get(key)
  if (cached && cached.content_hash === hash && cached.parser === parser.name && cached.parser_version === parser.version) {
    return { ...cached.parsed, path: filePath }
  }
  const parsed = parser.parse(filePath, content)
  cache.entries.set(key, { content_hash: hash, parser: parsed.parser, parser_version: parsed.parser_version, parsed })
  cache.dirty = true
  return parsed
}

export function saveAstCache(projectDir: string, cache: AstCache): void {
  if (!cache.dirty) return
  const directory = join(projectDir, ".sdd")
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true })
  const entries = Object.fromEntries(cache.entries)
  const temporary = `${cachePath(projectDir)}.tmp`
  writeFileSync(temporary, JSON.stringify({ version: 1, entries } satisfies CacheDocument), "utf-8")
  renameSync(temporary, cachePath(projectDir))
}
