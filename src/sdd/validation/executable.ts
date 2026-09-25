import { createHash } from "crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { execFileSync } from "child_process"
import { atomicWriteFile } from "../cache/atomic.js"
import type { KnowledgeGraph } from "../domain/types.js"
import { getAcceptanceCriteria } from "../acceptance/service.js"

export interface ExecutableCheck {
  name: string
  command: string[]
  status: "passed" | "failed" | "skipped"
  output: string
}

/** Hash of one file declared as affected by a Change (G6/G8). */
export interface ScopedFileHash {
  path: string
  /** null when the declared file did not exist on disk at verification time. */
  sha256: string | null
}

export interface ExecutableValidationResult {
  passed: boolean
  verified: boolean
  checks: ExecutableCheck[]
  created_at: string
  /** Content fingerprint captured after verification, used to reject stale reports. */
  project_fingerprint: string
  functional_verified?: boolean
  functional_gaps?: string[]
  /** Whether the Change has affected requirements at all (G1). */
  functional_applicable?: boolean
  /** Affected requirement node ids that the evidence was evaluated against (G1). */
  functional_requirements?: string[]
  /** Explicit statement recorded on the Change that no requirement is affected (G1). */
  no_requirement_impact?: boolean
  /** True when verification was explicitly waived because no script is declared (G4). */
  verification_waived?: boolean
  waiver_reason?: string
  /** Per-file hashes of the Change's declared affected files (G6/G8). */
  scoped_files?: ScopedFileHash[]
}

export interface FunctionalEvidenceResult {
  verified: boolean
  /** False when the Change declares no affected requirement (evidence N/A, not "passing"). */
  applicable: boolean
  requirements: string[]
  gaps: string[]
}

/**
 * Evaluates the Change's functional evidence (requirement → test).
 *
 * G1: absence of an affected requirement is NOT approval. This used to return
 * `verified: true`, o que anulava a trava sempre que o agente omitisse o escopo.
 * Now it requires an explicit declaration (`no_requirement_impact`) for the
 * legitimate case of a change that does not alter specified behaviour.
 */
export function validateFunctionalEvidence(graph: KnowledgeGraph, changeId: string): FunctionalEvidenceResult {
  const change = graph.nodes.find((node) => node.id === changeId && node.type === "change")
  if (!change) return { verified: false, applicable: false, requirements: [], gaps: [`Change ${changeId} was not found in the graph`] }
  const metadata = change.metadata as { affected_nodes?: string[]; affected_tests?: string[]; no_requirement_impact?: boolean }
  const affected = new Set(metadata.affected_nodes || [])
  const requirements = graph.nodes.filter((node) => node.type === "requirement" && affected.has(node.id))

  if (requirements.length === 0) {
    if (metadata.no_requirement_impact === true) {
      return { verified: true, applicable: false, requirements: [], gaps: [] }
    }
    return {
      verified: false,
      applicable: false,
      requirements: [],
      gaps: [
        `Change ${changeId} declares no affected requirement node, so requirement→test evidence cannot be evaluated.`,
        "Declare the affected requirements (affected_entities / affected_node_ids) during sdd.enforce, or set no_requirement_impact=true to state that this change does not alter specified behaviour.",
      ],
    }
  }

  const requirementIds = requirements.map((requirement) => requirement.id)
  const allowedTests = new Set(metadata.affected_tests || [])
  const gaps: string[] = []
  for (const requirement of requirements) {
    const links = graph.relationships.filter((rel) => rel.from === requirement.id && rel.type === "tested_by")
    const linkedTests = links.map((rel) => graph.nodes.find((node) => node.id === rel.to && node.type === "test"))
      .filter((node): node is NonNullable<typeof node> => node != null && (allowedTests.size === 0 || allowedTests.has(node.id)))
    const valid = linkedTests.length > 0
    if (!valid) {
      gaps.push(`Requirement "${requirement.name}" has no affected test linked by tested_by`)
      continue
    }

    const requirementMetadata = requirement.metadata as { verification?: { security_criteria?: string[]; performance_criteria?: string[]; invariants?: string[] } }
    const criteriaNodes = getAcceptanceCriteria(graph, requirement.id, true)
    const criteria = criteriaNodes.map((criterion) => ({ id: criterion.id, text: criterion.metadata.text }))
    const verification = requirementMetadata.verification
    const requiredCriteria = [
      ...criteria.map((criterion) => criterion.text),
      ...(verification?.security_criteria || []),
      ...(verification?.performance_criteria || []),
      ...(verification?.invariants || []),
    ].filter((criterion, index, all): criterion is string => typeof criterion === "string" && all.indexOf(criterion) === index)
    if (requiredCriteria.length > 0) {
      const verifiedCriteria = new Set(linkedTests.flatMap((test) => {
        const metadata = test.metadata as { verifies?: unknown[] }
        return Array.isArray(metadata.verifies) ? metadata.verifies.filter((value): value is string => typeof value === "string") : []
      }))
      for (const criterion of requiredCriteria) {
        const node = criteria.find((item) => item.text === criterion)
        if (!verifiedCriteria.has(criterion) && !(node && verifiedCriteria.has(node.id))) gaps.push(`Requirement "${requirement.name}" lacks a linked test explicitly verifying: ${criterion}`)
      }
    }
  }
  return { verified: gaps.length === 0, applicable: true, requirements: requirementIds, gaps }
}

function detectPackageManager(projectDir: string): string {
  if (existsSync(join(projectDir, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(join(projectDir, "yarn.lock"))) return "yarn"
  if (existsSync(join(projectDir, "package-lock.json"))) return "npm"
  if (existsSync(join(projectDir, "bun.lockb")) || existsSync(join(projectDir, "bun.lock"))) return "bun"
  try {
    const declared = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf-8")).packageManager
    if (typeof declared === "string") {
      const manager = declared.split("@")[0]
      if (["bun", "npm", "pnpm", "yarn"].includes(manager)) return manager
    }
  } catch {
    // No usable package manager declaration; use the runtime fallback below.
  }
  return typeof Bun !== "undefined" ? "bun" : "npm"
}

interface DeclaredVerification {
  name: string
  command: string[]
}

function declaredVerifications(projectDir: string): DeclaredVerification[] {
  const checks: DeclaredVerification[] = []
  const packagePath = join(projectDir, "package.json")
  if (existsSync(packagePath)) {
    try {
      const scripts = JSON.parse(readFileSync(packagePath, "utf-8")).scripts || {}
      const packageManager = detectPackageManager(projectDir)
      for (const name of ["format:check", "format", "lint", "typecheck", "check", "verify", "build", "compile", "test", "ci"]) {
        if (typeof scripts[name] === "string" && scripts[name].trim()) {
          checks.push({ name, command: [packageManager, "run", name] })
        }
      }
    } catch {
      // Malformed package.json is reported by the caller.
    }
  }
  if (existsSync(join(projectDir, "Cargo.toml"))) {
    checks.push({ name: "cargo check", command: ["cargo", "check"] })
    checks.push({ name: "cargo test", command: ["cargo", "test"] })
  }
  if (existsSync(join(projectDir, "go.mod"))) checks.push({ name: "go test", command: ["go", "test", "./..."] })
  if (existsSync(join(projectDir, "pyproject.toml")) || existsSync(join(projectDir, "pytest.ini")) || existsSync(join(projectDir, "tox.ini"))) {
    checks.push({ name: "python compile", command: ["python", "-m", "compileall", "-q", "."] })
    if (existsSync(join(projectDir, "tests")) || existsSync(join(projectDir, "test"))) {
      checks.push({ name: "python test", command: ["python", "-m", "pytest", "-q"] })
    }
  }
  if (existsSync(join(projectDir, "pom.xml"))) checks.push({ name: "maven test", command: ["mvn", "-q", "test"] })
  if (existsSync(join(projectDir, "build.gradle")) || existsSync(join(projectDir, "build.gradle.kts"))) {
    const runner = existsSync(join(projectDir, "gradlew")) ? "./gradlew" : "gradle"
    checks.push({ name: "gradle test", command: [runner, "test"] })
  }
  if (existsSync(join(projectDir, "Makefile"))) {
    const makefile = readFileSync(join(projectDir, "Makefile"), "utf-8")
    const target = makefile.match(/^\s*(test|check|lint|verify)\s*:/m)?.[1]
    if (target) checks.push({ name: `make ${target}`, command: ["make", target] })
  }
  return checks
}

/**
 * Directories that never enter the fingerprint: artifacts, dependencies and
 * the SDD internal storage.
 *
 * G5: dot-entries are NO longer skipped wholesale. Previously any name
 * starting with "." was skipped, so changing `.eslintrc*`, `.prettierrc*`,
 * `.editorconfig` or `.github/**` after verifying kept the report "current" —
 * exactly the drift this gate exists to prevent.
 */
const IGNORED_DIRECTORIES = new Set([
  ".git", ".sdd", "node_modules", "dist", "build", "coverage", ".turbo",
  ".next", ".nuxt", ".cache", ".venv", ".pnpm-store",
  "venv", "target", "__pycache__",
])

/** Files irrelevant to the fingerprint. */
const IGNORED_FILE_NAMES = new Set([".DS_Store", "Thumbs.db"])

/**
 * `.env` holds a local secret, not source: only the versioned example is hashed.
 */
function isIgnoredFile(name: string): boolean {
  if (IGNORED_FILE_NAMES.has(name)) return true
  if (name === ".env.example") return false
  return name === ".env" || name.startsWith(".env.")
}

const CHECK_TIMEOUT_MS = 120_000

function runCheckedCommand(command: string, args: string[], cwd: string): { status: "passed" | "failed"; output: string } {
  try {
    const output = execFileSync(command, args, {
      cwd,
      encoding: "utf-8",
      timeout: CHECK_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    })
    return { status: "passed", output: output.slice(-6000) }
  } catch (error) {
    const value = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string }
    const stdout = value.stdout ? String(value.stdout) : ""
    const stderr = value.stderr ? String(value.stderr) : ""
    return { status: "failed", output: [stdout, stderr, value.message || "command failed"].filter(Boolean).join("\n").slice(-6000) }
  }
}

/**
 * Hash source and manifest contents without including generated SDD reports or
 * dependency trees. This makes a verification report invalid after code or
 * configuration changes, while keeping completion checks reasonably cheap.
 */
export function computeProjectFingerprint(projectDir: string): string {
  const hash = createHash("sha256")
  const files: string[] = []

  const visit = (directory: string): void => {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
    try { entries = readdirSync(directory, { withFileTypes: true, encoding: "utf8" }) } catch { return }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) visit(join(directory, entry.name))
        continue
      }
      if (entry.isFile() && !isIgnoredFile(entry.name)) files.push(join(directory, entry.name))
    }
  }

  visit(projectDir)
  files.sort()
  for (const file of files) {
    const relative = file.slice(projectDir.length + 1)
    hash.update(relative)
    try { hash.update(readFileSync(file)) } catch { hash.update("<unreadable>") }
  }
  return hash.digest("hex")
}

export interface ExecutableValidationOptions {
  /**
   * G4: allows recording an explicit, auditable waiver when the project
   * declares no verification script. Without it the flow deadlocks on
   * `verified: false` and the only way out would be `force=true` (not auditable).
   */
  acknowledgeNoScripts?: boolean
  waiverReason?: string
}

/** Run only project-declared verification scripts; never invent a package manager command. */
export function validateExecutableProject(
  projectDir: string,
  options?: ExecutableValidationOptions,
): ExecutableValidationResult {
  const checks: ExecutableCheck[] = []
  const packagePath = join(projectDir, "package.json")
  if (existsSync(packagePath)) {
    try {
      JSON.parse(readFileSync(packagePath, "utf-8"))
    } catch {
      return { passed: false, verified: false, checks: [{ name: "package.json", command: [], status: "failed", output: "Invalid package.json" }], created_at: new Date().toISOString(), project_fingerprint: computeProjectFingerprint(projectDir) }
    }
  }

  const declared = declaredVerifications(projectDir)
  for (const verification of declared) {
    try {
      const result = runCheckedCommand(verification.command[0], verification.command.slice(1), projectDir)
      checks.push({ ...verification, status: result.status, output: result.output })
    } catch (error) {
      checks.push({ ...verification, status: "failed", output: error instanceof Error ? error.message : String(error) })
    }
  }
  if (declared.length === 0) checks.push({ name: "project verification", command: [], status: "skipped", output: "No supported project verification manifest or script was declared" })

  // A whitespace-only diff catches malformed patches without requiring Git history.
  if (existsSync(join(projectDir, ".git"))) {
    const command = ["git", "diff", "--check"]
    try {
      const result = runCheckedCommand(command[0], command.slice(1), projectDir)
      checks.push({ name: "diff", command, status: result.status, output: result.output })
    } catch (error) {
      checks.push({ name: "diff", command, status: "failed", output: error instanceof Error ? error.message : String(error) })
    }
  }

  const declaredChecks = checks.filter((check) => check.command.length > 0 && check.name !== "diff")
  // git diff --check is useful hygiene, but it is not executable evidence.
  // At least one project-declared verification script must pass; skipped
  // optional scripts do not count as failures.
  const hasExecutableEvidence = declaredChecks.length > 0 && declaredChecks.every((check) => check.status === "passed")
  // G4: with no declared script the waiver must be explicit and is stored
  // no laudo (verification_waived + waiver_reason) em vez de virar force=true.
  const waived = !hasExecutableEvidence && declaredChecks.length === 0 && options?.acknowledgeNoScripts === true
  return {
    passed: checks.every((check) => check.status !== "failed"),
    verified: hasExecutableEvidence || waived,
    checks,
    created_at: new Date().toISOString(),
    project_fingerprint: computeProjectFingerprint(projectDir),
    ...(waived
      ? {
          verification_waived: true,
          waiver_reason: options?.waiverReason || "No project-declared verification script was available; waiver explicitly acknowledged.",
        }
      : {}),
  }
}

/**
 * Hashes of the files declared as affected by the Change (G6/G8).
 * `sha256: null` records that the declared file did not exist at verification.
 */
export function computeScopedFileHashes(projectDir: string, files: readonly string[]): ScopedFileHash[] {
  return files.map((file) => {
    const absolute = join(projectDir, file)
    if (!existsSync(absolute)) return { path: file, sha256: null }
    try {
      return { path: file, sha256: createHash("sha256").update(readFileSync(absolute)).digest("hex") }
    } catch {
      return { path: file, sha256: null }
    }
  })
}

/**
 * Checks that the files declared by the Change are exactly the ones that were
 * verified (G8) and that nothing changed in them since (G6).
 */
export function verifyScopedFiles(
  projectDir: string,
  result: ExecutableValidationResult,
): { ok: boolean; gaps: string[] } {
  const scoped = result.scoped_files
  if (!scoped) {
    return { ok: false, gaps: ["Verification report carries no change scope; re-run sdd.verify_implementation."] }
  }
  if (scoped.length === 0) {
    return { ok: false, gaps: ["The Change declares no affected files, so no implementation could be verified against it."] }
  }
  const gaps: string[] = []
  for (const entry of scoped) {
    if (entry.sha256 === null) {
      gaps.push(`Declared file "${entry.path}" did not exist when the change was verified.`)
      continue
    }
    const current = computeScopedFileHashes(projectDir, [entry.path])[0]
    if (!current || current.sha256 !== entry.sha256) {
      gaps.push(`Declared file "${entry.path}" changed after verification.`)
    }
  }
  return { ok: gaps.length === 0, gaps }
}

export function isExecutableValidationCurrent(projectDir: string, result: ExecutableValidationResult): boolean {
  return Boolean(result.project_fingerprint) && result.project_fingerprint === computeProjectFingerprint(projectDir)
}

export function saveExecutableValidation(projectDir: string, changeId: string, result: ExecutableValidationResult): void {
  const dir = join(projectDir, ".sdd", "verification")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  atomicWriteFile(join(dir, `${encodeURIComponent(changeId)}.json`), JSON.stringify(result, null, 2))
}

export function loadExecutableValidation(projectDir: string, changeId: string): ExecutableValidationResult | undefined {
  const file = join(projectDir, ".sdd", "verification", `${encodeURIComponent(changeId)}.json`)
  if (!existsSync(file)) return undefined
  try { return JSON.parse(readFileSync(file, "utf-8")) as ExecutableValidationResult } catch { return undefined }
}
