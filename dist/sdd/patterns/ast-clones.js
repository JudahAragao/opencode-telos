import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
export function detectAstClones(projectDir, threshold = 0.8) {
    const files = collectSourceFiles(projectDir);
    const fileContents = new Map();
    for (const file of files) {
        try {
            const content = readFileSync(file, "utf-8");
            const lines = content.split("\n");
            fileContents.set(file, lines);
        }
        catch {
            // skip unreadable files
        }
    }
    const allBlocks = [];
    for (const [file, lines] of fileContents.entries()) {
        const fileBlocks = extractBlocks(file, lines, 5);
        allBlocks.push(...fileBlocks);
    }
    const groups = findCloneGroups(allBlocks, threshold);
    let tokensInClones = 0;
    for (const g of groups) {
        tokensInClones += g.token_count;
    }
    return {
        groups,
        total_clones: groups.length,
        files_scanned: files.length,
        tokens_in_clones: tokensInClones,
        summary: buildCloneSummary(groups, files.length, tokensInClones),
    };
}
function extractBlocks(filePath, lines, minLines) {
    const blocks = [];
    const content = lines.join("\n");
    const normalized = normalizeForComparison(content);
    const normalizedLines = normalized.split("\n");
    for (let i = 0; i <= normalizedLines.length - minLines; i++) {
        const block = normalizedLines.slice(i, i + minLines);
        const trimmed = block.filter((l) => l.trim().length > 0);
        if (trimmed.length < minLines)
            continue;
        const fingerprint = blockFingerprint(trimmed);
        blocks.push({
            file: filePath,
            start_line: i + 1,
            end_line: i + minLines,
            content: lines.slice(i, i + minLines).join("\n"),
            fingerprint,
        });
    }
    return blocks;
}
function normalizeForComparison(content) {
    return content
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/import\s+.*from\s+['"].*['"]/g, "")
        .replace(/export\s+(default\s+)?/g, "")
        .replace(/const\s+/g, "var ")
        .replace(/let\s+/g, "var ")
        .replace(/\s+/g, " ")
        .trim();
}
function blockFingerprint(lines) {
    return lines.map(normalizeTokenSequence).join("|||");
}
function normalizeTokenSequence(line) {
    return line
        .replace(/["'`].*?["'`]/g, "STR")
        .replace(/\b\d+\b/g, "NUM")
        .replace(/\b[a-zA-Z_$][\w$]*\b/g, (m) => {
        if (["var", "function", "return", "if", "else", "for", "while", "class", "import", "export", "const", "let", "new", "this", "typeof", "instanceof"].includes(m)) {
            return m;
        }
        return "ID";
    });
}
function findCloneGroups(blocks, _threshold) {
    const groups = [];
    const used = new Set();
    const fingerprintMap = new Map();
    for (let i = 0; i < blocks.length; i++) {
        const fp = blocks[i].fingerprint;
        if (!fingerprintMap.has(fp))
            fingerprintMap.set(fp, []);
        fingerprintMap.get(fp).push(i);
    }
    for (const [, indices] of fingerprintMap) {
        if (indices.length < 2)
            continue;
        if (indices.every((i) => used.has(i)))
            continue;
        const groupBlocks = [];
        let totalTokens = 0;
        for (const idx of indices) {
            if (used.has(idx))
                continue;
            groupBlocks.push(blocks[idx]);
            totalTokens += blocks[idx].content.split(/\s+/).length;
        }
        if (groupBlocks.length >= 2) {
            const risk = totalTokens > 100 ? "high" : totalTokens > 30 ? "medium" : "low";
            groups.push({
                blocks: groupBlocks,
                similarity: 1.0,
                token_count: totalTokens,
                risk,
            });
            for (const idx of indices)
                used.add(idx);
        }
    }
    return groups.sort((a, b) => b.token_count - a.token_count).slice(0, 50);
}
function collectSourceFiles(dir) {
    const files = [];
    if (!existsSync(dir))
        return files;
    const walk = (d) => {
        const entries = readdirSync(d, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = join(d, entry.name);
            if (entry.isDirectory()) {
                if (!entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "dist") {
                    walk(fullPath);
                }
            }
            else if (/\.(ts|tsx|js|jsx|py|go|java|rb|rs)$/.test(entry.name)) {
                const stat = statSync(fullPath);
                if (stat.size < 100000) {
                    files.push(fullPath);
                }
            }
        }
    };
    walk(dir);
    return files;
}
function buildCloneSummary(groups, filesScanned, tokensInClones) {
    if (groups.length === 0) {
        return `No significant clones found across ${filesScanned} files.`;
    }
    const highRisk = groups.filter((g) => g.risk === "high").length;
    const mediumRisk = groups.filter((g) => g.risk === "medium").length;
    return `${groups.length} clone group(s) found across ${filesScanned} files. ` +
        `${tokensInClones} tokens in clones. ` +
        `${highRisk} high-risk, ${mediumRisk} medium-risk.`;
}
export function formatCloneReport(report) {
    const lines = [
        "## AST Clone Detection",
        report.summary,
        "",
    ];
    if (report.groups.length > 0) {
        lines.push("### Top Clone Groups");
        for (const group of report.groups.slice(0, 15)) {
            const riskEmoji = group.risk === "high" ? "🔴" : group.risk === "medium" ? "🟡" : "🔵";
            const files = [...new Set(group.blocks.map((b) => b.file))];
            lines.push(`- ${riskEmoji} **${group.blocks.length} copies** (${group.token_count} tokens) in ${files.join(", ")}`);
            if (group.blocks[0]) {
                const preview = group.blocks[0].content.split("\n").slice(0, 2).join(" ").slice(0, 80);
                lines.push(`  Preview: \`${preview}...\``);
            }
        }
    }
    return lines.join("\n");
}
