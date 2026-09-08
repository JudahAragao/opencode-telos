import { addNode, addRelationship, removeNode, updateNode } from "../sdd/graph/engine.js";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, relative, extname, dirname, resolve } from "path";
import { stableId } from "./ast/common.js";
import { loadAstCache, parseWithCache, saveAstCache } from "./ast/cache.js";
import { sddDebug } from "../sdd/log.js";
const LANGUAGE_MAP = {
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
};
export function analyzeCodebase(graph, projectDir) {
    if (!existsSync(projectDir))
        return { files_analyzed: 0, symbols_found: 0, test_requirement_links: 0, orphan_tests: [] };
    let filesAnalyzed = 0;
    let symbolsFound = 0;
    let testReqLinks = 0;
    const orphanTests = [];
    const parsedFiles = [];
    const astCache = loadAstCache(projectDir);
    const moduleAliases = loadModuleAliases(projectDir);
    const fileIds = new Map();
    const graphSymbols = [];
    // Rebuild relationships produced by the code-intelligence pass. Keeping
    // these marked makes a second analysis idempotent and removes imports/calls
    // that disappeared from edited files instead of accumulating stale edges.
    const previousAnalysisTests = new Set(graph.nodes
        .filter((node) => node.type === "test" && node.metadata.analysis_source)
        .map((node) => node.id));
    graph.relationships = graph.relationships.filter((relationship) => {
        const metadata = relationship.metadata;
        return metadata.code_intelligence !== true &&
            !(relationship.type === "tested_by" && previousAnalysisTests.has(relationship.to));
    });
    const walk = (dir) => {
        if (!existsSync(dir))
            return;
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isSymbolicLink())
                continue;
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!entry.name.startsWith(".") && !new Set(["node_modules", "dist", "build", "coverage", "target", "vendor"]).has(entry.name)) {
                    walk(fullPath);
                }
                continue;
            }
            const ext = extname(entry.name);
            if (!LANGUAGE_MAP[ext])
                continue;
            const relPath = relative(projectDir, fullPath);
            const content = readFileSync(fullPath, "utf-8");
            const analysis = parseWithCache(projectDir, fullPath, content, astCache);
            parsedFiles.push(analysis);
            const fileId = `file:${stableId(normalizeProjectPath(relPath))}`;
            fileIds.set(normalizeProjectPath(relPath), fileId);
            const fileNode = {
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
            };
            const existingFile = graph.nodes.find((node) => node.id === fileId);
            if (!existingFile)
                addNode(graph, fileNode);
            else if (nodeContentChanged(existingFile, fileNode))
                updateNode(graph, fileId, fileNode);
            const symbolIds = new Map();
            for (const symbol of analysis.symbols) {
                const symId = `symbol:${stableId(`${normalizeProjectPath(relPath)}:${symbol.qualified_name}:${symbol.kind}`)}`;
                symbolIds.set(symbol.qualified_name, symId);
                graphSymbols.push({ id: symId, filePath: relPath, symbol });
                const symbolNode = {
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
                };
                const existingSymbol = graph.nodes.find((node) => node.id === symId);
                if (!existingSymbol)
                    addNode(graph, symbolNode);
                else if (nodeContentChanged(existingSymbol, symbolNode))
                    updateNode(graph, symId, symbolNode);
                addRelationship(graph, fileId, symId, "contains", { code_intelligence: true });
                symbolsFound++;
            }
            for (const node of [...graph.nodes]) {
                if (node.type !== "symbol")
                    continue;
                const metadata = node.metadata;
                if (metadata.analysis_source && metadata.file_path === relPath && !symbolIdsHasNode(symbolIds, node.id)) {
                    removeNode(graph, node.id);
                }
            }
            // ── Test→Requirement inference ────────────────────────────────
            const pathParts = normalizeProjectPath(relPath).split("/");
            const baseName = entry.name.toLowerCase();
            const isTestFile = pathParts.slice(0, -1).some((part) => ["test", "tests", "__tests__", "spec", "specs"].includes(part.toLowerCase())) ||
                /(?:^|[._-])(test|spec|e2e|integ|integration)(?:[._-]|$)/i.test(baseName) ||
                analysis.test_names.length > 0;
            if (isTestFile) {
                // Create TestNode
                const testNodeId = `test:${stableId(normalizeProjectPath(relPath))}`;
                try {
                    const testNode = {
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
                    };
                    const existingTest = graph.nodes.find((node) => node.id === testNodeId);
                    if (!existingTest)
                        addNode(graph, testNode);
                    else if (nodeContentChanged(existingTest, testNode))
                        updateNode(graph, testNodeId, testNode);
                    addRelationship(graph, fileId, testNodeId, "contains", { code_intelligence: true });
                }
                catch {
                    // Node might already exist
                }
                // Test-to-requirement coverage is a deliberate specification decision;
                // filenames and test descriptions must never create a tested_by edge.
                orphanTests.push(relPath);
            }
            filesAnalyzed++;
        }
    };
    walk(projectDir);
    // Remove only nodes created by code intelligence that disappeared from the
    // current scan. Manually authored file/symbol/test nodes are preserved.
    const currentFiles = new Set(fileIds.keys());
    for (const node of [...graph.nodes]) {
        const metadata = node.metadata;
        if (node.type === "file" && metadata.analysis_source && !currentFiles.has(normalizeProjectPath(String(metadata.path || "")))) {
            removeNode(graph, node.id);
            continue;
        }
        if ((node.type === "symbol" || node.type === "test") && metadata.analysis_source) {
            const path = normalizeProjectPath(String(metadata.file_path || metadata.target || ""));
            if (!currentFiles.has(path))
                removeNode(graph, node.id);
        }
    }
    // Resolve file imports only after every file has been indexed. Unresolved
    // imports remain diagnostics instead of becoming invented relationships.
    for (const parsed of parsedFiles) {
        // Fallback/failed parsers may still provide useful symbols for inventory,
        // but their inferred edges must not drive dependency, impact or drift
        // decisions as if they were authoritative.
        if (parsed.analysis_source === "fallback" || parsed.confidence < 0.5)
            continue;
        const fromPath = normalizeProjectPath(relative(projectDir, parsed.path));
        const fromId = fileIds.get(fromPath);
        if (!fromId)
            continue;
        for (const imported of parsed.imports) {
            const target = resolveImportedFile(projectDir, parsed.path, imported.source, fileIds, moduleAliases);
            if (!target)
                continue;
            imported.resolution_status = "resolved";
            imported.resolved_path = target.path;
            try {
                addRelationship(graph, fromId, target.id, "uses", { code_intelligence: true, source: imported.source, range: imported.range, confidence: parsed.confidence });
            }
            catch (error) {
                sddDebug("analyzer", `Failed to add import relationship ${fromId}→${target.id}`);
            }
        }
    }
    const symbolLookup = new Map();
    const uniqueNames = new Map();
    for (const item of graphSymbols) {
        const filePath = normalizeProjectPath(item.filePath);
        let index = symbolLookup.get(filePath);
        if (!index) {
            index = { byQualified: new Map(), byName: new Map() };
            symbolLookup.set(filePath, index);
        }
        index.byQualified.set(item.symbol.qualified_name, item);
        if (!index.byName.has(item.symbol.name))
            index.byName.set(item.symbol.name, item);
        else
            index.byName.set(item.symbol.name, null);
        if (!uniqueNames.has(item.symbol.name))
            uniqueNames.set(item.symbol.name, item);
        else
            uniqueNames.set(item.symbol.name, null);
    }
    const importBindings = new Map();
    for (const parsed of parsedFiles) {
        const importerPath = normalizeProjectPath(relative(projectDir, parsed.path));
        const bindings = new Map();
        for (const imported of parsed.imports) {
            if (!imported.resolved_path)
                continue;
            for (const rawName of imported.names) {
                const alias = rawName.match(/^(.+?)\s+as\s+(.+)$/i);
                const importedName = alias?.[1]?.trim() || (rawName.startsWith("* as ") ? "*" : rawName.trim());
                const localName = alias?.[2]?.trim() || (rawName.startsWith("* as ") ? rawName.slice(5).trim() : rawName.trim());
                if (localName)
                    bindings.set(localName, { targetPath: normalizeProjectPath(imported.resolved_path), importedName });
            }
        }
        for (const exported of parsed.exports) {
            if (!exported.source)
                continue;
            const target = resolveImportedFile(projectDir, parsed.path, exported.source, fileIds, moduleAliases);
            if (!target)
                continue;
            if (exported.name === "*") {
                const targetIndex = symbolLookup.get(target.path);
                for (const symbol of targetIndex?.byQualified.values() || []) {
                    if (symbol.symbol.exported && !symbol.symbol.parent) {
                        bindings.set(symbol.symbol.name, { targetPath: target.path, importedName: symbol.symbol.name });
                    }
                }
            }
            else {
                bindings.set(exported.name, {
                    targetPath: target.path,
                    importedName: exported.source_name || exported.name,
                });
            }
        }
        importBindings.set(importerPath, bindings);
    }
    for (const parsed of parsedFiles) {
        if (parsed.analysis_source === "fallback" || parsed.confidence < 0.5)
            continue;
        const filePath = normalizeProjectPath(relative(projectDir, parsed.path));
        const localIndex = symbolLookup.get(filePath);
        if (!localIndex)
            continue;
        const bindings = importBindings.get(filePath) || new Map();
        for (const relation of parsed.relations) {
            const from = localIndex.byQualified.get(relation.from) || localIndex.byName.get(relation.from) ||
                (relation.type !== "calls" ? uniqueNames.get(relation.from) : undefined) || undefined;
            const to = resolveSymbolReference(relation.to, localIndex, bindings, importBindings, symbolLookup, uniqueNames, relation.type);
            if (!from || !to)
                continue;
            const type = relation.type === "implements" ? "implements" : relation.type === "calls" ? "calls" : "depends_on";
            try {
                addRelationship(graph, from.id, to.id, type, { code_intelligence: true, range: relation.range, confidence: relation.confidence, parser: parsed.parser });
            }
            catch (error) {
                sddDebug("analyzer", `Failed to add relation ${type}: ${from.id}→${to.id}`);
            }
        }
    }
    saveAstCache(projectDir, astCache);
    return { files_analyzed: filesAnalyzed, symbols_found: symbolsFound, test_requirement_links: testReqLinks, orphan_tests: orphanTests };
}
function symbolIdsHasNode(symbolIds, nodeId) {
    for (const id of symbolIds.values())
        if (id === nodeId)
            return true;
    return false;
}
function resolveSymbolReference(reference, localIndex, bindings, allBindings, indexes, uniqueNames, relationType) {
    const local = localIndex.byQualified.get(reference) || localIndex.byName.get(reference);
    if (local)
        return local;
    const parts = reference.split(".");
    const binding = bindings.get(parts[0]);
    if (binding) {
        return resolveImportedSymbol(binding, parts.slice(1), allBindings, indexes);
    }
    // Inheritance can legitimately refer to a type declared in another file;
    // calls must never fall back to a global same-name match because overloads
    // and homonyms would create false dependency edges.
    if (relationType !== "calls" || parts.length > 1)
        return uniqueNames.get(parts.at(-1) || reference) || undefined;
    return undefined;
}
function resolveImportedSymbol(binding, suffix, allBindings, indexes, visited = new Set()) {
    const key = `${binding.targetPath}:${binding.importedName}:${suffix.join(".")}`;
    if (visited.has(key))
        return undefined;
    visited.add(key);
    const targetIndex = indexes.get(binding.targetPath);
    if (targetIndex) {
        if (binding.importedName === "*") {
            const qualified = suffix.join(".");
            const namespaceTarget = targetIndex.byQualified.get(qualified) || targetIndex.byName.get(qualified);
            if (namespaceTarget)
                return namespaceTarget;
        }
        else {
            const qualified = [binding.importedName, ...suffix].join(".");
            const importedTarget = targetIndex.byQualified.get(qualified) || targetIndex.byName.get(binding.importedName);
            if (importedTarget)
                return importedTarget;
        }
    }
    const targetBindings = allBindings.get(binding.targetPath);
    const nextName = binding.importedName === "*" ? suffix[0] : binding.importedName;
    const next = nextName ? targetBindings?.get(nextName) : undefined;
    if (!next)
        return undefined;
    const nextSuffix = binding.importedName === "*" ? suffix.slice(1) : suffix;
    return resolveImportedSymbol(next, nextSuffix, allBindings, indexes, visited);
}
function nodeContentChanged(current, next) {
    const normalize = (node) => {
        const { created_at: _created, updated_at: _updated, version: _version, ...content } = node;
        return content;
    };
    return JSON.stringify(normalize(current)) !== JSON.stringify(normalize(next));
}
function normalizeProjectPath(filePath) {
    return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}
function loadModuleAliases(projectDir) {
    try {
        const config = JSON.parse(readFileSync(join(projectDir, "tsconfig.json"), "utf-8"));
        return {
            base_url: resolve(projectDir, config.compilerOptions?.baseUrl || "."),
            paths: Object.entries(config.compilerOptions?.paths || {}).map(([pattern, targets]) => ({ pattern, targets })),
        };
    }
    catch {
        return { base_url: projectDir, paths: [] };
    }
}
function resolveImportedFile(projectDir, importer, source, files, aliases) {
    const bases = [];
    if (source.startsWith("."))
        bases.push(resolve(dirname(importer), source));
    else {
        const packageName = source.startsWith("@") ? source.split("/").slice(0, 2).join("/") : source.split("/")[0];
        const subpath = source.slice(packageName.length).replace(/^\//, "");
        for (const packageDir of [join(projectDir, packageName), join(projectDir, "packages", packageName.replace("@", "")), join(projectDir, "apps", packageName.replace("@", ""))]) {
            try {
                const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf-8"));
                const target = resolvePackageExport(manifest.exports, subpath) || manifest.module || manifest.main;
                if (target)
                    bases.push(resolve(packageDir, target));
            }
            catch {
                // External dependencies are intentionally not resolved from node_modules.
            }
        }
        bases.push(resolve(aliases.base_url, source));
        if (source.includes("."))
            bases.push(resolve(aliases.base_url, source.replaceAll(".", "/")));
        for (const alias of aliases.paths) {
            const marker = alias.pattern.indexOf("*");
            const prefix = marker >= 0 ? alias.pattern.slice(0, marker) : alias.pattern;
            const suffix = marker >= 0 ? alias.pattern.slice(marker + 1) : "";
            if (!source.startsWith(prefix) || !source.endsWith(suffix))
                continue;
            const wildcard = source.slice(prefix.length, source.length - suffix.length);
            for (const target of alias.targets)
                bases.push(resolve(aliases.base_url, target.replace("*", wildcard)));
        }
    }
    const candidates = bases.flatMap((base) => [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}.py`, `${base}.go`, `${base}.rs`, `${base}.java`, `${base}.rb`, join(base, "index.ts"), join(base, "index.js")]);
    for (const candidate of candidates) {
        const relativePath = normalizeProjectPath(relative(projectDir, candidate));
        const id = files.get(relativePath);
        if (id)
            return { id, path: relativePath };
    }
    return null;
}
function resolvePackageExport(exports, subpath) {
    if (typeof exports === "string")
        return subpath ? undefined : exports;
    if (!exports || typeof exports !== "object")
        return undefined;
    const map = exports;
    const key = subpath ? `./${subpath}` : ".";
    const selected = map[key] ?? map["."];
    if (typeof selected === "string")
        return selected;
    if (selected && typeof selected === "object") {
        const conditions = selected;
        for (const condition of ["import", "default", "require", "types"]) {
            if (typeof conditions[condition] === "string")
                return conditions[condition];
        }
    }
    return undefined;
}
