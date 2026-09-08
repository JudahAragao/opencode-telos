import { existsSync, readFileSync } from "fs";
import { atomicWriteFile } from "../cache/atomic.js";
import { join, dirname } from "path";
/**
 * Migration registry - all migrations are registered here.
 * ID format: YYYYMMDD_descriptive_name
 */
const MIGRATIONS = [];
/**
 * Register a migration.
 */
export function registerMigration(migration) {
    MIGRATIONS.push(migration);
}
/**
 * Get all registered migrations.
 */
export function getMigrations() {
    return [...MIGRATIONS].sort((a, b) => a.id.localeCompare(b.id));
}
/**
 * Migration history file path.
 */
function getMigrationHistoryPath(projectDir) {
    return join(projectDir, ".sdd", "migration-history.json");
}
/**
 * Load migration history.
 */
export function loadMigrationHistory(projectDir) {
    const path = getMigrationHistoryPath(projectDir);
    if (!existsSync(path))
        return [];
    try {
        const data = JSON.parse(readFileSync(path, "utf-8"));
        return data.completed || [];
    }
    catch {
        return [];
    }
}
/**
 * Save migration history.
 */
export function saveMigrationHistory(projectDir, completed) {
    const path = getMigrationHistoryPath(projectDir);
    const dir = dirname(path);
    if (!existsSync(dir)) {
        const { mkdirSync } = require("fs");
        mkdirSync(dir, { recursive: true });
    }
    atomicWriteFile(path, JSON.stringify({ completed, last_run: new Date().toISOString() }, null, 2));
}
/**
 * Run all pending migrations.
 * Returns the results of each migration run.
 */
export function runMigrations(projectDir) {
    const completed = loadMigrationHistory(projectDir);
    const pending = MIGRATIONS.filter((m) => !completed.includes(m.id));
    if (pending.length === 0) {
        return [{ success: true, message: "No pending migrations" }];
    }
    const results = [];
    const newCompleted = [...completed];
    for (const migration of pending) {
        try {
            const result = migration.up(projectDir);
            results.push(result);
            if (result.success) {
                newCompleted.push(migration.id);
            }
        }
        catch (error) {
            results.push({
                success: false,
                message: `Migration ${migration.id} failed: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }
    // Save history even if some migrations failed
    saveMigrationHistory(projectDir, newCompleted);
    return results;
}
/**
 * Check if there are pending migrations.
 */
export function hasPendingMigrations(projectDir) {
    const completed = loadMigrationHistory(projectDir);
    return MIGRATIONS.some((m) => !completed.includes(m.id));
}
