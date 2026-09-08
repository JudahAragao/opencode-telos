import type { Transaction } from "../domain/types.js";
export declare class TransactionManager {
    private transactionsDir;
    constructor(projectDir: string);
    createTransaction(changeId: string): Transaction;
    getTransaction(txId: string): Transaction | null;
    updateTransaction(txId: string, updates: Partial<Transaction>): Transaction;
    advanceStatus(txId: string, newStatus: Transaction["status"]): Transaction;
    getActiveTransactions(): Transaction[];
    getTransactionsForChange(changeId: string): Transaction[];
}
