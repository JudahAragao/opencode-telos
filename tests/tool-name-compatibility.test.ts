import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  getToolNameMode,
  projectToolNames,
  toCanonicalToolName,
  toWireToolName,
  toolNamesConfigExists,
} from "../src/opencode/tool-names"
import { createSddTools } from "../src/opencode/tools"

describe("OpenAI-compatible tool names", () => {
  it("keeps canonical names by default", () => {
    expect(toWireToolName("sdd.acceptance", false)).toBe("sdd.acceptance")
  })

  it("projects dots to underscores and restores the canonical name", () => {
    const projected = projectToolNames(
      { "sdd.acceptance": { description: "Call sdd.acceptance" }, "ssh.exec": { description: "Call ssh.exec" } },
      true,
    )
    expect(Object.keys(projected)).toEqual(["sdd_acceptance", "ssh_exec"])
    expect(projected.sdd_acceptance.description).toBe("Call sdd_acceptance")
    expect(toCanonicalToolName("ssh_exec", ["ssh.exec"], true)).toBe("ssh.exec")
  })

  it("rejects deterministic collisions", () => {
    expect(() => projectToolNames({ "a.b": { description: "one" }, a_b: { description: "two" } }, true)).toThrow(
      "Tool name collision",
    )
  })

  it("projects the complete Telos catalog to valid wire names", () => {
    const projected = projectToolNames(createSddTools(), true)
    expect(Object.keys(projected).every((name) => /^[A-Za-z0-9_-]{1,64}$/.test(name))).toBe(true)
    expect(projected.sdd_acceptance).toBeDefined()
    expect(toCanonicalToolName("sdd_acceptance", Object.keys(createSddTools()), true)).toBe("sdd.acceptance")
  })

  it("reads the mode from the shared project file", () => {
    const directory = mkdtempSync(join(tmpdir(), "telos-tool-names-"))
    const path = join(directory, ".opencode", "tool-names.json")
    mkdirSync(join(directory, ".opencode"), { recursive: true })
    writeFileSync(path, `${JSON.stringify({ mode: "safe" }, null, 2)}\n`, "utf8")

    expect(getToolNameMode(directory)).toBe("safe")
    expect(toolNamesConfigExists(directory)).toBe(true)
    expect(JSON.parse(readFileSync(path, "utf8")).mode).toBe("safe")
  })

  it("falls back to canonical when the shared file is missing or malformed", () => {
    const directory = mkdtempSync(join(tmpdir(), "telos-tool-names-"))
    expect(getToolNameMode(directory)).toBe("canonical")

    mkdirSync(join(directory, ".opencode"), { recursive: true })
    writeFileSync(join(directory, ".opencode", "tool-names.json"), "{ not json", "utf8")
    expect(getToolNameMode(directory)).toBe("canonical")
  })

  it("honours the environment variable and lets it win over the file", () => {
    const directory = mkdtempSync(join(tmpdir(), "telos-tool-names-"))
    mkdirSync(join(directory, ".opencode"), { recursive: true })
    writeFileSync(join(directory, ".opencode", "tool-names.json"), JSON.stringify({ mode: "safe" }), "utf8")

    const previous = process.env.OPENCODE_SAFE_TOOL_NAMES
    try {
      process.env.OPENCODE_SAFE_TOOL_NAMES = "canonical"
      expect(getToolNameMode(directory)).toBe("canonical")

      process.env.OPENCODE_SAFE_TOOL_NAMES = "1"
      expect(getToolNameMode(directory)).toBe("safe")
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_SAFE_TOOL_NAMES
      else process.env.OPENCODE_SAFE_TOOL_NAMES = previous
    }
  })
})
