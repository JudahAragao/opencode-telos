/**
 * Single source of truth for version identifiers.
 *
 * `PLUGIN_VERSION` mirrors the package.json `version` field and is kept in
 * sincronia por `scripts/sync-version.cjs` (executado automaticamente por
 * `bun run build`, and available as `bun run version:sync`). Do not edit the value
 * by hand — edit package.json and run the script.
 */

// BEGIN GENERATED: PLUGIN_VERSION (scripts/sync-version.cjs)
export const PLUGIN_VERSION = "2.7.0"
// END GENERATED: PLUGIN_VERSION

/**
 * Version of the Knowledge Graph data format in `.sdd/` (used in
 * `graph.version` and `metadata.sdd_version`). It is independent of the
 * release do plugin e evolui apenas quando o schema do grafo muda.
 */
export const GRAPH_SCHEMA_VERSION = "1.3.0"
