import { describe, expect, it } from "bun:test"
import {
  isWireToolName,
  rewriteToolNames,
  toCanonicalToolName,
  toWireToolName,
} from "../src/opencode/tool-names"
import { createSddTools } from "../src/opencode/tools"
import { buildV2ToolCatalog } from "../src/opencode/v2/tools"

describe("OpenCode V2 tool-name normalization", () => {
  it("projects dots to underscores (host rule)", () => {
    expect(toWireToolName("sdd.acceptance")).toBe("sdd_acceptance")
    expect(toWireToolName("sdd.update_from_answers")).toBe("sdd_update_from_answers")
  })

  it("maps every canonical name back from its wire spelling", () => {
    for (const canonical of Object.keys(createSddTools())) {
      expect(toCanonicalToolName(toWireToolName(canonical))).toBe(canonical)
    }
    expect(toCanonicalToolName("sdd_acceptance")).toBe("sdd.acceptance")
  })

  it("leaves unknown ids untouched", () => {
    expect(toCanonicalToolName("write")).toBe("write")
    expect(toCanonicalToolName("bash")).toBe("bash")
    expect(isWireToolName("bash")).toBe(false)
    expect(isWireToolName("sdd_acceptance")).toBe(true)
  })

  it("rewrites dotted references inside text to the wire name", () => {
    const text = "Run sdd.enforce, then sdd.approve_change and finally sdd.complete_change."
    const rewritten = rewriteToolNames(text)
    expect(rewritten).toBe(
      "Run sdd_enforce, then sdd_approve_change and finally sdd_complete_change.",
    )
    expect(rewritten).not.toContain("sdd.")
  })

  it("exposes the whole catalog under provider-safe wire names", () => {
    // Every provider, including strict OpenAI-compatible ones that reject dots,
    // must receive names the V2 host accepts after its own normalization.
    const catalog = buildV2ToolCatalog(createSddTools(), "/tmp/project")
    for (const effective of catalog.effectiveNames.values()) {
      expect(effective).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
      expect(effective).not.toContain(".")
    }
    expect(catalog.effectiveNames.get("sdd.acceptance")).toBe("sdd_acceptance")
  })
})
