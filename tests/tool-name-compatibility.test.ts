import { describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  getToolNameMode,
  projectToolNames,
  setToolNameMode,
  toCanonicalToolName,
  toWireToolName,
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

  it("persists the mode for both plugins to share", () => {
    const directory = mkdtempSync(join(tmpdir(), "telos-tool-names-"))
    const path = setToolNameMode(directory, "safe")
    expect(getToolNameMode(directory)).toBe("safe")
    expect(JSON.parse(readFileSync(path, "utf8")).mode).toBe("safe")
  })
})
