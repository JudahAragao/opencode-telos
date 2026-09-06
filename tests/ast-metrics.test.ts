import { describe, expect, test } from "bun:test"
import { evaluateParsedFile } from "../src/code-intelligence/ast/metrics.js"
import { parseSourceFile } from "../src/code-intelligence/ast/registry.js"

describe("AST quality metrics", () => {
  test("reports precision and recall against a fixture expectation", () => {
    const parsed = parseSourceFile("sample.py", "class Account:\n    def load(self): pass\n")
    const report = evaluateParsedFile(parsed, {
      symbols: ["Account", "Account.load"],
      imports: [],
    })
    expect(report.symbols.precision).toBe(1)
    expect(report.symbols.recall).toBe(1)
    expect(report.source).toBe("ast")
  })
})

