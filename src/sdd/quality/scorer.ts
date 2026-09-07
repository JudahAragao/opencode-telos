import type { KnowledgeGraph } from "../domain/types.js"
import { getNodesByType } from "../graph/engine.js"
import { getExclusionSets, isNodeExcludedOrDeprecated } from "../drift/exclusion.js"
import { validateGraph } from "../validation/validator.js"
import { detectDrift } from "../drift/detector.js"
import { getPromiseReport } from "../promises/tracker.js"
import { validateAgainstConstitution } from "../constitution/validator.js"
import { readFileSync, existsSync, mkdirSync } from "fs"
import { atomicWriteFile } from "../cache/atomic.js"
import { join, dirname } from "path"

export interface QualityFactor {
  name: string
  score: number
  weight: number
  details: string
}

export interface QualityReport {
  score: number
  trend: "improving" | "stable" | "declining"
  factors: QualityFactor[]
  history: Array<{ timestamp: string; score: number }>
}

/**
 * Options for controlling quality scoring scope.
 */
export interface QualityScoringOptions {
  /** Only calculate these specific factors. */
  focusFactors?: string[]
  /** Skip these factors (use cached results instead). */
  skipFactors?: string[]
  /** Skip drift detection (uses cached result). */
  skipDrift?: boolean
  /** Skip promise calculation (uses cached result). */
  skipPromises?: boolean
  /** Skip constitution check (uses cached result). */
  skipConstitution?: boolean
  /** Skip validation (uses cached result). */
  skipValidation?: boolean
  /** Cache for individual factor scores (factor_name → score). Reuse if provided. */
  factorCache?: Map<string, { score: number; details: string; timestamp: number }>
  /** Maximum age in ms for cached factors to be considered fresh (default: 60000 = 1 min). */
  cacheMaxAge?: number
}

const HISTORY_FILE = ".sdd/quality-history.json"
const MAX_HISTORY = 20

const FACTOR_WEIGHTS = {
  validation: 0.25,
  drift: 0.20,
  promises: 0.20,
  completeness: 0.15,
  constitution: 0.10,
  coverage: 0.10,
}

export function calculateQualityScore(
  graph: KnowledgeGraph,
  projectDir: string,
  options?: QualityScoringOptions,
): QualityReport {
  const factors: QualityFactor[] = []
  const focusSet = options?.focusFactors ? new Set(options.focusFactors) : null
  const skipSet = options?.skipFactors ? new Set(options.skipFactors) : null

  const shouldInclude = (name: string) => {
    if (skipSet?.has(name)) return false
    if (focusSet && !focusSet.has(name)) return false
    return true
  }

  const getCachedFactor = (name: string): QualityFactor | null => {
    if (!options?.factorCache) return null
    const cached = options.factorCache.get(name)
    if (!cached) return null
    const maxAge = options.cacheMaxAge ?? 60000
    if (Date.now() - cached.timestamp > maxAge) return null // Expired
    return { name, score: cached.score, weight: FACTOR_WEIGHTS[name as keyof typeof FACTOR_WEIGHTS] || 0.1, details: cached.details }
  }

  const setCachedFactor = (name: string, score: number, details: string) => {
    if (options?.factorCache) {
      options.factorCache.set(name, { score, details, timestamp: Date.now() })
    }
  }

  // Validation factor
  if (shouldInclude("validation")) {
    const cached = getCachedFactor("validation")
    if (cached) {
      factors.push(cached)
    } else if (!options?.skipValidation) {
      const validation = validateGraph(graph, undefined, projectDir)
      const validationScore = validation.errors.length === 0 ? 1 : Math.max(0, 1 - validation.errors.length / Math.max(graph.nodes.length, 1))
      const details = `${validation.errors.length} errors, ${validation.warnings.length} warnings`
      factors.push({ name: "validation", score: validationScore, weight: FACTOR_WEIGHTS.validation, details })
      setCachedFactor("validation", validationScore, details)
    } else {
      factors.push({ name: "validation", score: 1, weight: FACTOR_WEIGHTS.validation, details: "Skipped (cached)" })
    }
  }

  // Drift factor
  if (shouldInclude("drift")) {
    const cached = getCachedFactor("drift")
    if (cached) {
      factors.push(cached)
    } else if (!options?.skipDrift) {
      const drift = detectDrift(graph, projectDir)
      const driftItems = drift.missing_files.length + drift.untracked_files.length + drift.spec_code_mismatches.length
      const driftScore = driftItems === 0 ? 1 : Math.max(0, 1 - driftItems / Math.max(graph.nodes.length, 1))
      const details = `${driftItems} drift items detected`
      factors.push({ name: "drift", score: driftScore, weight: FACTOR_WEIGHTS.drift, details })
      setCachedFactor("drift", driftScore, details)
    } else {
      factors.push({ name: "drift", score: 1, weight: FACTOR_WEIGHTS.drift, details: "Skipped (cached)" })
    }
  }

  // Promises factor
  if (shouldInclude("promises")) {
    const cached = getCachedFactor("promises")
    if (cached) {
      factors.push(cached)
    } else if (!options?.skipPromises) {
      const promiseReport = getPromiseReport(graph)
      const promisesScore = promiseReport.total === 0 ? 1 : promiseReport.fulfillment_rate
      const details = `${promiseReport.fulfilled}/${promiseReport.total} fulfilled (${(promiseReport.fulfillment_rate * 100).toFixed(0)}%)`
      factors.push({ name: "promises", score: promisesScore, weight: FACTOR_WEIGHTS.promises, details })
      setCachedFactor("promises", promisesScore, details)
    } else {
      factors.push({ name: "promises", score: 1, weight: FACTOR_WEIGHTS.promises, details: "Skipped (cached)" })
    }
  }

  // Completeness factor
  if (shouldInclude("completeness")) {
    const cached = getCachedFactor("completeness")
    if (cached) {
      factors.push(cached)
    } else {
      const expectedTypes = ["project", "feature", "requirement", "entity", "api"]
      const presentTypes = expectedTypes.filter((t) => graph.nodes.some((n) => n.type === t))
      const completenessScore = presentTypes.length / expectedTypes.length
      const details = `${presentTypes.length}/${expectedTypes.length} expected node types present`
      factors.push({ name: "completeness", score: completenessScore, weight: FACTOR_WEIGHTS.completeness, details })
      setCachedFactor("completeness", completenessScore, details)
    }
  }

  // Constitution factor
  if (shouldInclude("constitution")) {
    const cached = getCachedFactor("constitution")
    if (cached) {
      factors.push(cached)
    } else if (!options?.skipConstitution) {
      const constitutionResult = validateAgainstConstitution(graph)
      const constitutionScore = constitutionResult.violations.length === 0 ? 1 : Math.max(0, 1 - constitutionResult.violations.length / Math.max(constitutionResult.total_principles, 1))
      const details = `${constitutionResult.violations.length}/${constitutionResult.total_principles} principles violated`
      factors.push({ name: "constitution", score: constitutionScore, weight: FACTOR_WEIGHTS.constitution, details })
      setCachedFactor("constitution", constitutionScore, details)
    } else {
      factors.push({ name: "constitution", score: 1, weight: FACTOR_WEIGHTS.constitution, details: "Skipped (cached)" })
    }
  }

  // Coverage factor
  if (shouldInclude("coverage")) {
    const cached = getCachedFactor("coverage")
    if (cached) {
      factors.push(cached)
    } else {
      const { removed, deprecated } = getExclusionSets(graph)
      const requirements = getNodesByType(graph, "requirement")
        .filter((r) => !isNodeExcludedOrDeprecated(r.id, r.status, removed, deprecated))
      const tests = getNodesByType(graph, "test")
      const coverageScore = requirements.length === 0 ? 1 : Math.min(1, tests.length / requirements.length)
      const details = `${tests.length} tests for ${requirements.length} requirements`
      factors.push({ name: "coverage", score: coverageScore, weight: FACTOR_WEIGHTS.coverage, details })
      setCachedFactor("coverage", coverageScore, details)
    }
  }

  // Renormalize weights if some factors were skipped
  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0)
  const totalScore = factors.reduce((sum, f) => sum + f.score * (f.weight / totalWeight), 0)
  const finalScore = Math.round(totalScore * 100) / 100

  const history = loadHistory(projectDir)
  const trend = calculateTrend(history, finalScore)

  history.push({ timestamp: new Date().toISOString(), score: finalScore })
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY)
  saveHistory(projectDir, history)

  return {
    score: finalScore,
    trend,
    factors,
    history,
  }
}

function loadHistory(projectDir: string): Array<{ timestamp: string; score: number }> {
  const path = join(projectDir, HISTORY_FILE)
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return []
  }
}

function saveHistory(projectDir: string, history: Array<{ timestamp: string; score: number }>): void {
  const path = join(projectDir, HISTORY_FILE)
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  atomicWriteFile(path, JSON.stringify(history, null, 2))
}

function calculateTrend(
  history: Array<{ timestamp: string; score: number }>,
  _currentScore: number,
): "improving" | "stable" | "declining" {
  if (history.length < 3) return "stable"

  const recent = history.slice(-5)
  const avgRecent = recent.reduce((s, h) => s + h.score, 0) / recent.length
  const avgOlder = history.slice(0, -5).reduce((s, h) => s + h.score, 0) / Math.max(history.length - 5, 1)

  const diff = avgRecent - avgOlder
  if (diff > 0.02) return "improving"
  if (diff < -0.02) return "declining"
  return "stable"
}

export function formatQualityReport(report: QualityReport): string {
  const trendEmoji = report.trend === "improving" ? "📈" : report.trend === "declining" ? "📉" : "➡️"
  const scorePercent = (report.score * 100).toFixed(1)

  const lines = [
    `## Quality Score: ${scorePercent}% ${trendEmoji}`,
    `**Trend:** ${report.trend}`,
    "",
    "### Factors",
  ]

  for (const f of report.factors) {
    const bar = "█".repeat(Math.round(f.score * 10)) + "░".repeat(10 - Math.round(f.score * 10))
    lines.push(`- **${f.name}** (${(f.weight * 100).toFixed(0)}%): ${bar} ${(f.score * 100).toFixed(0)}% — ${f.details}`)
  }

  if (report.history.length > 1) {
    lines.push("\n### History (last 5)")
    for (const h of report.history.slice(-5)) {
      lines.push(`- ${h.timestamp.slice(0, 19)}: ${(h.score * 100).toFixed(1)}%`)
    }
  }

  return lines.join("\n")
}
