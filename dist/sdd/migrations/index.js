export { runMigrations, hasPendingMigrations, loadMigrationHistory, saveMigrationHistory, getMigrations, registerMigration } from "./migration-runner.js";
// Import fixes to register migrations
import { getFixes } from "./fixes.js";
getFixes();
// Rastreabilidade: backfill de grafos existentes (inferência + inversos + milestones)
import { registerRelationshipBackfill } from "./relationship-backfill.js";
registerRelationshipBackfill();
