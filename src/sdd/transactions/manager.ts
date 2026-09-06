import type { Transaction } from "../domain/types.js"
import { readYaml, writeYaml, ensureDir, fileExists, listFiles } from "../persistence/yaml.js"
import { join } from "path"

export class TransactionManager {
  private transactionsDir: string

  constructor(projectDir: string) {
    this.transactionsDir = join(projectDir, ".sdd", "transactions")
    ensureDir(this.transactionsDir)
  }

  createTransaction(changeId: string): Transaction {
    const tx: Transaction = {
      id: `TX-${Date.now()}`,
      change_id: changeId,
      status: "PLANNED",
      specification_changes: [],
      code_changes: [],
      test_changes: [],
      graph_changes: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    writeYaml(join(this.transactionsDir, `${tx.id}.yaml`), tx)
    return tx
  }

  getTransaction(txId: string): Transaction | null {
    const path = join(this.transactionsDir, `${txId}.yaml`)
    if (!fileExists(path)) return null
    return readYaml<Transaction>(path)
  }

  updateTransaction(txId: string, updates: Partial<Transaction>): Transaction {
    const existing = this.getTransaction(txId)
    if (!existing) throw new Error(`Transaction ${txId} not found`)
    const updated = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString(),
    }
    writeYaml(join(this.transactionsDir, `${txId}.yaml`), updated)
    return updated
  }

  advanceStatus(
    txId: string,
    newStatus: Transaction["status"],
  ): Transaction {
    const tx = this.getTransaction(txId)
    if (!tx) throw new Error(`Transaction ${txId} not found`)

    const validTransitions: Record<string, string[]> = {
      PLANNED: ["SPEC_UPDATED", "FAILED"],
      SPEC_UPDATED: ["IMPLEMENTING", "FAILED"],
      IMPLEMENTING: ["IMPLEMENTED", "FAILED"],
      IMPLEMENTED: ["VERIFYING", "FAILED"],
      VERIFYING: ["COMPLETED", "FAILED"],
      COMPLETED: [],
      FAILED: ["ROLLED_BACK"],
      ROLLED_BACK: [],
    }

    const allowed = validTransitions[tx.status]
    if (!allowed || !allowed.includes(newStatus)) {
      throw new Error(
        `Invalid transition: ${tx.status} -> ${newStatus}. Allowed: ${allowed?.join(", ") || "none"}`,
      )
    }

    return this.updateTransaction(txId, { status: newStatus })
  }

  getActiveTransactions(): Transaction[] {
    const files = listFiles(this.transactionsDir, ".yaml")
    const transactions: Transaction[] = []
    for (const file of files) {
      const tx = readYaml<Transaction>(file)
      if (tx.status !== "COMPLETED" && tx.status !== "ROLLED_BACK") {
        transactions.push(tx)
      }
    }
    return transactions
  }

  getTransactionsForChange(changeId: string): Transaction[] {
    const files = listFiles(this.transactionsDir, ".yaml")
    return files
      .map((f) => readYaml<Transaction>(f))
      .filter((tx) => tx.change_id === changeId)
  }
}
