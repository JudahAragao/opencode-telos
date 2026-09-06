import type { KnowledgeGraph, RequirementNode } from "../domain/types.js"
import { getNodesByType } from "../graph/engine.js"
import { getExclusionSets, isNodeExcludedOrDeprecated } from "../drift/exclusion.js"

export interface CoverageItem {
  requirement_id: string
  requirement_name: string
  test_id?: string
  test_name?: string
  coverage_type: "full" | "partial" | "none"
  covered_aspects: string[]
  missing_aspects: string[]
}

export interface OrphanTest {
  test_id: string
  test_name: string
  test_path?: string
  inferred_requirement_id?: string
  inferred_by?: string
}

export interface CoverageReport {
  items: CoverageItem[]
  orphan_tests: OrphanTest[]
  total_requirements: number
  covered_count: number
  partial_count: number
  uncovered_count: number
  coverage_rate: number
  gaps: string[]
}

/**
 * Options for controlling coverage analysis scope.
 */
export interface CoverageAnalysisOptions {
  /** Only check these specific requirement IDs. */
  focusRequirements?: string[]
  /** Only check these aspects (e.g., ["security", "performance"]). */
  focusAspects?: string[]
  /** Skip these test IDs. */
  excludeTests?: string[]
  /** Skip these requirement IDs. */
  excludeRequirements?: string[]
  /** Only check requirements whose name/description contains these keywords. */
  focusKeywords?: string[]
  /** Maximum items to report. */
  maxResults?: number
}

export function calculateCoverage(
  graph: KnowledgeGraph,
  options?: CoverageAnalysisOptions,
): CoverageReport {
  const { removed, deprecated } = getExclusionSets(graph)
  const excludeReqSet = new Set(options?.excludeRequirements || [])
  const excludeTestSet = new Set(options?.excludeTests || [])
  let requirements = getNodesByType<RequirementNode>(graph, "requirement")
    .filter((r) => !isNodeExcludedOrDeprecated(r.id, r.status, removed, deprecated))
    .filter((r) => !excludeReqSet.has(r.id))

  // Apply focus filters
  if (options?.focusRequirements?.length) {
    const focusSet = new Set(options.focusRequirements)
    requirements = requirements.filter(r => focusSet.has(r.id))
  }
  if (options?.focusKeywords?.length) {
    requirements = requirements.filter(r => {
      const text = `${r.name} ${r.description || ''}`.toLowerCase()
      return options.focusKeywords!.some(kw => text.includes(kw.toLowerCase()))
    })
  }

  const items: CoverageItem[] = []
  const gaps: string[] = []

  // Find orphan tests (tests not linked to any requirement)
  const allTests = graph.nodes.filter((n) => n.type === "test" && !excludeTestSet.has(n.id))
  const testedReqIds = new Set(
    graph.relationships
      .filter((r) => r.type === "tested_by")
      .map((r) => r.to)
  )
  const orphanTests: OrphanTest[] = allTests
    .filter((t) => !testedReqIds.has(t.id))
    .map((t) => {
      const inferred = inferRequirementFromTest(t, requirements, graph)
      return {
        test_id: t.id,
        test_name: t.name,
        test_path: (t.metadata as any)?.target,
        inferred_requirement_id: inferred?.requirement_id,
        inferred_by: inferred?.method,
      }
    })

  for (const req of requirements) {
    const testIds = graph.relationships
      .filter((r) => r.from === req.id && r.type === "tested_by")
      .map((r) => r.to)
      .filter(id => !excludeTestSet.has(id))

    const tests = testIds
      .map((id) => graph.nodes.find((n) => n.id === id))
      .filter(Boolean)

    let aspects = extractAspects(req)

    // Apply focus aspects filter
    if (options?.focusAspects?.length) {
      const focusSet = new Set(options.focusAspects.map(a => a.toLowerCase()))
      aspects = aspects.filter(a => focusSet.has(a.split(':')[0].toLowerCase()))
    }

    const coveredAspects = findCoveredAspects(aspects, tests)
    const missingAspects = aspects.filter((a) => !coveredAspects.includes(a))

    let coverageType: "full" | "partial" | "none" = "none"
    if (missingAspects.length === 0 && aspects.length > 0) coverageType = "full"
    else if (coveredAspects.length > 0) coverageType = "partial"

    items.push({
      requirement_id: req.id,
      requirement_name: req.name,
      test_id: tests[0]?.id,
      test_name: tests[0]?.name,
      coverage_type: coverageType,
      covered_aspects: coveredAspects,
      missing_aspects: missingAspects,
    })

    if (coverageType !== "full") {
      gaps.push(`${req.name}: missing coverage for ${missingAspects.join(", ")}`)
    }
  }

  // Apply max results limit
  if (options?.maxResults && items.length > options.maxResults) {
    items.splice(options.maxResults)
  }

  const covered = items.filter((i) => i.coverage_type === "full").length
  const partial = items.filter((i) => i.coverage_type === "partial").length
  const uncovered = items.filter((i) => i.coverage_type === "none").length

  return {
    items,
    orphan_tests: orphanTests,
    total_requirements: requirements.length,
    covered_count: covered,
    partial_count: partial,
    uncovered_count: uncovered,
    coverage_rate: requirements.length === 0 ? 1 : covered / requirements.length,
    gaps,
  }
}

/**
 * Infer which requirement a test covers based on name matching.
 * Uses 3 strategies: filename pattern, imports/dependencies, and describe/it blocks.
 */
function inferRequirementFromTest(
  test: any,
  requirements: RequirementNode[],
  graph: KnowledgeGraph,
): { requirement_id: string; method: string } | null {
  const testId = test.id.toLowerCase()
  const testName = (test.name || "").toLowerCase()
  const testPath = ((test.metadata as any)?.target || "").toLowerCase()
  const testText = `${testId} ${testName} ${testPath}`

  // Strategy 1: Filename pattern matching
  // e.g., "user-auth.test.ts" might test "USER-AUTH-REQ"
  for (const req of requirements) {
    const reqName = req.name.toLowerCase().replace(/\s+/g, "-")
    const reqId = req.id.toLowerCase()

    if (
      testText.includes(reqName) ||
      testText.includes(reqId) ||
      testName.includes(reqName) ||
      testName.includes(reqId)
    ) {
      return { requirement_id: req.id, method: "filename_pattern" }
    }
  }

  // Strategy 2: Import/dependency analysis
  // Check if the test file imports from files related to a requirement
  const testMeta = test.metadata as Record<string, unknown>
  if (Array.isArray(testMeta.imports)) {
    for (const imp of testMeta.imports) {
      if (typeof imp !== "string") continue
      const impLower = imp.toLowerCase()
      for (const req of requirements) {
        const reqName = req.name.toLowerCase().replace(/\s+/g, "-")
        if (impLower.includes(reqName)) {
          return { requirement_id: req.id, method: "import_analysis" }
        }
      }
    }
  }

  // Strategy 3: Relationship-based inference
  // If test is a child of a file that implements a requirement
  if (testMeta.file_path) {
    const fileNodes = graph.nodes.filter(n => n.type === "file")
    for (const file of fileNodes) {
      const fileMeta = file.metadata as { path?: string }
      if (fileMeta.path === testMeta.file_path) {
        // Find what this file implements
        const implementsRels = graph.relationships.filter(
          r => r.from === file.id && r.type === "implements"
        )
        for (const rel of implementsRels) {
          // Check if the target is a requirement or feature containing requirements
          const target = graph.nodes.find(n => n.id === rel.to)
          if (target?.type === "requirement") {
            return { requirement_id: target.id, method: "file_relationship" }
          }
          if (target?.type === "feature") {
            // Find requirements contained by this feature
            const reqRels = graph.relationships.filter(
              r => r.from === target.id && r.type === "contains"
            )
            for (const reqRel of reqRels) {
              const reqNode = graph.nodes.find(n => n.id === reqRel.to)
              if (reqNode?.type === "requirement") {
                return { requirement_id: reqNode.id, method: "feature_relationship" }
              }
            }
          }
        }
      }
    }
  }

  return null
}

function extractAspects(req: RequirementNode): string[] {
  const aspects: string[] = []

  if (req.metadata.priority) aspects.push(`priority:${req.metadata.priority}`)

  const desc = (req.description || "").toLowerCase()
  if (desc.includes("validation")) aspects.push("validation")
  if (desc.includes("error")) aspects.push("error_handling")
  if (desc.includes("performance")) aspects.push("performance")
  if (desc.includes("security")) aspects.push("security")

  if (aspects.length === 0) aspects.push("behavior")

  return [...new Set(aspects)]
}

function findCoveredAspects(aspects: string[], tests: any[]): string[] {
  const covered: string[] = []

  for (const aspect of aspects) {
    const isCovered = tests.some((test) => {
      const testText = ((test.name || "") + " " + (test.description || "")).toLowerCase()
      const aspectKey = aspect.split(":")[0].toLowerCase()

      return testText.includes(aspectKey) ||
        testText.includes(aspect.toLowerCase()) ||
        testText.includes("all") ||
        testText.includes("comprehensive")
    })

    if (isCovered) covered.push(aspect)
  }

  return covered
}

export function formatCoverageReport(report: CoverageReport): string {
  const ratePercent = (report.coverage_rate * 100).toFixed(1)
  const lines = [
    `## Test Coverage: ${ratePercent}%`,
    `Covered: ${report.covered_count} | Partial: ${report.partial_count} | Uncovered: ${report.uncovered_count}`,
    "",
  ]

  const grouped = {
    full: report.items.filter((i) => i.coverage_type === "full"),
    partial: report.items.filter((i) => i.coverage_type === "partial"),
    none: report.items.filter((i) => i.coverage_type === "none"),
  }

  if (grouped.none.length > 0) {
    lines.push("### ❌ Uncovered Requirements")
    for (const item of grouped.none) {
      lines.push(`- **${item.requirement_name}**: ${item.missing_aspects.join(", ")}`)
    }
    lines.push("")
  }

  if (grouped.partial.length > 0) {
    lines.push("### ⚠️ Partially Covered")
    for (const item of grouped.partial) {
      lines.push(`- **${item.requirement_name}**: missing ${item.missing_aspects.join(", ")}`)
    }
    lines.push("")
  }

  if (grouped.full.length > 0) {
    lines.push(`### ✅ Fully Covered (${grouped.full.length})`)
    for (const item of grouped.full) {
      lines.push(`- ${item.requirement_name} → ${item.test_name}`)
    }
    lines.push("")
  }

  if (report.gaps.length > 0) {
    lines.push("### Coverage Gaps")
    for (const gap of report.gaps) {
      lines.push(`- ${gap}`)
    }
  }

  if (report.orphan_tests.length > 0) {
    lines.push("")
    lines.push(`### 🧪 Tests Without Requirement Link (${report.orphan_tests.length})`)
    lines.push("These tests exist but are not linked to any requirement in the graph:")
    for (const test of report.orphan_tests.slice(0, 15)) {
      const pathInfo = test.test_path ? ` (${test.test_path})` : ""
      const inferredInfo = test.inferred_requirement_id
        ? ` → inferred: ${test.inferred_requirement_id} (${test.inferred_by})`
        : ""
      lines.push(`- **${test.test_name}**${pathInfo}${inferredInfo}`)
    }
    if (report.orphan_tests.length > 15) {
      lines.push(`- ... and ${report.orphan_tests.length - 15} more`)
    }
    lines.push("")
    lines.push("Use `sdd.add_relationship` to link: `from=requirement_id, to=test_id, type=tested_by`")
  }

  return lines.join("\n")
}
