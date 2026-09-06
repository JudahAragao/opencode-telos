import { createHash } from "crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs"
import { join } from "path"

export interface ExecutableCheck {
  name: string
  command: string[]
  status: "passed" | "failed" | "skipped"
  output: string
}

export interface ExecutableValidationResult {
  passed: boolean
  verified: boolean
  checks: ExecutableCheck[]
  created_at: string
  /** Content fingerprint captured after verification, used to reject stale reports. */
  project_fingerprint: string
}

function outputOf(value: Uint8Array | undefined): string {
  return value ? new TextDecoder().decode(value).slice(-6000) : ""
}

const IGNORED_DIRECTORIES = new Set([
  ".git", ".sdd", "node_modules", "dist", "build", "coverage", ".turbo",
])

/**
 * Hash source and manifest contents without including generated SDD reports or
 * dependency trees. This makes a verification report invalid after code or
 * configuration changes, while keeping completion checks reasonably cheap.
 */
export function computeProjectFingerprint(projectDir: string): string {
  const hash = createHash("sha256")
  const files: string[] = []

  const visit = (directory: string): void => {
    let entries: ReturnType<typeof readdirSync>
    try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env.example") continue
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) visit(join(directory, entry.name))
        continue
      }
      if (entry.isFile()) files.push(join(directory, entry.name))
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

/** Run only project-declared verification scripts; never invent a package manager command. */
export function validateExecutableProject(projectDir: string): ExecutableValidationResult {
  const checks: ExecutableCheck[] = []
  const packagePath = join(projectDir, "package.json")
  if (!existsSync(packagePath)) {
    return { passed: true, verified: false, checks: [{ name: "project scripts", command: [], status: "skipped", output: "package.json not found" }], created_at: new Date().toISOString(), project_fingerprint: computeProjectFingerprint(projectDir) }
  }

  let scripts: Record<string, string> = {}
  try {
    scripts = JSON.parse(readFileSync(packagePath, "utf-8")).scripts || {}
  } catch {
    return { passed: false, verified: false, checks: [{ name: "package.json", command: [], status: "failed", output: "Invalid package.json" }], created_at: new Date().toISOString(), project_fingerprint: computeProjectFingerprint(projectDir) }
  }

  for (const name of ["format:check", "lint", "typecheck", "test"]) {
    if (!scripts[name]) {
      checks.push({ name, command: [], status: "skipped", output: "Script not declared" })
      continue
    }
    const command = ["bun", "run", name]
    try {
      const result = Bun.spawnSync({ cmd: command, cwd: projectDir, stdout: "pipe", stderr: "pipe" })
      const output = [outputOf(result.stdout), outputOf(result.stderr)].filter(Boolean).join("\n")
      checks.push({ name, command, status: result.exitCode === 0 ? "passed" : "failed", output })
    } catch (error) {
      checks.push({ name, command, status: "failed", output: error instanceof Error ? error.message : String(error) })
    }
  }

  // A whitespace-only diff catches malformed patches without requiring Git history.
  if (existsSync(join(projectDir, ".git"))) {
    const command = ["git", "diff", "--check"]
    try {
      const result = Bun.spawnSync({ cmd: command, cwd: projectDir, stdout: "pipe", stderr: "pipe" })
      checks.push({ name: "diff", command, status: result.exitCode === 0 ? "passed" : "failed", output: [outputOf(result.stdout), outputOf(result.stderr)].filter(Boolean).join("\n") })
    } catch (error) {
      checks.push({ name: "diff", command, status: "failed", output: error instanceof Error ? error.message : String(error) })
    }
  }

  const declaredChecks = checks.filter((check) => check.command.length > 0)
  const verified = declaredChecks.length > 0 && declaredChecks.every((check) => check.status === "passed")
  return {
    passed: checks.every((check) => check.status !== "failed"),
    verified,
    checks,
    created_at: new Date().toISOString(),
    project_fingerprint: computeProjectFingerprint(projectDir),
  }
}

export function isExecutableValidationCurrent(projectDir: string, result: ExecutableValidationResult): boolean {
  return Boolean(result.project_fingerprint) && result.project_fingerprint === computeProjectFingerprint(projectDir)
}

export function saveExecutableValidation(projectDir: string, changeId: string, result: ExecutableValidationResult): void {
  const dir = join(projectDir, ".sdd", "verification")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${changeId}.json`), JSON.stringify(result, null, 2), "utf-8")
}

export function loadExecutableValidation(projectDir: string, changeId: string): ExecutableValidationResult | undefined {
  const file = join(projectDir, ".sdd", "verification", `${changeId}.json`)
  if (!existsSync(file)) return undefined
  try { return JSON.parse(readFileSync(file, "utf-8")) as ExecutableValidationResult } catch { return undefined }
}
