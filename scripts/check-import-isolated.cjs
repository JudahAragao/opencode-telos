"use strict"
const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

const ROOT = path.resolve(__dirname, "..")
const DIST = path.resolve(ROOT, "dist")
const TMP = path.resolve(ROOT, ".build-check-tmp")

function fail(message) {
  throw new Error(message)
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
    type: pkg.type || "module",
    dependencies: pkg.dependencies || {}
  }, null, 2))

  let used
  try {
    // The isolated package intentionally has no lockfile. Use npm's
    // production resolver before relying on Bun's temp-directory behavior,
    // which is restricted in some CI sandboxes.
    execSync("npm install --omit=dev --ignore-scripts --no-audit --no-fund --legacy-peer-deps", { cwd: TMP, stdio: "inherit" })
    used = "npm-install"
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
  console.error(`❌ build check failed: ${err && err.message ? err.message : String(err)}`)
  process.exitCode = 1
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
}
