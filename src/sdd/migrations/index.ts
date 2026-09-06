export { 
  runMigrations, 
  hasPendingMigrations, 
  loadMigrationHistory, 
  saveMigrationHistory,
  getMigrations,
  registerMigration,
  type Migration,
  type MigrationResult 
} from "./migration-runner.js"

// Import fixes to register migrations
import { getFixes } from "./fixes.js"
getFixes()
