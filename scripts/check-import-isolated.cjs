"use strict"
const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

const ROOT = path.resolve(__dirname, "..")
const DIST = path.resolve(ROOT, "dist")
const TMP = path.resolve(ROOT, ".build-check-tmp")

function fail(message) {
  console.error(`❌ build check failed: ${message}`)
  process.exitCode = 1
  process.exit(1)
}

try {
  if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(TMP, { recursive: true })

  fs.cpSync(DIST, path.join(TMP, "dist"), { recursive: true, dereference: true })

  const pkgPath = path.join(TMP, "package.json")
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
  fs.writeFileSync(pkgPath, JSON.stringify({
    name: "opencode-telos-check",
    version: pkg.version,
    dependencies: pkg.dependencies || {}
  }, null, 2))

  let used
  try {
    execSync("npm ci --omit=dev --prefix .", { cwd: TMP, stdio: "pipe" })
    used = "npm"
  } catch {
    execSync("bun install --production", { cwd: TMP, stdio: "inherit" })
    used = "bun"
  }

  const entry = path.join(TMP, "dist", "index.js")
  try {
    require(entry)
    console.log(`✅ import OK via ${used} with production deps only: ${entry}`)
  } catch (err) {
    fail(`Could not require dist/index.js: ${err && err.message ? err.message : String(err)}`)
  }
} catch (err) {
  fail(err && err.message ? err.message : String(err))
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
}
