import type { Transaction } from "../domain/types.js";
import type { KnowledgeGraph } from "../domain/types.js";
export declare class TransactionManager {
    private transactionsDir;
    constructor(projectDir: string);
    createTransaction(changeId: string, transactionId?: string): Transaction;
    getTransaction(txId: string): Transaction | null;
    updateTransaction(txId: string, updates: Partial<Transaction>): Transaction;
    advanceStatus(txId: string, newStatus: Transaction["status"]): Transaction;
    getActiveTransactions(): Transaction[];
    getTransactionsForChange(changeId: string): Transaction[];
}
/**
 * Reconcile legacy graphs where Change.metadata.transaction_id was generated
 * independently from the transaction file (or where the file was never
 * created). The operation is idempotent and preserves existing transaction
 * history.
 */
export declare function reconcileChangeTransactions(projectDir: string, graph: KnowledgeGraph): boolean;
