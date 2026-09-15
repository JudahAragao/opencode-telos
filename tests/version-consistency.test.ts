import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { PLUGIN_VERSION, GRAPH_SCHEMA_VERSION } from "../src/version"

const ROOT = join(import.meta.dir, "..")

function readText(file: string): string {
  return readFileSync(join(ROOT, file), "utf-8")
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readText(file))
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

describe("Version consistency", () => {
  it("PLUGIN_VERSION is a valid semver", () => {
    expect(PLUGIN_VERSION).toMatch(SEMVER)
  })

  it("PLUGIN_VERSION matches the canonical package.json version", () => {
    expect(PLUGIN_VERSION).toBe(readJson("package.json").version)
  })

  it("marketplace.json stays in sync with the canonical version", () => {
    expect(readJson("marketplace.json").version).toBe(PLUGIN_VERSION)
  })

  it("no source module hardcodes the plugin version literal", () => {
    const consumers = ["src/mcp/server.ts"]
    for (const file of consumers) {
      const content = readText(file)
      expect(content).toContain("PLUGIN_VERSION")
      expect(content).not.toMatch(/"1\.\d+\.\d+"/)
    }
  })

  it("GRAPH_SCHEMA_VERSION is a valid semver", () => {
    expect(GRAPH_SCHEMA_VERSION).toMatch(SEMVER)
  })

  it("graph schema literals are centralized in src/version.ts", () => {
    const consumers = [
      "src/sdd/graph/engine.ts",
      "src/sdd/persistence/yaml.ts",
      "src/sdd/persistence/sqlite.ts",
      "src/opencode/router/tools-composite.ts",
    ]
    for (const file of consumers) {
      const content = readText(file)
      expect(content).toContain("GRAPH_SCHEMA_VERSION")
      expect(content).not.toMatch(/sdd_version:\s*"/)
    }
  })
})
