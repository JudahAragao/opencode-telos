import { describe, it, expect, beforeEach } from "bun:test"
import { mkdtempSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createSddTools, createSddToolDefinitions } from "../src/opencode/tools"
import { CLASSIFIED_TOOLS, isToolClassified } from "../src/sdd/enforcement/workflow-tracker"
import { ALL_TOOL_NAMES, getToolsForSession } from "../src/opencode/router/tool-registry"
import { hasToolCategory, getToolCategories, STANDALONE_CATEGORIES } from "../src/opencode/router/categories"
import { STANDALONE_TOOLS, TOOL_TAXONOMY, DEPRECATED_TOOLS, isDeprecatedTool, getCompositeForTool } from "../src/opencode/router/tool-taxonomy"
import { runSddCommand, extractSddCommandText } from "../src/opencode/command"
import { SDD_SYSTEM_PROMPT, SDD_TOOL_REFERENCE } from "../src/opencode/system-prompt"

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

  it("every registered tool has an explicit access policy", () => {
    // Guard contra o fail-closed: uma tool sem classificação seria anunciada
    // e depois recusada em runtime por checkToolAccess.
    const unclassified = registeredTools.filter((name) => !isToolClassified(name))
    expect(unclassified).toEqual([])
  })

  it("reverse-engineering entry points are exempt", () => {
    expect(CLASSIFIED_TOOLS.has("sdd.reverse_engineer")).toBe(true)
    expect(CLASSIFIED_TOOLS.has("sdd.workflow_reverse_engineer")).toBe(true)
  })
})

describe("Deprecated tools are removed from the public surface", () => {
  const registered = createSddTools()

  it("registers no deprecated tool", () => {
    const deprecatedRegistered = Object.keys(registered).filter((name) => isDeprecatedTool(name))
    expect(deprecatedRegistered).toEqual([])
  })

  it("does not announce a deprecated tool anywhere", () => {
    const announced = new Set([...ALL_TOOL_NAMES, ...STANDALONE_TOOLS])
    const leaked = DEPRECATED_TOOLS.filter((name) => announced.has(name))
    expect(leaked).toEqual([])
  })

  it("keeps no category entry for a deprecated tool", () => {
    const leaked = DEPRECATED_TOOLS.filter((name) => name in STANDALONE_CATEGORIES)
    expect(leaked).toEqual([])
  })

  it("still exposes every removed handler internally for the composites", () => {
    // Os composites executam os handlers originais: eles não podem sumir do
    // mapa interno, apenas do catálogo público.
    const internal = Object.keys(createSddToolDefinitions())
    const missing = DEPRECATED_TOOLS.filter((name) => !internal.includes(name))
    expect(missing).toEqual([])
  })

  it("every deprecated tool resolves to a composite + action", () => {
    const withoutTarget = DEPRECATED_TOOLS.filter((name) => !getCompositeForTool(name))
    expect(withoutTarget).toEqual([])
  })

  it("the system prompt never names a deprecated tool", () => {
    const leaked = DEPRECATED_TOOLS.filter((name) => SDD_SYSTEM_PROMPT.includes(name))
    expect(leaked).toEqual([])
  })

  it("the generated tool reference is derived from the taxonomy", () => {
    // Fonte única: todo composite e cada uma de suas actions aparecem na
    // referência gerada, e nenhum nome removido aparece nela.
    for (const tool of TOOL_TAXONOMY) {
      expect(SDD_TOOL_REFERENCE).toContain(tool.name)
      for (const action of tool.actions) {
        expect(SDD_TOOL_REFERENCE).toContain(`${tool.name}(action="${action.name}")`)
      }
    }
    const leaked = DEPRECATED_TOOLS.filter((name) => SDD_TOOL_REFERENCE.includes(name))
    expect(leaked).toEqual([])
  })

  it("every composite action target is actually callable", () => {
    for (const tool of TOOL_TAXONOMY) {
      for (const action of tool.actions) {
        expect(getCompositeForTool(action.replaces[0])).toEqual({ composite: tool.name, action: action.name })
      }
    }
    // A superfície pública tem exatamente um nome por capacidade.
    expect(Object.keys(registered)).toEqual(expect.arrayContaining(TOOL_TAXONOMY.map((t) => t.name)))
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
