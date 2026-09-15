import type { KnowledgeGraph, ChangeNode, ApprovalLevel, AnyNode, SpecPromise } from "../domain/types.js";
export interface ChangeProposal {
    title: string;
    reason: string;
    affected_node_ids: string[];
    new_nodes: Partial<AnyNode>[];
    modified_nodes: Array<{
        id: string;
        updates: Partial<AnyNode>;
    }>;
    removed_node_ids: string[];
    affected_files: string[];
    affected_tests: string[];
    implementation_tasks: string[];
    /**
     * Declaração explícita de que o Change não altera comportamento especificado.
     * Sem isso (e sem requisito afetado) a evidência funcional não é avaliável e
     * a conclusão do Change fica bloqueada.
     */
    no_requirement_impact?: boolean;
    /** Auditoria de aprovação sem `affected_files` declarados. */
    files_scope_acknowledged?: boolean;
}
export declare function classifyApprovalLevel(proposal: ChangeProposal, graph: KnowledgeGraph): ApprovalLevel;
export interface ChangeCreationOptions {
    /** Skip impact analysis entirely (faster for simple changes). */
    skipImpactAnalysis?: boolean;
    /** Cache for impact results (nodeId → impacted nodes). Reused across calls. */
    impactCache?: Map<string, AnyNode[]>;
    /** Max depth for impact traversal (default: 3). */
    maxImpactDepth?: number;
    /** Only compute impact for these node IDs (ignore others). */
    focusAffectedNodes?: string[];
    /** Cache for promise extraction results. */
    promiseCache?: Map<string, SpecPromise[]>;
}
export declare function createChange(graph: KnowledgeGraph, proposal: ChangeProposal, options?: ChangeCreationOptions): ChangeNode;
export declare function approveChange(graph: KnowledgeGraph, changeId: string): void;
export interface CompletionCheckResult {
    allowed: boolean;
    reason: string;
    pending_promises: Array<{
        id: string;
        description: string;
        source_node_id: string;
    }>;
}
export interface ChangePreflight {
    /** Impedimentos que tornam o Change inutilizável se não forem corrigidos. */
    blockers: string[];
    /** Pontos que degradam a trava mas ainda permitem seguir. */
    warnings: string[];
}
/**
 * Preflight de escopo do Change (G3).
 *
 * Cobre o buraco que deixava o fluxo travar *depois* de o agente já ter criado
 * o Change: sem `affected_files` o hook de escrita nunca libera nenhum arquivo
 * (Write/Edit respondem "not covered by an approved SDD Change"), e sem
 * requisito afetado (ou `no_requirement_impact`) a evidência funcional fica
 * inavaliável. Ambos são detectáveis no momento da criação/aprovação — melhor
 * avisar aí do que descobrir no meio da implementação.
 */
export declare function preflightChangeScope(graph: KnowledgeGraph, changeId: string): ChangePreflight;
/**
 * Evidência de spec na conclusão (G7).
 *
 * Um Change que não toca nenhum nó do grafo não tem como provar que a
 * implementação corresponde à especificação: ele passaria pela trava apenas com
 * "a suíte está verde". Exige vínculo com o grafo ou uma declaração explícita
 * de que não há impacto em comportamento especificado.
 */
export declare function checkSpecEvidence(graph: KnowledgeGraph, changeId: string): CompletionCheckResult;
/**
 * Check if a change can be completed. Blocks if there are pending promises
 * on nodes affected by the change that haven't been verified.
 */
export declare function checkChangeCompletion(graph: KnowledgeGraph, changeId: string, options?: Pick<ChangeCreationOptions, 'promiseCache' | 'focusAffectedNodes'>): CompletionCheckResult;
export declare function completeChange(graph: KnowledgeGraph, changeId: string): void;
/**
 * Complete a change with promise validation. Returns a result indicating
 * whether the completion was allowed or blocked by pending promises.
 */
export declare function completeChangeWithPromiseCheck(graph: KnowledgeGraph, changeId: string, force?: boolean): {
    completed: boolean;
    result: CompletionCheckResult;
};
export declare function failChange(graph: KnowledgeGraph, changeId: string, reason: string): void;
export declare function getPendingChanges(graph: KnowledgeGraph): ChangeNode[];
export declare function getChangeHistory(graph: KnowledgeGraph): ChangeNode[];
export declare function formatImpactReport(graph: KnowledgeGraph, changeId: string): string;
