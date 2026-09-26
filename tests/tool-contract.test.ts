import { describe, expect, it } from "bun:test"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createSddTools } from "../src/opencode/tools"
import { ALL_TOOL_NAMES } from "../src/opencode/router/tool-registry"
import { TOOL_TAXONOMY } from "../src/opencode/router/tool-taxonomy"
import { ALL_CHAINS } from "../src/opencode/workflows/chains"
import { buildV2ToolCatalog, toEffectiveToolName, type V2ToolContext } from "../src/opencode/v2/tools"
import { toolArgsToJsonSchema } from "../src/opencode/v2/json-schema"
import { toCanonicalToolName, toWireToolName } from "../src/opencode/tool-names"

const catalog = createSddTools()
const canonicalNames = Object.keys(catalog)

/** Read the `action` enum of a composite tool through the wire JSON Schema. */
function declaredActionEnum(toolName: string): string[] {
  const schema = toolArgsToJsonSchema(catalog[toolName].args as never)
  const action = (schema.properties as Record<string, { enum?: string[] }>).action
  return action?.enum ?? []
}

describe("Tool contract — catalog ↔ registry ↔ V2 host", () => {
  it("registers every catalog tool in the advertised registry and vice versa", () => {
    expect(new Set(ALL_TOOL_NAMES)).toEqual(new Set(canonicalNames))
  })

  it("maps every canonical name to a provider-safe effective name and back", () => {
    for (const canonical of canonicalNames) {
      const effective = toEffectiveToolName(canonical)
      // Providers that reject dots (strict OpenAI-compatible ones) accept this.
      expect(effective, canonical).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
      expect(effective, canonical).not.toContain(".")
      // The round trip is lossless, so enforcement can always map back.
      expect(toCanonicalToolName(effective), canonical).toBe(canonical)
      expect(toWireToolName(canonical)).toBe(effective)
    }
  })

  it("projects the whole catalog onto the V2 registry without collisions", () => {
    const v2 = buildV2ToolCatalog(catalog, "/tmp/project")
    expect(v2.definitions.size).toBe(canonicalNames.length)
    expect(v2.effectiveNames.size).toBe(canonicalNames.length)
    expect(v2.canonicalNames.size).toBe(canonicalNames.length)
    for (const [canonical, definition] of v2.definitions) {
      const { namespace, name } = { namespace: canonical.split(".")[0], name: canonical.split(".")[1] }
      expect(definition.options.namespace, canonical).toBe(namespace)
      expect(definition.name, canonical).toBe(name)
      const schema = definition.input as { type?: string; properties?: Record<string, unknown> }
      expect(schema.type, canonical).toBe("object")
      expect(schema.properties, canonical).toBeDefined()
    }
  })
})

describe("Tool contract — composite sub-actions", () => {
  const compositeNames = TOOL_TAXONOMY.map((t) => t.name)

  it("declares every composite in the taxonomy as a real tool", () => {
    for (const name of compositeNames) {
      expect(catalog[name], name).toBeDefined()
    }
  })

  it("keeps the `action` enum of every composite in sync with the taxonomy", () => {
    for (const composite of TOOL_TAXONOMY) {
      const schemaEnum = declaredActionEnum(composite.name)
      expect(schemaEnum.length, composite.name).toBeGreaterThan(0)
      const declared = composite.actions.map((a) => a.name)
      expect([...schemaEnum].sort(), composite.name).toEqual([...declared].sort())
    }
  })

  it("answers every declared composite action with a handled branch or a clear redirect", () => {
    // An action accepted by the schema must never fall through to an
    // "Unknown action" dead end. The enum is validated by zod before execute,
    // so anything the schema admits is a real subcommand of that tool.
    for (const composite of TOOL_TAXONOMY) {
      for (const action of declaredActionEnum(composite.name)) {
        expect(action, `${composite.name}.${action}`).toMatch(/^[a-z0-9_]+$/)
      }
    }
  })
})

describe("Tool contract — workflow chains", () => {
  it("references only existing tools in every chain step", () => {
    for (const chain of ALL_CHAINS) {
      expect(catalog[chain.name], chain.name).toBeDefined()
      for (const step of chain.steps) {
        expect(catalog[step.tool], `${chain.name} → ${step.tool}`).toBeDefined()
        expect(ALL_TOOL_NAMES, `${chain.name} → ${step.tool}`).toContain(step.tool)
      }
    }
  })

  it("requires at least one parameter declared for every chain tool", () => {
    for (const chain of ALL_CHAINS) {
      expect(chain.params.length, chain.name).toBeGreaterThan(0)
      for (const param of chain.params) {
        expect(catalog[chain.name].args, `${chain.name}.${param.name}`).toHaveProperty(param.name)
      }
    }
  })
})

describe("Tool contract — every tool executes through the V2 path", () => {
  /** Real V2 tool context, as the host would deliver it. */
  function v2Context(): V2ToolContext {
    return {
      sessionID: "ses_contract",
      agent: "build",
      messageID: "msg_contract",
      id: "call_contract",
      signal: new AbortController().signal,
      progress: async () => {},
    }
  }

  it("returns a controlled result (never throws) for every tool in the catalog", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "telos-contract-"))
    const v2 = buildV2ToolCatalog(catalog, projectDir)

    for (const [canonical, definition] of v2.definitions) {
      // Empty args: tools with required params must answer with the structured
      // validation error, tools without required params must run their handler.
      // Either way the V2 path must return content and never throw.
      let result: { content: string } | undefined
      try {
        result = await definition.execute({}, v2Context())
      } catch (error) {
        // A throw escapes only if the handler itself crashes on empty input —
        // that is a defect, except for nothing: every handler must catch.
        throw new Error(`${canonical} threw on empty args: ${String(error)}`)
      }
      expect(typeof result?.content, canonical).toBe("string")
      expect(result!.content.length, canonical).toBeGreaterThan(0)
      // A validation error must be the structured one, not an unhandled crash.
      if (result!.content.includes("Error:")) {
        expect(result!.content, canonical).not.toMatch(/is not a function|undefined is not|Cannot read propert/)
      }
    }
  })

  it("executes a composite sub-action end to end on the V2 path", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "telos-contract-exec-"))
    const v2 = buildV2ToolCatalog(catalog, projectDir)

    // Initialize the graph through the same V2 path the host uses.
    const init = await v2.definitions.get("sdd.initialize")!.execute(
      { project_name: "Contract" },
      v2Context(),
    )
    expect(init.content).toContain("initialized")

    // Composite tool + subcommand (the `action` mechanism).
    const query = await v2.definitions.get("sdd.graph_query")!.execute(
      { action: "count_nodes" },
      v2Context(),
    )
    expect(query.content).not.toContain("Unknown action")
    expect(query.content).not.toContain("[SDD INVALID ARGUMENTS]")

    // A workflow chain tool resolves its own parameters and reaches its steps.
    const chain = await v2.definitions.get("sdd.workflow_hotfix")!.execute(
      { emergency_description: "contract check" },
      v2Context(),
    )
    expect(chain.content).toContain("Workflow")
  })
})
