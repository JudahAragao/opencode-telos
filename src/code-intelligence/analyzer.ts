import type { KnowledgeGraph } from "../sdd/domain/types.js"
import { addNode, addRelationship } from "../sdd/graph/engine.js"
import { readFileSync, existsSync, readdirSync } from "fs"
import { join, relative, extname, dirname, resolve } from "path"
import { stableId } from "./ast/common.js"
import { loadAstCache, parseWithCache, saveAstCache } from "./ast/cache.js"
import type { ParsedFile, SymbolInfo } from "./ast/ir.js"

const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".rb": "ruby",
  ".vue": "vue",
  ".svelte": "svelte",
}

type GraphSymbol = { id: string; filePath: string; symbol: SymbolInfo }

export interface CodebaseAnalysisResult {
  files_analyzed: number
  symbols_found: number
  test_requirement_links: number
  orphan_tests: string[]
}

export function analyzeCodebase(
  graph: KnowledgeGraph,
  projectDir: string,
): CodebaseAnalysisResult {
  const analysisRoots = ["src", "tests", "test", "__tests__"]
    .map((dir) => join(projectDir, dir))
    .filter(existsSync)
  if (analysisRoots.length === 0) return { files_analyzed: 0, symbols_found: 0, test_requirement_links: 0, orphan_tests: [] }

  let filesAnalyzed = 0
  let symbolsFound = 0
  let testReqLinks = 0
  const orphanTests: string[] = []
  const parsedFiles: ParsedFile[] = []
  const astCache = loadAstCache(projectDir)
  const moduleAliases = loadModuleAliases(projectDir)
  const fileIds = new Map<string, string>()
  const graphSymbols: GraphSymbol[] = []

  // Collect existing requirement and entity names for test inference
  const existingReqNames = new Set(graph.nodes
    .filter((n) => n.type === "requirement" || n.type === "entity" || n.type === "feature")
    .map((n) => n.name.toLowerCase()))
  // Only requirements can receive tested_by links. Keep the ID attached to
  // its name instead of returning the first requirement ID in the graph.
  const requirementIdsByName = new Map(
    graph.nodes
      .filter((n) => n.type === "requirement")
      .map((n) => [n.name.toLowerCase(), n.id]),
  )

  // Existing tested_by relationships
  const testedByRels = new Set(
    graph.relationships
      .filter((r) => r.type === "tested_by")
    .map((r) => `${r.from}->${r.to}`)
  )

  const walk = (dir: string) => {
    if (!existsSync(dir)) return
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
          walk(fullPath)
        }
        continue
      }

      const ext = extname(entry.name)
      if (!LANGUAGE_MAP[ext]) continue

      const relPath = relative(projectDir, fullPath)
      const content = readFileSync(fullPath, "utf-8")
      const analysis = parseWithCache(projectDir, fullPath, content, astCache)
      parsedFiles.push(analysis)

      const fileId = `file:${stableId(normalizeProjectPath(relPath))}`
      fileIds.set(normalizeProjectPath(relPath), fileId)
      addNode(graph, {
        id: fileId,
        type: "file",
        name: relPath,
        description: `${analysis.language} file (${analysis.parser})`,
        status: "IMPLEMENTED",
        version: 1,
        metadata: {
          path: relPath,
          language: analysis.language,
          parser: analysis.parser,
          parser_version: analysis.parser_version,
          content_hash: analysis.content_hash,
          analysis_source: analysis.analysis_source,
          confidence: analysis.confidence,
          diagnostics: analysis.diagnostics,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })

      const symbolIds = new Map<string, string>()
      for (const symbol of analysis.symbols) {
        const symId = `symbol:${stableId(`${normalizeProjectPath(relPath)}:${symbol.qualified_name}:${symbol.kind}`)}`
        symbolIds.set(symbol.qualified_name, symId)
        graphSymbols.push({ id: symId, filePath: relPath, symbol })
        addNode(graph, {
          id: symId,
          type: "symbol",
          name: symbol.qualified_name,
          description: `${symbol.kind} in ${relPath}`,
          status: "IMPLEMENTED",
          version: 1,
          metadata: {
            symbol_type: symbol.kind,
            file_path: relPath,
            qualified_name: symbol.qualified_name,
            visibility: symbol.visibility,
            exported: symbol.exported,
            signature: symbol.signature,
            source_range: symbol.range,
            analysis_source: analysis.analysis_source,
            confidence: analysis.confidence,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        addRelationship(graph, fileId, symId, "contains")
        symbolsFound++
      }

      // ── Test→Requirement inference ────────────────────────────────
      const isTestFile = relPath.includes("test") || relPath.includes("spec") ||
        entry.name.includes(".test.") || entry.name.includes(".spec.")

      if (isTestFile) {
        // Create TestNode
        const testNodeId = `test:${stableId(normalizeProjectPath(relPath))}`
        try {
          addNode(graph, {
            id: testNodeId,
            type: "test",
            name: entry.name,
            description: `Test file: ${relPath}`,
            status: "IMPLEMENTED",
            version: 1,
            metadata: {
              test_type: entry.name.includes(".e2e.") ? "e2e" : entry.name.includes(".integ.") ? "integration" : "unit",
              target: relPath,
              imports: analysis.imports.map((item) => item.source),
              test_names: analysis.test_names,
              parser: analysis.parser,
              analysis_source: analysis.analysis_source,
              confidence: analysis.confidence,
            },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          addRelationship(graph, fileId, testNodeId, "contains")
        } catch {
          // Node might already exist
        }

        // Try to infer which requirement this test covers
        const inferredReqId = inferRequirementFromTest(relPath, existingReqNames, requirementIdsByName, analysis.test_names, content)
        if (inferredReqId && !testedByRels.has(`${inferredReqId}->${testNodeId}`)) {
          try {
            addRelationship(graph, inferredReqId, testNodeId, "tested_by")
            testReqLinks++
          } catch {
            // Relationship might already exist
          }
        } else if (!inferredReqId) {
          orphanTests.push(relPath)
        }
      }

      filesAnalyzed++
    }
  }

  for (const root of analysisRoots) walk(root)

  // Resolve file imports only after every file has been indexed. Unresolved
  // imports remain diagnostics instead of becoming invented relationships.
  for (const parsed of parsedFiles) {
    const fromPath = normalizeProjectPath(relative(projectDir, parsed.path))
    const fromId = fileIds.get(fromPath)
    if (!fromId) continue
    for (const imported of parsed.imports) {
      const target = resolveImportedFile(projectDir, parsed.path, imported.source, fileIds, moduleAliases)
      if (!target) continue
      imported.resolution_status = "resolved"
      imported.resolved_path = target.path
      try { addRelationship(graph, fromId, target.id, "uses", { source: imported.source, range: imported.range, confidence: parsed.confidence }) } catch {}
    }
  }

  const symbolLookup = new Map<string, GraphSymbol>()
  for (const item of graphSymbols) {
    symbolLookup.set(`${normalizeProjectPath(item.filePath)}:${item.symbol.qualified_name}`, item)
    if (!symbolLookup.has(item.symbol.name)) symbolLookup.set(item.symbol.name, item)
  }
  for (const parsed of parsedFiles) {
    const filePath = normalizeProjectPath(relative(projectDir, parsed.path))
    for (const relation of parsed.relations) {
      const from = symbolLookup.get(`${filePath}:${relation.from}`) || symbolLookup.get(relation.from)
      const to = symbolLookup.get(`${filePath}:${relation.to}`) || symbolLookup.get(relation.to) || symbolLookup.get(relation.to.split(".").at(-1) || relation.to)
      if (!from || !to) continue
      const type = relation.type === "implements" ? "implements" : relation.type === "calls" ? "calls" : "depends_on"
      try { addRelationship(graph, from.id, to.id, type, { range: relation.range, confidence: relation.confidence, parser: parsed.parser }) } catch {}
    }
  }
  saveAstCache(projectDir, astCache)
  return { files_analyzed: filesAnalyzed, symbols_found: symbolsFound, test_requirement_links: testReqLinks, orphan_tests: orphanTests }
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "")
}

interface ModuleAliases {
  base_url: string
  paths: Array<{ pattern: string; targets: string[] }>
}

function loadModuleAliases(projectDir: string): ModuleAliases {
  try {
    const config = JSON.parse(readFileSync(join(projectDir, "tsconfig.json"), "utf-8")) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }
    return {
      base_url: resolve(projectDir, config.compilerOptions?.baseUrl || "."),
      paths: Object.entries(config.compilerOptions?.paths || {}).map(([pattern, targets]) => ({ pattern, targets })),
    }
  } catch {
    return { base_url: projectDir, paths: [] }
  }
}

function resolveImportedFile(projectDir: string, importer: string, source: string, files: Map<string, string>, aliases: ModuleAliases): { id: string; path: string } | null {
  const bases: string[] = []
  if (source.startsWith(".")) bases.push(resolve(dirname(importer), source))
  else {
    bases.push(resolve(aliases.base_url, source))
    if (source.includes(".")) bases.push(resolve(aliases.base_url, source.replaceAll(".", "/")))
    for (const alias of aliases.paths) {
      const marker = alias.pattern.indexOf("*")
      const prefix = marker >= 0 ? alias.pattern.slice(0, marker) : alias.pattern
      const suffix = marker >= 0 ? alias.pattern.slice(marker + 1) : ""
      if (!source.startsWith(prefix) || !source.endsWith(suffix)) continue
      const wildcard = source.slice(prefix.length, source.length - suffix.length)
      for (const target of alias.targets) bases.push(resolve(aliases.base_url, target.replace("*", wildcard)))
    }
  }
  const candidates = bases.flatMap((base) => [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}.py`, `${base}.go`, `${base}.rs`, `${base}.java`, `${base}.rb`, join(base, "index.ts"), join(base, "index.js")])
  for (const candidate of candidates) {
    const relativePath = normalizeProjectPath(relative(projectDir, candidate))
    const id = files.get(relativePath)
    if (id) return { id, path: relativePath }
  }
  return null
}

/**
 * Try to infer which requirement a test file covers.
 * Strategy 1: Match test filename against requirement/entity/feature names.
 * Strategy 2: Analyze test imports to find what module it tests.
 */
function inferRequirementFromTest(
  testPath: string,
  reqNames: Set<string>,
  requirementIdsByName: Map<string, string>,
  testNames: string[] = [],
  testContent?: string,
): string | null {
  // Strategy 1: Filename-based matching
  const testName = testPath
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

  const words = testName.split(/\s+/).filter((w) => w.length > 2)

  for (const reqName of reqNames) {
    const reqWords = reqName.split(/\s+/).filter((w) => w.length > 2)
    const matchingWords = reqWords.filter((w) => words.some((tw) => tw.includes(w) || w.includes(tw)))
    if (matchingWords.length >= Math.ceil(reqWords.length * 0.5) && reqWords.length > 0) {
      const requirementId = requirementIdsByName.get(reqName)
      if (requirementId) return requirementId
    }
  }

  // Strategy 2: Import-based matching
  if (testNames.length > 0) {
    for (const testName of testNames) {
      const describeText = testName.toLowerCase()
      for (const reqName of reqNames) {
        const reqLower = reqName.toLowerCase()
        if (describeText.includes(reqLower) || reqLower.includes(describeText)) return requirementIdsByName.get(reqName) || null
      }
    }
  }

  // Fallback only for test syntaxes not understood by the language adapter.
  if (testContent && testNames.length === 0) {
    const importMatches = testContent.matchAll(/from\s+['"]([^'"]+)['"]/g)
    for (const match of importMatches) {
      const importPath = match[1].toLowerCase()
      // Extract the module name from the import path
      const moduleParts = importPath.split(/[\/]/).filter(p => p.length > 2 && !p.startsWith('.'))

      for (const reqName of reqNames) {
        const reqLower = reqName.toLowerCase()
        if (moduleParts.some(part => reqLower.includes(part) || part.includes(reqLower))) {
          const requirementId = requirementIdsByName.get(reqName)
          if (requirementId) return requirementId
        }
      }
    }

    // Strategy 3: describe/it block matching
    const describeMatches = testContent.matchAll(/describe\s*\(\s*['"]([^'"]+)['"]/g)
    for (const match of describeMatches) {
      const describeText = match[1].toLowerCase()
      for (const reqName of reqNames) {
        const reqLower = reqName.toLowerCase()
        if (describeText.includes(reqLower) || reqLower.includes(describeText)) {
          const requirementId = requirementIdsByName.get(reqName)
          if (requirementId) return requirementId
        }
      }
    }
  }

  return null
}
