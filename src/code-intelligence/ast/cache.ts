import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync } from "fs"
import { join, relative } from "path"
import { contentHash } from "./common.js"
import { emptyParsedFile } from "./common.js"
import { languageForPath } from "./fallback.js"
import { getLanguageParser } from "./registry.js"
import type { ParsedFile } from "./ir.js"
import { atomicWriteFile } from "../../sdd/cache/atomic.js"

interface CacheEntry {
  content_hash: string
  parser: string
  parser_version: string
  parsed: ParsedFile
}

interface CacheDocument {
  version: 2
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
    if (document.version !== 2 || !document.entries || typeof document.entries !== "object") {
      return { entries: new Map(), dirty: false }
    }
    const entries = Object.entries(document.entries).filter(([, entry]) =>
      Boolean(entry && entry.content_hash && entry.parser && entry.parser_version && entry.parsed),
    )
    return { entries: new Map(entries), dirty: false }
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
  const MAX_SOURCE_BYTES = 8 * 1024 * 1024
  if (Buffer.byteLength(content, "utf-8") > MAX_SOURCE_BYTES) {
    const limited = emptyParsedFile(filePath, languageForPath(filePath) || "unknown", parser.name, parser.version, content, "ast", 0)
    limited.diagnostics.push({ message: `Source file exceeds the ${MAX_SOURCE_BYTES} byte analysis limit`, severity: "error" })
    cache.entries.set(key, { content_hash: hash, parser: limited.parser, parser_version: limited.parser_version, parsed: limited })
    cache.dirty = true
    return limited
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
  const lockPath = join(directory, "ast-cache.lock")
  let descriptor: number | undefined
  try {
    try {
      descriptor = openSync(lockPath, "wx", 0o600)
    } catch {
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 30_000) unlinkSync(lockPath)
        descriptor = openSync(lockPath, "wx", 0o600)
      } catch {
        return
      }
    }

    // Merge with a cache written by another process while this process was
    // parsing, then let the current process win for files it touched.
    const latest = loadAstCache(projectDir)
    for (const [key, entry] of latest.entries) {
      if (!cache.entries.has(key)) cache.entries.set(key, entry)
    }
    const entries = Object.fromEntries(cache.entries)
    atomicWriteFile(cachePath(projectDir), JSON.stringify({ version: 2, entries } satisfies CacheDocument))
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    try { unlinkSync(lockPath) } catch {}
  }
}
