import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { sddDebug } from "../log.js";
export function detectConfigDrift(projectDir) {
    const items = [];
    checkPackageJson(projectDir, items);
    checkTsConfig(projectDir, items);
    checkEnvFiles(projectDir, items);
    checkLockFiles(projectDir, items);
    const byType = {};
    for (const item of items) {
        byType[item.type] = (byType[item.type] || 0) + 1;
    }
    return {
        items,
        total: items.length,
        by_type: byType,
    };
}
function checkPackageJson(projectDir, items) {
    const path = join(projectDir, "package.json");
    if (!existsSync(path))
        return;
    try {
        const content = JSON.parse(readFileSync(path, "utf-8"));
        const deps = { ...content.dependencies, ...content.devDependencies };
        for (const [name, version] of Object.entries(deps)) {
            if (typeof version === "string" && version.includes("^")) {
                items.push({
                    file: "package.json",
                    type: "version_mismatch",
                    description: `Dependency "${name}" uses caret range: ${version}`,
                    expected: "Pinned version",
                    actual: version,
                    severity: "info",
                });
            }
        }
        if (content.scripts) {
            for (const [name, cmd] of Object.entries(content.scripts)) {
                if (typeof cmd === "string" && cmd.includes("react-scripts")) {
                    items.push({
                        file: "package.json",
                        type: "deprecated_setting",
                        description: `Script "${name}" uses deprecated "react-scripts"`,
                        severity: "warning",
                    });
                }
            }
        }
    }
    catch {
        // skip invalid json
    }
}
function checkTsConfig(projectDir, items) {
    const path = join(projectDir, "tsconfig.json");
    if (!existsSync(path))
        return;
    try {
        const content = JSON.parse(readFileSync(path, "utf-8"));
        const compilerOptions = content.compilerOptions || {};
        if (compilerOptions.strict === false) {
            items.push({
                file: "tsconfig.json",
                type: "inconsistency",
                description: "TypeScript strict mode is disabled",
                expected: "strict: true",
                actual: "strict: false",
                severity: "warning",
            });
        }
        if (!compilerOptions.esModuleInterop) {
            items.push({
                file: "tsconfig.json",
                type: "deprecated_setting",
                description: "esModuleInterop is not enabled",
                severity: "info",
            });
        }
        // ── JSX configuration validation ──────────────────────────────
        // Check if project has .tsx files but jsx is not configured
        const hasTsxFiles = hasFilesWithExtension(projectDir, ".tsx");
        if (hasTsxFiles) {
            const jsx = compilerOptions.jsx;
            if (!jsx) {
                items.push({
                    file: "tsconfig.json",
                    type: "missing_config",
                    description: "Project contains .tsx files but 'jsx' is not configured in tsconfig.json",
                    expected: "jsx: \"react-jsx\" or jsx: \"react\"",
                    actual: "jsx: undefined",
                    severity: "error",
                });
            }
        }
        // Check for SolidJS-specific config
        const hasSolidFiles = hasFilesWithExtension(projectDir, ".tsx") &&
            (content.compilerOptions?.jsxImportSource?.includes("solid") ||
                hasFilesWithContent(projectDir, /from ["']solid-js["']/));
        if (hasSolidFiles && compilerOptions.jsx !== "preserve" && compilerOptions.jsx !== "react-jsx") {
            items.push({
                file: "tsconfig.json",
                type: "inconsistency",
                description: "SolidJS project detected but jsx config may not be compatible",
                expected: "jsx: \"preserve\" with jsxImportSource for SolidJS",
                actual: `jsx: \"${compilerOptions.jsx || "undefined"}\"`,
                severity: "warning",
            });
        }
    }
    catch {
        // skip invalid json
    }
}
/**
 * Check if a directory contains files with a specific extension.
 */
function hasFilesWithExtension(projectDir, ext) {
    try {
        const fs = require("fs");
        function walk(dir) {
            if (!fs.existsSync(dir))
                return false;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isSymbolicLink())
                    continue;
                if (entry.name === "node_modules" || entry.name === ".sdd" || entry.name === "dist")
                    continue;
                const fullPath = join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (walk(fullPath))
                        return true;
                }
                else if (entry.name.endsWith(ext)) {
                    return true;
                }
            }
            return false;
        }
        return walk(projectDir);
    }
    catch {
        return false;
    }
}
/**
 * Check if any source file matches a regex pattern.
 */
function hasFilesWithContent(projectDir, pattern) {
    try {
        const fs = require("fs");
        function walk(dir) {
            if (!fs.existsSync(dir))
                return false;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isSymbolicLink())
                    continue;
                if (entry.name === "node_modules" || entry.name === ".sdd" || entry.name === "dist")
                    continue;
                const fullPath = join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (walk(fullPath))
                        return true;
                }
                else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
                    try {
                        const content = fs.readFileSync(fullPath, "utf-8");
                        if (pattern.test(content))
                            return true;
                    }
                    catch (error) {
                        sddDebug("config-drift", `Failed to read ${fullPath}`);
                    }
                }
            }
            return false;
        }
        return walk(projectDir);
    }
    catch {
        return false;
    }
}
function checkEnvFiles(projectDir, items) {
    const envExample = join(projectDir, ".env.example");
    const envLocal = join(projectDir, ".env.local");
    if (existsSync(envExample) && existsSync(envLocal)) {
        const exampleVars = parseEnvFile(envExample);
        const localVars = parseEnvFile(envLocal);
        for (const key of exampleVars.keys()) {
            if (!localVars.has(key)) {
                items.push({
                    file: ".env.local",
                    type: "missing_config",
                    description: `Missing environment variable: ${key}`,
                    expected: key,
                    severity: "warning",
                });
            }
        }
    }
    // ── Check if source code uses env vars not in .env.example ──
    if (existsSync(envExample)) {
        const declaredVars = parseEnvFile(envExample);
        const usedVars = findEnvVarsInSource(projectDir);
        for (const varName of usedVars) {
            if (!declaredVars.has(varName) && !varName.startsWith("NODE_")) {
                items.push({
                    file: ".env.example",
                    type: "missing_config",
                    description: `Environment variable "${varName}" is used in source code but not declared in .env.example`,
                    expected: `${varName}=...`,
                    severity: "warning",
                });
            }
        }
    }
    // ── Check if lock file exists ──
    const hasPackageJson = existsSync(join(projectDir, "package.json"));
    const hasLockFile = existsSync(join(projectDir, "package-lock.json")) ||
        existsSync(join(projectDir, "yarn.lock")) ||
        existsSync(join(projectDir, "pnpm-lock.yaml"));
    if (hasPackageJson && !hasLockFile) {
        items.push({
            file: "package.json",
            type: "missing_config",
            description: "No lock file found (package-lock.json, yarn.lock, or pnpm-lock.yaml)",
            severity: "warning",
        });
    }
}
/**
 * Scan source files for process.env.XXX usage.
 */
function findEnvVarsInSource(projectDir) {
    const vars = new Set();
    try {
        const fs = require("fs");
        const path = require("path");
        const srcDir = path.join(projectDir, "src");
        if (!fs.existsSync(srcDir))
            return vars;
        const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte"];
        const EXCLUDE = ["node_modules", ".sdd", "dist", "build", ".git"];
        function walk(dir) {
            if (!fs.existsSync(dir))
                return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isSymbolicLink())
                    continue;
                if (EXCLUDE.includes(entry.name))
                    continue;
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath);
                }
                else if (EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
                    try {
                        const content = fs.readFileSync(fullPath, "utf-8");
                        const matches = content.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g);
                        for (const match of matches) {
                            vars.add(match[1]);
                        }
                    }
                    catch (error) {
                        sddDebug("config-drift", `Failed to scan env vars in ${fullPath}`);
                    }
                }
            }
        }
        walk(srcDir);
    }
    catch (error) {
        sddDebug("config-drift", `Failed to collect env vars from ${projectDir}`);
    }
    return vars;
}
function checkLockFiles(projectDir, items) {
    const hasPackageLock = existsSync(join(projectDir, "package-lock.json"));
    const hasYarnLock = existsSync(join(projectDir, "yarn.lock"));
    const hasPnpmLock = existsSync(join(projectDir, "pnpm-lock.yaml"));
    const lockCount = [hasPackageLock, hasYarnLock, hasPnpmLock].filter(Boolean).length;
    if (lockCount > 1) {
        items.push({
            file: "root",
            type: "inconsistency",
            description: "Multiple lock files found (package-lock.json, yarn.lock, pnpm-lock.yaml)",
            severity: "warning",
        });
    }
}
function parseEnvFile(path) {
    const vars = new Map();
    try {
        const content = readFileSync(path, "utf-8");
        for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#")) {
                const eqIndex = trimmed.indexOf("=");
                if (eqIndex > 0) {
                    const key = trimmed.slice(0, eqIndex).trim();
                    vars.set(key, trimmed.slice(eqIndex + 1).trim());
                }
            }
        }
    }
    catch {
        // skip
    }
    return vars;
}
export function formatConfigDriftReport(report) {
    const lines = [
        `## Config Drift (${report.total} items)`,
        "",
    ];
    if (report.total === 0) {
        lines.push("✅ No config drift detected.");
        return lines.join("\n");
    }
    for (const [type, count] of Object.entries(report.by_type)) {
        lines.push(`- **${type}**: ${count}`);
    }
    lines.push("");
    for (const item of report.items) {
        const severity = item.severity === "error" ? "🔴" : item.severity === "warning" ? "🟡" : "🔵";
        lines.push(`${severity} **${item.file}**: ${item.description}`);
    }
    return lines.join("\n");
}
