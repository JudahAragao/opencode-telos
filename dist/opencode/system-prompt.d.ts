import type { KnowledgeGraph } from "../sdd/domain/types.js";
/**
 * Referência de tools GERADA a partir da taxonomia — fonte única.
 *
 * Nenhum nome de tool é escrito à mão neste documento: incluir um nome
 * depreciado no prompt fazia o modelo chamar um caminho inexistente. Como a
 * lista vem de `TOOL_TAXONOMY` e `STANDALONE_CATEGORIES`, ela acompanha
 * automaticamente qualquer remoção/adição de tool.
 */
export declare const SDD_TOOL_REFERENCE: string;
export declare const SDD_SYSTEM_PROMPT: string;
/**
 * Session prompt deliberately kept small. The complete policy remains
 * exported for documentation and targeted recovery, while operational detail
 * is supplied by tools and focused graph context only when needed.
 */
export declare const SDD_CORE_SYSTEM_PROMPT = "You operate under Spec-Driven Development (SDD).\nThe .sdd knowledge graph is the source of truth. When enforcement is enabled,\ncreate or update the specification before changing code.\n\nFor a new briefing: call sdd.discover first, use the question tool for every\nreturned question, then call sdd.update_from_answers with the original briefing\nand answers. That rebuilds the graph and creates the implementation task backlog.\nIf there are no questions, call sdd.update_from_answers with an empty answers\nobject and the briefing anyway. Then validate and inspect the graph. For a\nchange: inspect impact, create and approve a Change, update the graph, validate,\nimplement, run verification, detect drift, then complete the Change. Never\nmodify .sdd data directly.\n\nUse focused graph queries instead of guessing. Treat unconfirmed extraction as\nan assumption and ask for confirmation where it changes behaviour, security,\ncost, or architecture. Do not overwrite existing generated files without an\nexplicit approved replacement. Summarize outcomes in the user's language.";
export declare function buildSddContextPack(graph: KnowledgeGraph, currentNodeId?: string, tokenBudget?: number): string;
