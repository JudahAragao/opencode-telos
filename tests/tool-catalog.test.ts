import { describe, it, expect, beforeEach } from "bun:test"
import { mkdtempSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createSddTools } from "../src/opencode/tools"
import { ALL_TOOL_NAMES, getToolsForSession } from "../src/opencode/router/tool-registry"
import { hasToolCategory, getToolCategories } from "../src/opencode/router/categories"
import { STANDALONE_TOOLS, TOOL_TAXONOMY } from "../src/opencode/router/tool-taxonomy"
import { runSddCommand, extractSddCommandText } from "../src/opencode/command"

const registeredTools = Object.keys(createSddTools())

describe("Tool catalog completeness", () => {
  it("ALL_TOOL_NAMES matches the registered tools exactly", () => {
    expect([...ALL_TOOL_NAMES].sort()).toEqual([...registeredTools].sort())
  })

  it("ALL_TOOL_NAMES has no duplicates", () => {
    expect(new Set(ALL_TOOL_NAMES).size).toBe(ALL_TOOL_NAMES.length)
  })

  it("STANDALONE_TOOLS covers every non-composite tool", () => {
    const composites = new Set(TOOL_TAXONOMY.map((t) => t.name))
    const expected = registeredTools.filter((name) => !composites.has(name)).sort()
    expect([...STANDALONE_TOOLS].sort()).toEqual(expected)
  })

  it("every registered tool has an explicit category", () => {
    const missing = registeredTools.filter((name) => !hasToolCategory(name))
    expect(missing).toEqual([])
  })

  it("every registered tool resolves to at least one category", () => {
    for (const name of registeredTools) {
      expect(getToolCategories(name).length).toBeGreaterThan(0)
    }
  })
})

describe("Tool registry announces the full catalogue", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sdd-catalog-"))
  })

  it("returns every registered tool regardless of graph state", () => {
    const result = getToolsForSession(dir)
    expect([...result.tools].sort()).toEqual([...registeredTools].sort())
  })

  it("keeps the whole catalogue even when a user input is classified", () => {
    const result = getToolsForSession(dir, "criar uma nova feature de login")
    expect([...result.tools].sort()).toEqual([...registeredTools].sort())
  })

  it("formatted message mentions every registered tool", () => {
    const { formattedMessage } = getToolsForSession(dir)
    const missing = registeredTools.filter((name) => !formattedMessage.includes(name))
    expect(missing).toEqual([])
  })

  it("announces the dashboard entry point", () => {
    const { formattedMessage } = getToolsForSession(dir)
    expect(formattedMessage).toContain("sdd.start_dashboard")
  })
})

describe("/sdd viz command routing", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sdd-viz-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
  })

  it("recognizes the viz command forms", () => {
    expect(extractSddCommandText("/sdd viz")).toBe("sdd viz")
    expect(extractSddCommandText("sdd viz stop")).toBe("sdd viz stop")
    expect(extractSddCommandText("sdd viz status")).toBe("sdd viz status")
    expect(extractSddCommandText("/sdd-viz")).toBe("sdd-viz")
  })

  it("reports dashboard status without starting a server", () => {
    const result = runSddCommand(dir, "sdd viz status")
    expect(result.matched).toBe(true)
    expect(result.text).toContain("Dashboard Status")
  })

  it("explains that the graph must be initialized before starting", () => {
    const result = runSddCommand(dir, "sdd viz")
    expect(result.matched).toBe(true)
    expect(result.text).toContain("Dashboard Unavailable")
    expect(result.text).toContain("sdd.initialize")
  })

  it("stopping a non-running dashboard is a no-op message", () => {
    const result = runSddCommand(dir, "sdd viz stop")
    expect(result.matched).toBe(true)
    expect(result.text).toContain("not running")
  })

  it("mentions viz in the command hub help", () => {
    const result = runSddCommand(dir, "sdd")
    expect(result.text).toContain("sdd viz")
  })
})
