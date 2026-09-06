import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { parseSourceFile } from "../src/code-intelligence/ast/registry.js"

const fixtures = join(import.meta.dir, "fixtures", "ast")
const fixture = (language: string, file: string): string => readFileSync(join(fixtures, language, file), "utf-8")

describe("AST language adapters", () => {
  test("normalizes TypeScript and JavaScript declarations", () => {
    const ts = parseSourceFile("sample.ts", fixture("typescript", "sample.ts"))
    const js = parseSourceFile("sample.js", fixture("javascript", "sample.js"))
    expect(ts.analysis_source).toBe("ast")
    expect(ts.symbols.some((symbol) => symbol.kind === "interface" && symbol.name === "Account")).toBe(true)
    expect(ts.symbols.some((symbol) => symbol.qualified_name === "AccountService.load")).toBe(true)
    expect(ts.imports[0]?.source).toBe("./helper")
    expect(js.symbols.some((symbol) => symbol.name === "createAccount")).toBe(true)
  })

  test("parses Tree-sitter languages with qualified symbols", () => {
    const cases = [
      ["python", "sample.py", "Account.load"],
      ["go", "sample.go", "Account.Load"],
      ["rust", "sample.rs", "Account.load"],
      ["java", "Sample.java", "Account.load"],
      ["ruby", "sample.rb", "Billing.Account.load"],
    ] as const
    for (const [language, file, symbol] of cases) {
      const parsed = parseSourceFile(file, fixture(language, file))
      expect(parsed.analysis_source).toBe("ast")
      expect(parsed.symbols.some((item) => item.qualified_name === symbol)).toBe(true)
      expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toHaveLength(0)
    }
  })

  test("parses Vue and Svelte script blocks without losing source offsets", () => {
    const vue = parseSourceFile("sample.vue", fixture("vue", "sample.vue"))
    const svelte = parseSourceFile("sample.svelte", fixture("svelte", "sample.svelte"))
    expect(vue.language).toBe("vue")
    expect(vue.symbols.some((symbol) => symbol.name === "account")).toBe(true)
    expect(svelte.language).toBe("svelte")
    expect(svelte.symbols.some((symbol) => symbol.name === "account")).toBe(true)
    expect(svelte.symbols.every((symbol) => symbol.range.start.line >= 1)).toBe(true)
  })
})
