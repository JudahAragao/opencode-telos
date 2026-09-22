import { describe, it, expect, beforeEach } from "bun:test"
import { mkdtempSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createSddTools } from "../src/opencode/tools"
import { CLASSIFIED_TOOLS, isToolClassified } from "../src/sdd/enforcement/workflow-tracker"
import { ALL_TOOL_NAMES, getToolsForSession } from "../src/opencode/router/tool-registry"
import { hasToolCategory, getToolCategories } from "../src/opencode/router/categories"
import { STANDALONE_TOOLS, TOOL_TAXONOMY } from "../src/opencode/router/tool-taxonomy"
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
    const unclassified = registeredTools.filter((name) => !isToolClassified(name))
    expect(unclassified).toEqual([])
  })

  it("reverse-engineering entry points are exempt", () => {
    expect(CLASSIFIED_TOOLS.has("sdd.reverse_engineer")).toBe(true)
    expect(CLASSIFIED_TOOLS.has("sdd.workflow_reverse_engineer")).toBe(true)
  })
})

describe("Public surface has no legacy names", () => {
  const registered = createSddTools()

  it("the system prompt never names a legacy tool", () => {
    const legacyNames = [
      "sdd.add_node", "sdd.update_node", "sdd.remove_node",
      "sdd.add_relationship", "sdd.remove_relationship",
      "sdd.list_nodes", "sdd.count_nodes", "sdd.get_nodes_by_status",
      "sdd.find_path", "sdd.traverse_outgoing", "sdd.traverse_incoming",
      "sdd.traverse_both", "sdd.get_subgraph",
      "sdd.set_role", "sdd.check_permission", "sdd.audit_log",
      "sdd.load_permissions_config", "sdd.check_change_approval",
      "sdd.save_permissions_config", "sdd.get_user_role",
      "sdd.create_snapshot", "sdd.rollback", "sdd.rollback_history", "sdd.list_snapshots",
      "sdd.sync_status", "sdd.sync_pull", "sdd.sync_push",
      "sdd.detect_sync_conflicts", "sdd.merge_graphs",
      "sdd.graph_health", "sdd.graph_health_detail", "sdd.graph_prune",
      "sdd.cache_stats", "sdd.detect_conventions", "sdd.learn_patterns",
      "sdd.analyze_complexity", "sdd.code_metrics", "sdd.detect_smells",
      "sdd.analyze_dependencies", "sdd.verify_usage", "sdd.find_dead_code",
      "sdd.remove_dead_code", "sdd.parse_symbols", "sdd.plan_implementation",
      "sdd.analyze_codebase",
      "sdd.create_migration", "sdd.create_experiment", "sdd.create_flag",
      "sdd.create_tenant", "sdd.onboard_developer", "sdd.security_audit",
      "sdd.analyze_scalability", "sdd.check_compliance", "sdd.setup_monitoring",
      "sdd.generate_dashboard", "sdd.report_incident", "sdd.create_sla",
      "sdd.estimate_cost", "sdd.generate_docs", "sdd.knowledge_transfer",
      "sdd.disaster_recovery_plan", "sdd.config_drift", "sdd.workflow_export",
      "sdd.whitelist_drift", "sdd.unwhitelist_drift", "sdd.list_whitelist",
    ]
    const leaked = legacyNames.filter((name) => SDD_SYSTEM_PROMPT.includes(name))
    expect(leaked).toEqual([])
  })

  it("the generated tool reference is derived from the taxonomy", () => {
    for (const tool of TOOL_TAXONOMY) {
      expect(SDD_TOOL_REFERENCE).toContain(tool.name)
      for (const action of tool.actions) {
        expect(SDD_TOOL_REFERENCE).toContain(`${tool.name}(action="${action.name}")`)
      }
    }
  })

  it("every composite is in the registered tools", () => {
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
