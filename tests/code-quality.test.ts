import { describe, it, expect } from "bun:test"
import { analyzeComplexity, formatComplexityReport } from "../src/sdd/code-quality/complexity"
import { analyzeMetrics, formatMetricsReport } from "../src/sdd/code-quality/metrics"
import { detectCodeSmells, formatCodeSmellReport } from "../src/sdd/code-quality/smells"
import { analyzeDependencies, formatDependencyReport } from "../src/sdd/code-quality/dependencies"
import type { KnowledgeGraph } from "../src/sdd/domain/types"

const testCode = `
function simpleFunction() {
  return 42
}

function complexFunction(a: number, b: number, c: number, d: number, e: number, f: number) {
  if (a > 0) {
    for (let i = 0; i < b; i++) {
      if (c > d) {
        while (e > f) {
          e--
        }
      }
    }
  }
  return a + b + c + d + e + f
}

class GodClass {
  private prop1: string
  private prop2: number
  private prop3: boolean
  private prop4: string[]
  private prop5: Record<string, unknown>
  private prop6: number[]
  private prop7: string
  private prop8: number
  private prop9: boolean
  private prop10: string[]
  private prop11: Record<string, unknown>
  private prop12: number[]

  constructor() {
    this.prop1 = ""
    this.prop2 = 0
    this.prop3 = false
    this.prop4 = []
    this.prop5 = {}
    this.prop6 = []
    this.prop7 = ""
    this.prop8 = 0
    this.prop9 = false
    this.prop10 = []
    this.prop11 = {}
    this.prop12 = []
  }

  method1() {}
  method2() {}
  method3() {}
  method4() {}
  method5() {}
  method6() {}
  method7() {}
  method8() {}
  method9() {}
  method10() {}
  method11() {}
  method12() {}
}

function switchStatement(x: number) {
  switch (x) {
    case 1:
      return "one"
    case 2:
      return "two"
    case 3:
      return "three"
    case 4:
      return "four"
    case 5:
      return "five"
    default:
      return "unknown"
  }
}
`

describe("Code Quality Analysis", () => {
  describe("Complexity Analysis", () => {
    it("should analyze complexity correctly", () => {
      const report = analyzeComplexity(testCode, "test.ts")
      
      expect(report.functions.length).toBeGreaterThan(0)
      expect(report.summary.total_functions).toBeGreaterThan(0)
      expect(report.summary.average_cyclomatic).toBeGreaterThan(0)
      expect(formatComplexityReport(report)).toContain("Relatório de Complexidade")
    })

    it("should detect high risk functions", () => {
      const report = analyzeComplexity(testCode, "test.ts")
      
      // Check if any function has medium or higher risk
      const mediumOrHigherRisk = report.functions.filter(f => f.risk === "medium" || f.risk === "high" || f.risk === "very_high")
      expect(mediumOrHigherRisk.length).toBeGreaterThan(0)
    })
  })

  describe("Metrics Analysis", () => {
    it("should calculate metrics correctly", () => {
      const report = analyzeMetrics(testCode, "test.ts")
      
      expect(report.functions.length).toBeGreaterThan(0)
      expect(report.file_summary.total_lines).toBeGreaterThan(0)
      expect(report.issues.length).toBeGreaterThan(0)
      expect(formatMetricsReport(report)).toContain("Métricas de Código")
    })

    it("should detect long parameter lists", () => {
      const report = analyzeMetrics(testCode, "test.ts")
      
      const longParams = report.issues.filter(i => i.type === "long_parameter_list")
      expect(longParams.length).toBeGreaterThan(0)
    })
  })

  describe("Code Smells Detection", () => {
    it("should detect code smells", () => {
      const report = detectCodeSmells(testCode, "test.ts")
      
      expect(report.smells.length).toBeGreaterThan(0)
      expect(report.summary.total_smells).toBeGreaterThan(0)
      expect(formatCodeSmellReport(report)).toContain("Detecção de Code Smells")
    })

    it("should detect god class", () => {
      const report = detectCodeSmells(testCode, "test.ts")
      
      const godClass = report.smells.filter(s => s.type === "god_class")
      expect(godClass.length).toBeGreaterThan(0)
    })

    it("should detect switch statements", () => {
      const report = detectCodeSmells(testCode, "test.ts")
      
      const switchStatements = report.smells.filter(s => s.type === "switch_statement")
      expect(switchStatements.length).toBeGreaterThan(0)
    })
  })

  describe("Dependency Analysis", () => {
    it("should analyze dependencies", () => {
      const graph: KnowledgeGraph = {
        version: "1.0.0",
        nodes: [
          { id: "node1", type: "requirement", name: "Req 1", data: {} },
          { id: "node2", type: "component", name: "Comp 1", data: {} },
          { id: "node3", type: "component", name: "Comp 2", data: {} },
        ],
        relationships: [
          { from: "node1", to: "node2", type: "depends_on" },
          { from: "node2", to: "node3", type: "uses" },
        ],
      }

      const report = analyzeDependencies(graph)
      
      expect(report.nodes.length).toBe(3)
      expect(report.summary.total_nodes).toBe(3)
      expect(report.summary.total_dependencies).toBe(2)
      expect(formatDependencyReport(report)).toContain("Análise de Dependências")
    })

    it("should detect circular dependencies", () => {
      const graph: KnowledgeGraph = {
        version: "1.0.0",
        nodes: [
          { id: "node1", type: "component", name: "A", data: {} },
          { id: "node2", type: "component", name: "B", data: {} },
        ],
        relationships: [
          { from: "node1", to: "node2", type: "depends_on" },
          { from: "node2", to: "node1", type: "depends_on" },
        ],
      }

      const report = analyzeDependencies(graph)
      
      expect(report.cycles.length).toBeGreaterThan(0)
    })
  })
})