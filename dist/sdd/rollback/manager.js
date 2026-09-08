import { getNode, updateNode } from "../graph/engine.js";
import { execFileSync } from "child_process";
import { readFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { createHash } from "crypto";
import { atomicWriteFile } from "../cache/atomic.js";
import { projectPath } from "../security/paths.js";
const SNAPSHOTS_DIR = ".sdd/snapshots";
const BACKUPS_DIR = ".sdd/backups";
const ROLLBACK_HISTORY_FILE = ".sdd/rollback-history.json";
export function createSnapshot(graph, changeId, projectDir) {
    const snapshotId = `snap_${Date.now()}`;
    const snapshot = {
        id: snapshotId,
        change_id: changeId,
        timestamp: new Date().toISOString(),
        graph_state: JSON.parse(JSON.stringify(graph)),
        backed_up_files: [],
    };
    const change = getNode(graph, changeId);
    if (change && change.metadata.affected_files) {
        const backupDir = join(projectDir, BACKUPS_DIR, snapshotId);
        if (!existsSync(backupDir))
            mkdirSync(backupDir, { recursive: true });
        for (const file of change.metadata.affected_files) {
            const fullPath = projectPath(projectDir, file);
            if (existsSync(fullPath)) {
                const safeName = `${file.replace(/\//g, "_")}-${createHash("sha256").update(file).digest("hex").slice(0, 10)}`;
                const backupPath = join(backupDir, safeName);
                try {
                    copyFileSync(fullPath, backupPath);
                    snapshot.backed_up_files.push({ path: file, backup_path: backupPath });
                }
                catch {
                    // skip files that can't be copied
                }
            }
        }
    }
    const snapshotsDir = join(projectDir, SNAPSHOTS_DIR);
    if (!existsSync(snapshotsDir))
        mkdirSync(snapshotsDir, { recursive: true });
    atomicWriteFile(join(snapshotsDir, `${snapshotId}.json`), JSON.stringify(snapshot, null, 2));
    return snapshot;
}
export function rollbackByGit(projectDir, changeId, options) {
    try {
        const commitHash = findCommitForChange(projectDir, changeId, options?.commitCache);
        if (!commitHash) {
            return { success: false, method: "git", details: "No commit found for this change" };
        }
        if (!/^[0-9a-f]{7,64}$/i.test(commitHash)) {
            return { success: false, method: "git", details: "Invalid commit hash" };
        }
        execFileSync("git", ["revert", commitHash, "--no-edit"], {
            cwd: projectDir,
            encoding: "utf-8",
            timeout: 30000,
        });
        return {
            success: true,
            method: "git",
            details: `Successfully reverted commit ${commitHash}`,
        };
    }
    catch (error) {
        return {
            success: false,
            method: "git",
            details: `Git revert failed: ${error instanceof Error ? error.message : "unknown"}`,
        };
    }
}
export function rollbackBySnapshot(graph, changeId, projectDir, options) {
    const snapshot = findSnapshot(projectDir, changeId, options);
    if (!snapshot) {
        return { success: false, method: "snapshot", details: "No snapshot found for this change" };
    }
    const restoredFiles = [];
    const failedFiles = [];
    for (const backedUp of snapshot.backed_up_files) {
        const backupPath = projectPath(projectDir, backedUp.backup_path);
        if (existsSync(backupPath)) {
            const fullPath = projectPath(projectDir, backedUp.path, true);
            const dir = dirname(fullPath);
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            try {
                copyFileSync(backupPath, fullPath);
                restoredFiles.push(backedUp.path);
            }
            catch {
                failedFiles.push(backedUp.path);
            }
        }
        else {
            failedFiles.push(backedUp.path);
        }
    }
    if (snapshot.backed_up_files.length === 0 || failedFiles.length > 0) {
        return {
            success: false,
            method: "snapshot",
            details: `Snapshot restore incomplete: ${failedFiles.length} file(s) could not be restored`,
            restored_files: restoredFiles,
        };
    }
    const change = getNode(graph, changeId);
    if (change) {
        change.status = "ROLLED_BACK";
        const metadata = change.metadata;
        metadata.rollback_snapshot = snapshot.id;
        metadata.rollback_at = new Date().toISOString();
        updateNode(graph, changeId, {
            status: "ROLLED_BACK",
            metadata,
        });
    }
    return {
        success: true,
        method: "snapshot",
        details: `Restored from snapshot ${snapshot.id}`,
        restored_files: restoredFiles,
    };
}
export function rollbackByBackup(_graph, changeId, projectDir, options) {
    const snapshot = findSnapshot(projectDir, changeId, options);
    if (!snapshot) {
        return { success: false, method: "backup", details: "No backup found for this change" };
    }
    const restoredFiles = [];
    const failedFiles = [];
    for (const backedUp of snapshot.backed_up_files) {
        const backupPath = projectPath(projectDir, backedUp.backup_path);
        if (existsSync(backupPath)) {
            const fullPath = projectPath(projectDir, backedUp.path, true);
            const dir = dirname(fullPath);
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            try {
                copyFileSync(backupPath, fullPath);
                restoredFiles.push(backedUp.path);
            }
            catch {
                failedFiles.push(backedUp.path);
            }
        }
        else {
            failedFiles.push(backedUp.path);
        }
    }
    if (snapshot.backed_up_files.length === 0 || failedFiles.length > 0) {
        return {
            success: false,
            method: "backup",
            details: `Backup restore incomplete: ${failedFiles.length} file(s) could not be restored`,
            restored_files: restoredFiles,
        };
    }
    return {
        success: true,
        method: "backup",
        details: `Restored ${restoredFiles.length} files from backup`,
        restored_files: restoredFiles,
    };
}
export function executeRollback(graph, changeId, projectDir, options) {
    let result = rollbackByGit(projectDir, changeId, options);
    if (result.success) {
        recordRollback(projectDir, changeId, result);
        return result;
    }
    result = rollbackBySnapshot(graph, changeId, projectDir, options);
    if (result.success) {
        recordRollback(projectDir, changeId, result);
        return result;
    }
    result = rollbackByBackup(graph, changeId, projectDir, options);
    if (result.success) {
        recordRollback(projectDir, changeId, result);
        return result;
    }
    result = { success: false, method: "failed", details: "All rollback methods failed" };
    recordRollback(projectDir, changeId, result);
    return result;
}
function findCommitForChange(projectDir, changeId, commitCache) {
    // Fast path: use cache
    if (commitCache?.has(changeId))
        return commitCache.get(changeId);
    let result = null;
    try {
        const log = execFileSync("git", ["log", "--all", "--oneline", `--grep=${changeId}`], {
            cwd: projectDir,
            encoding: "utf-8",
            timeout: 10000,
        }).trim();
        if (log) {
            const firstLine = log.split("\n")[0];
            result = firstLine.split(" ")[0];
        }
    }
    catch {
        // git not available or no matching commit
    }
    commitCache?.set(changeId, result);
    return result;
}
function findSnapshot(projectDir, changeId, options) {
    // Fast path: use index
    if (options?.snapshotIndex?.has(changeId)) {
        const snapshotId = options.snapshotIndex.get(changeId);
        const snapshotPath = projectPath(projectDir, `${SNAPSHOTS_DIR}/${encodeURIComponent(snapshotId)}.json`);
        if (existsSync(snapshotPath)) {
            try {
                return JSON.parse(readFileSync(snapshotPath, "utf-8"));
            }
            catch { /* skip */ }
        }
    }
    const snapshotsDir = join(projectDir, SNAPSHOTS_DIR);
    if (!existsSync(snapshotsDir))
        return null;
    const files = readdirSync(snapshotsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
        try {
            const snapshot = JSON.parse(readFileSync(join(snapshotsDir, file), "utf-8"));
            if (snapshot.change_id === changeId) {
                options?.snapshotIndex?.set(snapshot.change_id, snapshot.id);
                return snapshot;
            }
        }
        catch {
            // skip
        }
    }
    return null;
}
function recordRollback(projectDir, changeId, result) {
    const history = loadRollbackHistory(projectDir);
    history.rollbacks.push({
        id: `rb_${Date.now()}`,
        change_id: changeId,
        timestamp: new Date().toISOString(),
        method: result.method,
        success: result.success,
    });
    saveRollbackHistory(projectDir, history);
}
export function loadRollbackHistory(projectDir) {
    const path = join(projectDir, ROLLBACK_HISTORY_FILE);
    if (!existsSync(path))
        return { rollbacks: [] };
    try {
        return JSON.parse(readFileSync(path, "utf-8"));
    }
    catch {
        return { rollbacks: [] };
    }
}
function saveRollbackHistory(projectDir, history) {
    const path = join(projectDir, ROLLBACK_HISTORY_FILE);
    const dir = dirname(path);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    atomicWriteFile(path, JSON.stringify(history, null, 2));
}
export function formatRollbackResult(result) {
    const lines = [
        "## Rollback Result",
        "",
        `- **Success:** ${result.success ? "✅ Yes" : "❌ No"}`,
        `- **Method:** ${result.method}`,
        `- **Details:** ${result.details}`,
    ];
    if (result.restored_files && result.restored_files.length > 0) {
        lines.push("\n### Restored Files");
        for (const file of result.restored_files) {
            lines.push(`- ${file}`);
        }
    }
    return lines.join("\n");
}
export function formatRollbackHistory(history) {
    const lines = [
        "## Rollback History",
        "",
    ];
    if (history.rollbacks.length === 0) {
        lines.push("No rollbacks recorded.");
        return lines.join("\n");
    }
    for (const rb of history.rollbacks) {
        const status = rb.success ? "✅" : "❌";
        lines.push(`- ${status} **${rb.change_id}** (${rb.method}) at ${rb.timestamp}`);
    }
    return lines.join("\n");
}
