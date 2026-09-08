/**
 * Graph State Snapshot — Captura o estado do grafo para decisão de visibilidade de tools.
 *
 * Cache por sessão invalidado por fingerprint criptográfico do armazenamento.
 *
 * Consumido por: state-gate.ts, hooks.ts
 */
export type GraphState = "error" | "uninitialized" | "empty" | "partial" | "ready" | "has_change" | "has_approved_change" | "emergency";
export interface GraphSnapshot {
    state: GraphState;
    nodeCount: number;
    relationshipCount: number;
    nodeTypes: string[];
    hasSpecNodes: boolean;
    hasChanges: boolean;
    pendingChangeCount: number;
    approvedChangeCount: number;
    hasWorkflow: boolean;
    /** Timestamp de criação do snapshot */
    timestamp: number;
}
/**
 * Captura o estado atual do grafo (com cache).
 * O cache só é reutilizado quando o conteúdo persistido não mudou.
 */
export declare function getGraphSnapshot(directory: string): GraphSnapshot;
/**
 * Força refresh do cache (após mutações no grafo).
 */
export declare function invalidateSnapshotCache(): void;
/**
 * Descrição legível do estado para debugging.
 */
export declare function formatGraphState(snapshot: GraphSnapshot): string;
