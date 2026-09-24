/**
 * Fonte única de verdade para identificadores de versão.
 *
 * `PLUGIN_VERSION` espelha o campo `version` do package.json e é mantido em
 * sincronia por `scripts/sync-version.cjs` (executado automaticamente por
 * `bun run build`, e disponível como `bun run version:sync`). Não edite o valor
 * à mão — edite o package.json e rode o script.
 */
export declare const PLUGIN_VERSION = "2.4.0";
/**
 * Versão do formato de dados do Knowledge Graph em `.sdd/` (usada em
 * `graph.version` e `metadata.sdd_version`). É independente da versão de
 * release do plugin e evolui apenas quando o schema do grafo muda.
 */
export declare const GRAPH_SCHEMA_VERSION = "1.3.0";
