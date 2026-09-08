import { readFileSync, existsSync, readdirSync } from "fs";
import { join, extname, relative } from "path";
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const EXCLUDE_DIRS = ["node_modules", ".sdd", "dist", "build", ".git", ".opencode", "__pycache__"];
/**
 * Analyze a project directory to detect coding conventions.
 * Samples up to 20 files for performance.
 */
export function detectConventions(projectDir) {
    const files = sampleFiles(projectDir, 20);
    if (files.length === 0)
        return defaultConventions();
    const allContent = files.map(f => ({
        path: f.relPath,
        content: readFileSync(f.fullPath, "utf-8"),
    }));
    return {
        naming: detectNamingConventions(allContent),
        imports: detectImportConventions(allContent),
        async: detectAsyncConventions(allContent),
        structure: detectStructureConventions(projectDir, allContent),
        metadata: { filesSampled: files.length },
    };
}
function defaultConventions() {
    return {
        naming: { variables: "camelCase", functions: "camelCase", files: "kebab-case", constants: "UPPER_SNAKE_CASE" },
        imports: { style: "relative", useBarrelFiles: false, extension: "ts-only" },
        async: { style: "async-await", errorHandling: "try-catch" },
        structure: { organization: "unknown", hasIndexFiles: false, testLocation: "separate" },
        metadata: {},
    };
}
function sampleFiles(projectDir, maxFiles) {
    const result = [];
    const srcDir = join(projectDir, "src");
    const scanDir = existsSync(srcDir) ? srcDir : projectDir;
    function walk(dir) {
        if (result.length >= maxFiles)
            return;
        if (!existsSync(dir))
            return;
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (result.length >= maxFiles)
                return;
            if (EXCLUDE_DIRS.includes(entry.name))
                continue;
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            }
            else if (EXTENSIONS.includes(extname(entry.name))) {
                result.push({ fullPath, relPath: relative(projectDir, fullPath) });
            }
        }
    }
    walk(scanDir);
    return result;
}
function detectNamingConventions(files) {
    let camelCase = 0, snakeCase = 0, pascalCase = 0, upperSnake = 0;
    for (const file of files) {
        const lines = file.content.split("\n");
        for (const line of lines.slice(0, 100)) {
            // Variable declarations
            const varMatch = line.match(/(?:const|let|var)\s+(\w+)/);
            if (varMatch) {
                const name = varMatch[1];
                if (/^[A-Z][a-zA-Z0-9]+$/.test(name))
                    pascalCase++;
                else if (/^[a-z][a-zA-Z0-9]+$/.test(name))
                    camelCase++;
                else if (/^[a-z][a-z0-9_]+$/.test(name))
                    snakeCase++;
                else if (/^[A-Z][A-Z0-9_]+$/.test(name))
                    upperSnake++;
            }
        }
        // File naming
        const fileName = file.path.split("/").pop() || "";
        if (/^[a-z][a-z0-9-]+\.[tj]sx?$/.test(fileName))
            camelCase++;
        else if (/^[a-z][a-z0-9_]+\.[tj]sx?$/.test(fileName))
            snakeCase++;
    }
    const detectVar = (c, s, p) => {
        const total = c + s + p;
        if (total === 0)
            return "unknown";
        if (c / total > 0.6)
            return "camelCase";
        if (s / total > 0.6)
            return "snake_case";
        if (p / total > 0.6)
            return "PascalCase";
        return "unknown";
    };
    return {
        variables: detectVar(camelCase, snakeCase, pascalCase),
        functions: detectVar(camelCase, snakeCase, pascalCase),
        files: camelCase > snakeCase ? "camelCase" : snakeCase > camelCase ? "snake_case" : "unknown",
        constants: upperSnake > camelCase ? "UPPER_SNAKE_CASE" : "camelCase",
    };
}
function detectImportConventions(files) {
    let relativeImports = 0, absoluteImports = 0, barrelImports = 0, extensionCount = 0, totalImports = 0;
    for (const file of files) {
        const importMatches = file.content.matchAll(/(?:import|from)\s+['"]([^'"]+)['"]/g);
        for (const match of importMatches) {
            const imp = match[1];
            totalImports++;
            if (imp.startsWith("."))
                relativeImports++;
            else
                absoluteImports++;
            if (imp.endsWith("/index") || (!imp.includes("/") && !imp.startsWith(".")))
                barrelImports++;
            if (imp.endsWith(".js") || imp.endsWith(".ts"))
                extensionCount++;
        }
    }
    return {
        style: relativeImports > absoluteImports * 2 ? "relative" : absoluteImports > relativeImports * 2 ? "absolute" : "mixed",
        useBarrelFiles: barrelImports > totalImports * 0.3,
        extension: totalImports === 0 ? "unknown" : extensionCount > totalImports * 0.5 ? "always" : extensionCount > 0 ? "ts-only" : "never",
    };
}
function detectAsyncConventions(files) {
    let asyncAwait = 0, promises = 0, callbacks = 0, tryCatch = 0, resultType = 0;
    for (const file of files) {
        asyncAwait += (file.content.match(/await\s+/g) || []).length;
        promises += (file.content.match(/\.then\(/g) || []).length;
        callbacks += (file.content.match(/callback\s*\(/g) || []).length;
        tryCatch += (file.content.match(/try\s*\{/g) || []).length;
        resultType += (file.content.match(/Result<|ResultType|isOk|isErr/g) || []).length;
    }
    return {
        style: asyncAwait > promises * 2 ? "async-await" : promises > asyncAwait * 2 ? "promises" : callbacks > 5 ? "callbacks" : "mixed",
        errorHandling: tryCatch > resultType * 2 ? "try-catch" : resultType > tryCatch * 2 ? "Result" : "mixed",
    };
}
function detectStructureConventions(_projectDir, files) {
    // Check for index files
    let indexCount = 0;
    for (const file of files) {
        if (file.path.split("/").pop()?.startsWith("index."))
            indexCount++;
    }
    // Check test location
    const coLocated = files.filter(f => f.path.includes(".test.") || f.path.includes(".spec.")).length;
    const separateDir = files.filter(f => f.path.includes("/__tests__/") || f.path.includes("/test/")).length;
    // Detect organization pattern
    const pathParts = files.map(f => f.path.split("/"));
    const hasDomain = pathParts.some(p => p.length > 2 && ["domain", "models", "entities"].includes(p[1]));
    const hasFeature = pathParts.some(p => p.length > 2 && ["features", "modules", "pages"].includes(p[1]));
    const hasLayer = pathParts.some(p => p.length > 2 && ["controllers", "services", "repositories", "routes"].includes(p[1]));
    return {
        organization: hasDomain ? "domain" : hasFeature ? "feature" : hasLayer ? "layer" : "flat",
        hasIndexFiles: indexCount > files.length * 0.2,
        testLocation: coLocated > separateDir ? "co-located" : separateDir > coLocated ? "separate" : "mixed",
    };
}
/**
 * Format conventions as a readable report.
 */
export function formatConventions(c) {
    const lines = [
        "## Project Conventions",
        "",
        "### Naming",
        `- Variables: ${c.naming.variables}`,
        `- Functions: ${c.naming.functions}`,
        `- Files: ${c.naming.files}`,
        `- Constants: ${c.naming.constants}`,
        "",
        "### Imports",
        `- Style: ${c.imports.style}`,
        `- Barrel files: ${c.imports.useBarrelFiles ? "yes" : "no"}`,
        `- Extensions: ${c.imports.extension}`,
        "",
        "### Async",
        `- Style: ${c.async.style}`,
        `- Error handling: ${c.async.errorHandling}`,
        "",
        "### Structure",
        `- Organization: ${c.structure.organization}`,
        `- Index files: ${c.structure.hasIndexFiles ? "yes" : "no"}`,
        `- Test location: ${c.structure.testLocation}`,
    ];
    return lines.join("\n");
}
