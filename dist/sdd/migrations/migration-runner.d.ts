/**
 * Migration definition for opencode-telos plugin updates.
 * Each migration has a unique ID, description, and a function that applies the fix.
 */
export interface Migration {
    id: string;
    description: string;
    version: string;
    up: (projectDir: string) => MigrationResult;
}
export interface MigrationResult {
    success: boolean;
    message: string;
    files_modified?: string[];
}
/**
 * Register a migration.
 */
export declare function registerMigration(migration: Migration): void;
/**
 * Get all registered migrations.
 */
export declare function getMigrations(): Migration[];
/**
 * Load migration history.
 */
export declare function loadMigrationHistory(projectDir: string): string[];
/**
 * Save migration history.
 */
export declare function saveMigrationHistory(projectDir: string, completed: string[]): void;
/**
 * Run all pending migrations.
 * Returns the results of each migration run.
 */
export declare function runMigrations(projectDir: string): MigrationResult[];
/**
 * Check if there are pending migrations.
 */
export declare function hasPendingMigrations(projectDir: string): boolean;
