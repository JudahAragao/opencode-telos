import { readYaml, writeYaml, ensureDir, fileExists, listFiles } from "../persistence/yaml.js";
import { join } from "path";
export class TransactionManager {
    transactionsDir;
    constructor(projectDir) {
        this.transactionsDir = join(projectDir, ".sdd", "transactions");
        ensureDir(this.transactionsDir);
    }
    createTransaction(changeId) {
        const tx = {
            id: `TX-${Date.now()}`,
            change_id: changeId,
            status: "PLANNED",
            specification_changes: [],
            code_changes: [],
            test_changes: [],
            graph_changes: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        writeYaml(join(this.transactionsDir, `${tx.id}.yaml`), tx);
        return tx;
    }
    getTransaction(txId) {
        const path = join(this.transactionsDir, `${txId}.yaml`);
        if (!fileExists(path))
            return null;
        return readYaml(path);
    }
    updateTransaction(txId, updates) {
        const existing = this.getTransaction(txId);
        if (!existing)
            throw new Error(`Transaction ${txId} not found`);
        const updated = {
            ...existing,
            ...updates,
            updated_at: new Date().toISOString(),
        };
        writeYaml(join(this.transactionsDir, `${txId}.yaml`), updated);
        return updated;
    }
    advanceStatus(txId, newStatus) {
        const tx = this.getTransaction(txId);
        if (!tx)
            throw new Error(`Transaction ${txId} not found`);
        const validTransitions = {
            PLANNED: ["SPEC_UPDATED", "FAILED"],
            SPEC_UPDATED: ["IMPLEMENTING", "FAILED"],
            IMPLEMENTING: ["IMPLEMENTED", "FAILED"],
            IMPLEMENTED: ["VERIFYING", "FAILED"],
            VERIFYING: ["COMPLETED", "FAILED"],
            COMPLETED: [],
            FAILED: ["ROLLED_BACK"],
            ROLLED_BACK: [],
        };
        const allowed = validTransitions[tx.status];
        if (!allowed || !allowed.includes(newStatus)) {
            throw new Error(`Invalid transition: ${tx.status} -> ${newStatus}. Allowed: ${allowed?.join(", ") || "none"}`);
        }
        return this.updateTransaction(txId, { status: newStatus });
    }
    getActiveTransactions() {
        const files = listFiles(this.transactionsDir, ".yaml");
        const transactions = [];
        for (const file of files) {
            const tx = readYaml(file);
            if (tx.status !== "COMPLETED" && tx.status !== "ROLLED_BACK") {
                transactions.push(tx);
            }
        }
        return transactions;
    }
    getTransactionsForChange(changeId) {
        const files = listFiles(this.transactionsDir, ".yaml");
        return files
            .map((f) => readYaml(f))
            .filter((tx) => tx.change_id === changeId);
    }
}
