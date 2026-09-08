import { readFileSync, existsSync, readdirSync } from "fs";
import { join, relative, extname } from "path";
import { projectPath } from "../security/paths.js";
export function scanExistingProject(projectDir, options) {
    const structure = analyzeStructure(projectDir, options);
    const entryPoints = findEntryPoints(projectDir);
    const testFiles = options?.focusDirs?.length
        ? findTestFiles(projectDir).filter((f) => options.focusDirs.some((d) => f.startsWith(d)))
        : findTestFiles(projectDir);
    const docFiles = findDocFiles(projectDir);
    return {
        structure,
        entry_points: entryPoints,
        config_files: findConfigFiles(projectDir),
        test_files: testFiles,
        documentation_files: docFiles,
        summary: buildBrownfieldSummary(structure, entryPoints, findConfigFiles(projectDir)),
    };
}
function analyzeStructure(projectDir, options) {
    const dirs = [];
    const files = [];
    const languages = {};
    const frameworks = [];
    let packageManager = null;
    let totalLines = 0;
    const maxDepth = options?.maxDepth ?? 5;
    const excludeDirs = new Set(options?.excludeDirs ?? []);
    const maxFiles = options?.maxFiles ?? Infinity;
    // If focusDirs specified, only walk those; otherwise walk from root
    const roots = options?.focusDirs?.length
        ? options.focusDirs.map((d) => projectPath(projectDir, d))
        : [projectDir];
    const walk = (dir, depth = 0) => {
        if (depth > maxDepth || files.length >= maxFiles)
            return;
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (files.length >= maxFiles)
                break;
            if (entry.name.startsWith(".") || entry.name === "node_modules")
                continue;
            if (excludeDirs.has(entry.name))
                continue;
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                dirs.push(relative(projectDir, fullPath));
                walk(fullPath, depth + 1);
            }
            else {
                files.push(relative(projectDir, fullPath));
                const ext = extname(entry.name).toLowerCase();
                if (ext) {
                    languages[ext] = (languages[ext] || 0) + 1;
                }
            }
        }
    };
    for (const root of roots) {
        if (existsSync(root))
            walk(root);
    }
    if (existsSync(join(projectDir, "package.json"))) {
        packageManager = "npm";
        try {
            const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8"));
            if (pkg.dependencies) {
                for (const dep of Object.keys(pkg.dependencies)) {
                    if (dep.includes("react"))
                        frameworks.push("react");
                    if (dep.includes("vue"))
                        frameworks.push("vue");
                    if (dep.includes("angular"))
                        frameworks.push("angular");
                    if (dep.includes("express"))
                        frameworks.push("express");
                    if (dep.includes("fastify"))
                        frameworks.push("fastify");
                    if (dep.includes("next"))
                        frameworks.push("next");
                }
            }
        }
        catch {
            // skip
        }
    }
    if (existsSync(join(projectDir, "yarn.lock")))
        packageManager = "yarn";
    if (existsSync(join(projectDir, "pnpm-lock.yaml")))
        packageManager = "pnpm";
    const complexity = files.length > 100 ? "high" : files.length > 30 ? "medium" : "low";
    return {
        directories: dirs,
        files,
        languages,
        frameworks: [...new Set(frameworks)],
        package_manager: packageManager,
        total_files: files.length,
        total_lines: totalLines,
        estimated_complexity: complexity,
    };
}
function findEntryPoints(projectDir) {
    const entryPoints = [];
    const candidates = [
        "src/index.ts", "src/index.tsx", "src/index.js", "src/index.jsx",
        "src/main.ts", "src/main.tsx", "src/main.js",
        "index.ts", "index.js", "main.ts", "main.js",
        "app.ts", "app.js", "server.ts", "server.js",
        "src/App.tsx", "src/App.jsx",
    ];
    for (const candidate of candidates) {
        if (existsSync(join(projectDir, candidate))) {
            entryPoints.push(candidate);
        }
    }
    return entryPoints;
}
function findConfigFiles(projectDir) {
    const configs = [];
    const candidates = [
        "package.json", "tsconfig.json", "vite.config.ts", "vite.config.js",
        "webpack.config.js", "next.config.js", "nuxt.config.js",
        ".eslintrc.js", ".eslintrc.json", "eslint.config.js",
        ".prettierrc", ".prettierrc.json",
        "jest.config.js", "jest.config.ts", "vitest.config.ts",
        "docker-compose.yml", "Dockerfile",
        ".env", ".env.example",
    ];
    for (const candidate of candidates) {
        if (existsSync(join(projectDir, candidate))) {
            configs.push(candidate);
        }
    }
    return configs;
}
function findTestFiles(projectDir) {
    const tests = [];
    const walk = (dir) => {
        if (!existsSync(dir))
            return;
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith(".") || entry.name === "node_modules")
                continue;
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            }
            else {
                const parent = relative(fullPath, projectDir).replaceAll("\\", "/").split("/").at(-2)?.toLowerCase() || "";
                if (/(?:^|[._-])(test|spec|e2e|integ|integration)(?:[._-]|$)/i.test(entry.name) || ["test", "tests", "__tests__", "spec", "specs"].includes(parent)) {
                    tests.push(relative(projectDir, fullPath));
                }
            }
        }
    };
    walk(projectDir);
    return tests;
}
function findDocFiles(projectDir) {
    const docs = [];
    const candidates = [
        "README.md", "README", "CONTRIBUTING.md", "CHANGELOG.md",
        "docs", "documentation",
    ];
    for (const candidate of candidates) {
        if (existsSync(join(projectDir, candidate))) {
            docs.push(candidate);
        }
    }
    return docs;
}
function buildBrownfieldSummary(structure, entryPoints, _configFiles) {
    const parts = [];
    parts.push(`Project has ${structure.total_files} files across ${structure.directories.length} directories.`);
    const langList = Object.entries(structure.languages)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([ext, count]) => `${ext}(${count})`)
        .join(", ");
    if (langList)
        parts.push(`Languages: ${langList}.`);
    if (structure.frameworks.length > 0) {
        parts.push(`Frameworks: ${structure.frameworks.join(", ")}.`);
    }
    if (structure.package_manager) {
        parts.push(`Package manager: ${structure.package_manager}.`);
    }
    parts.push(`Complexity: ${structure.estimated_complexity}.`);
    if (entryPoints.length > 0) {
        parts.push(`Entry points: ${entryPoints.join(", ")}.`);
    }
    return parts.join(" ");
}
export function formatBrownfieldAnalysis(analysis) {
    const lines = [
        "## Brownfield Project Analysis",
        "",
        analysis.summary,
        "",
    ];
    if (analysis.entry_points.length > 0) {
        lines.push("### Entry Points");
        for (const ep of analysis.entry_points) {
            lines.push(`- ${ep}`);
        }
        lines.push("");
    }
    if (analysis.config_files.length > 0) {
        lines.push("### Config Files");
        for (const cf of analysis.config_files) {
            lines.push(`- ${cf}`);
        }
        lines.push("");
    }
    if (analysis.test_files.length > 0) {
        lines.push(`### Test Files (${analysis.test_files.length})`);
        for (const tf of analysis.test_files.slice(0, 10)) {
            lines.push(`- ${tf}`);
        }
        if (analysis.test_files.length > 10) {
            lines.push(`- ... and ${analysis.test_files.length - 10} more`);
        }
        lines.push("");
    }
    return lines.join("\n");
}
