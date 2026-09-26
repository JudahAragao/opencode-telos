import { describe, expect, it } from "bun:test"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import TelosPlugin from "../src/index"
import { registerSddV2, type V2Context, type V2ToolEditor } from "../src/opencode/v2/hooks"
import { createSddTools } from "../src/opencode/tools"
import { toolArgsToJsonSchema } from "../src/opencode/v2/json-schema"
import { buildV2ToolCatalog, SDD_NAMESPACE, toV1ToolContext } from "../src/opencode/v2/tools"

const TOOL_COUNT = Object.keys(createSddTools()).length

interface RecordedTool {
  name: string
  description: string
  input: Record<string, unknown>
  options?: { namespace?: string; codemode?: boolean }
  execute: (input: unknown, context: never) => Promise<{ content: string }>
}

/** Minimal stand-in for the V2 host, recording everything the plugin registers. */
function createHarness() {
  const namespaces: Array<{ name: string; description: string }> = []
  const tools = new Map<string, RecordedTool>()
  const hooks = new Map<string, (event: never) => unknown>()
  const commands: Array<{
    name: string
    description?: string
    execute(input: { sessionID: string; prompt: { text: string }; delivery: "steer" | "queue" }): Promise<void>
  }> = []
  const prompts: Array<{ sessionID: string; text: string; delivery?: string }> = []
  const synthetics: Array<{ sessionID: string; text: string; resume?: boolean }> = []

  const editor: V2ToolEditor = {
    namespace(ns) {
      namespaces.push(ns)
    },
    add(tool) {
      const value = tool as RecordedTool
      tools.set(value.name, value)
    },
    update(_id, mutate) {
      /* built-in tools are absent from the harness */
    },
    get() {
      return undefined
    },
  }

  const ctx: V2Context = {
    location: { directory: mkdtempSync(join(tmpdir(), "telos-v2-")) },
    tool: {
      transform: async (callback) => {
        callback(editor)
        return { dispose: async () => {} }
      },
      hook: async (name, callback) => {
        hooks.set(name, callback)
        return { dispose: async () => {} }
      },
    },
    session: {
      hook: async (name, callback) => {
        hooks.set(name, callback)
        return { dispose: async () => {} }
      },
      prompt: async (input) => {
        prompts.push(input)
        return undefined
      },
      synthetic: async (input) => {
        synthetics.push(input)
        return undefined
      },
    },
    permission: {
      hook: async (name, callback) => {
        hooks.set(name, callback)
        return { dispose: async () => {} }
      },
    },
    command: {
      transform: async (callback) => {
        callback({ add: (definition) => commands.push(definition) })
        return { dispose: async () => {} }
      },
    },
  }

  return { ctx, namespaces, tools, hooks, commands, prompts, synthetics }
}

function v2ToolContext(projectDir: string) {
  return {
    sessionID: "ses_test",
    agent: "build",
    messageID: "msg_test",
    id: "call_test",
    signal: new AbortController().signal,
    progress: async () => {},
    directory: projectDir,
  } as never
}

describe("V2 SDK — JSON Schema conversion", () => {
  it("converts every Telos tool to an object schema", () => {
    for (const [name, definition] of Object.entries(createSddTools())) {
      const schema = toolArgsToJsonSchema(definition.args as never)
      expect(schema.type, name).toBe("object")
      expect(schema.properties, name).toBeDefined()
      expect(schema.additionalProperties, name).toBe(false)
    }
  })

  it("marks only the truly required keys as required", () => {
    const { properties, required } = toolArgsToJsonSchema(createSddTools()["sdd.findings"].args as never)
    expect(required).toEqual(["action"])
    expect(Object.keys(properties!).sort()).toEqual([
      "action",
      "change_id",
      "description",
      "evidence",
      "finding_id",
      "purpose",
      "status",
      "target_node_ids",
      "task_id",
    ])
  })

  it("emits enum values instead of an empty list", () => {
    const { properties } = toolArgsToJsonSchema(createSddTools()["sdd.graph_query"].args as never)
    expect(properties!.action).toMatchObject({
      type: "string",
      enum: ["count_nodes", "get_nodes_by_status", "list_nodes"],
    })
  })

  it("keeps array item types", () => {
    const { properties, required } = toolArgsToJsonSchema(createSddTools()["sdd.install_hooks"].args as never)
    expect(required).toEqual(["hooks"])
    expect(properties!.hooks).toMatchObject({ type: "array", items: { type: "string" } })
  })
})

describe("V2 SDK — tool catalog projection", () => {
  it("registers every tool under the sdd namespace with codemode off", () => {
    const catalog = buildV2ToolCatalog(createSddTools(), "/tmp/project", async () => {})
    expect(catalog.definitions.size).toBe(TOOL_COUNT)
    for (const [canonical, definition] of catalog.definitions) {
      expect(definition.name, canonical).toBe(canonical.slice("sdd.".length))
      expect(definition.options, canonical).toEqual({ namespace: SDD_NAMESPACE, codemode: false })
    }
  })

  it("maps canonical names to the effective underscore names", () => {
    const catalog = buildV2ToolCatalog(createSddTools(), "/tmp/project", async () => {})
    expect(catalog.effectiveNames.get("sdd.acceptance")).toBe("sdd_acceptance")
    expect(catalog.canonicalNames.get("sdd_acceptance")).toBe("sdd.acceptance")
    expect(catalog.effectiveNames.size).toBe(TOOL_COUNT)
  })

  it("rewrites dotted references inside descriptions to the wire name", () => {
    const catalog = buildV2ToolCatalog(createSddTools(), "/tmp/project", async () => {})
    const description = catalog.definitions.get("sdd.enforce")!.description
    expect(description).not.toContain("sdd.")
  })

  it("returns a zod validation error as tool content instead of throwing", async () => {
    const catalog = buildV2ToolCatalog(createSddTools(), "/tmp/project", async () => {})
    const result = await catalog.definitions.get("sdd.findings")!.execute(
      { action: "not-a-real-action" },
      v2ToolContext("/tmp/project"),
    )
    expect(result.content).toContain("[SDD INVALID ARGUMENTS]")
  })

  it("maps a V1 string result onto the V2 content field", async () => {
    const catalog = buildV2ToolCatalog(createSddTools(), "/tmp/project", async () => {})
    const result = await catalog.definitions.get("sdd.toggle")!.execute(
      { action: "status" },
      v2ToolContext(mkdtempSync(join(tmpdir(), "telos-v2-exec-"))),
    )
    expect(typeof result.content).toBe("string")
    expect(result.content.length).toBeGreaterThan(0)
  })
})

describe("V2 SDK — host registration", () => {
  it("registers the namespace, all tools and the sdd command", async () => {
    const harness = createHarness()
    const result = await registerSddV2(harness.ctx, harness.ctx.location.directory)

    expect(harness.namespaces).toEqual([
      expect.objectContaining({ name: SDD_NAMESPACE }),
    ])
    expect(harness.tools.size).toBe(TOOL_COUNT)
    expect(result.effectiveNames.size).toBe(TOOL_COUNT)
    expect(harness.commands.map((c) => c.name)).toContain("sdd")
  })

  it("registers every documented hook", async () => {
    const harness = createHarness()
    await registerSddV2(harness.ctx, harness.ctx.location.directory)

    expect([...harness.hooks.keys()].sort()).toEqual([
      "context",
      "evaluate",
      "execute.after",
      "execute.before",
      "prompt",
    ])
  })

  it("appends system prompt parts as V2 text parts", async () => {
    const harness = createHarness()
    await registerSddV2(harness.ctx, harness.ctx.location.directory)

    const event = { sessionID: "ses_test", system: [] as Array<{ type: string; text: string }>, messages: [] }
    await (harness.hooks.get("context")! as (e: unknown) => Promise<void>)(event)

    expect(event.system.length).toBeGreaterThan(0)
    for (const part of event.system) {
      expect(part.type).toBe("text")
      expect(typeof part.text).toBe("string")
    }
  })

  it("advertises only wire names in the V2 system prompt", async () => {
    const harness = createHarness()
    await registerSddV2(harness.ctx, harness.ctx.location.directory)

    const event = { sessionID: "ses_test", system: [] as Array<{ type: string; text: string }>, messages: [] }
    await (harness.hooks.get("context")! as (e: unknown) => Promise<void>)(event)

    const text = event.system.map((p) => p.text).join("\n")
    expect(text).toContain("sdd_enforce")
    expect(text).not.toContain("sdd.enforce")
  })

  it("rewrites a stored /sdd message into its deterministic result", async () => {
    const harness = createHarness()
    await registerSddV2(harness.ctx, harness.ctx.location.directory)

    const event = {
      sessionID: "ses_test",
      system: [] as Array<{ type: string; text: string }>,
      messages: [{ role: "user", id: "msg_1", content: [{ type: "text", text: "/sdd status" }] }],
    }
    await (harness.hooks.get("context")! as (e: unknown) => Promise<void>)(event)

    const text = event.messages[0].content[0].text!
    expect(text).not.toBe("/sdd status")
    expect(text).toMatch(/SDD/i)
  })

  it("replaces a raw /sdd prompt with its deterministic result", async () => {
    const harness = createHarness()
    await registerSddV2(harness.ctx, harness.ctx.location.directory)

    const prompt = { text: "/sdd status" }
    ;(harness.hooks.get("prompt")! as (e: unknown) => void)({ sessionID: "ses_test", prompt })
    expect(prompt.text).not.toBe("/sdd status")
  })

  it("leaves ordinary prompts untouched", async () => {
    const harness = createHarness()
    await registerSddV2(harness.ctx, harness.ctx.location.directory)

    const prompt = { text: "please refactor the parser" }
    ;(harness.hooks.get("prompt")! as (e: unknown) => void)({ sessionID: "ses_test", prompt })
    expect(prompt.text).toBe("please refactor the parser")
  })

  it("delivers the /sdd result without dispatching a model turn", async () => {
    const harness = createHarness()
    await registerSddV2(harness.ctx, harness.ctx.location.directory)

    const command = harness.commands.find((c) => c.name === "sdd")!
    await command.execute({ sessionID: "ses_test", prompt: { text: "status" }, delivery: "steer" })

    expect(harness.synthetics).toHaveLength(1)
    expect(harness.synthetics[0].resume).toBe(false)
    expect(harness.prompts).toHaveLength(0)
  })

  it("auto-allows a Telos tool call in the permission hook", async () => {
    const harness = createHarness()
    await registerSddV2(harness.ctx, harness.ctx.location.directory)

    const event = { action: "sdd_acceptance", resources: [] as string[], effect: "ask" as string }
    ;(harness.hooks.get("evaluate")! as (e: unknown) => void)(event)
    expect(event.effect).toBe("allow")
  })

  it("auto-allows a Telos tool named as a resource", async () => {
    const harness = createHarness()
    await registerSddV2(harness.ctx, harness.ctx.location.directory)

    const event = { action: "call", resources: ["sdd.inspect"], effect: "ask" as string }
    ;(harness.hooks.get("evaluate")! as (e: unknown) => void)(event)
    expect(event.effect).toBe("allow")
  })

  it("leaves an unrelated permission request asking", async () => {
    const harness = createHarness()
    await registerSddV2(harness.ctx, harness.ctx.location.directory)

    const event = { action: "write", resources: ["src/app.ts"], effect: "ask" as string }
    ;(harness.hooks.get("evaluate")! as (e: unknown) => void)(event)
    expect(event.effect).toBe("ask")
  })

  it("blocks a file write that has no approved Change", async () => {
    const dir = mkdtempSync(join(tmpdir(), "telos-v2-gate-"))
    const harness = createHarness()
    await registerSddV2(harness.ctx, dir)
    // The gate only applies once a Knowledge Graph exists.
    await (createSddTools()["sdd.initialize"] as never as {
      execute(args: unknown, ctx: unknown): Promise<unknown>
    }).execute({ project_name: "Gate" }, { directory: dir })

    const before = harness.hooks.get("execute.before")! as (e: unknown) => void
    expect(() =>
      before({ tool: "write", sessionID: "ses_test", id: "call_1", input: { filePath: "src/app.ts" } }),
    ).toThrow(/SDD BLOCKED/)
  })

  it("blocks a direct write into .sdd/", async () => {
    const harness = createHarness()
    await registerSddV2(harness.ctx, harness.ctx.location.directory)

    const before = harness.hooks.get("execute.before")! as (e: unknown) => void
    expect(() =>
      before({ tool: "write", sessionID: "ses_test", id: "call_5", input: { filePath: ".sdd/graph.yaml" } }),
    ).toThrow(/SDD BLOCKED/)
  })

  it("blocks a shell command that writes source files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "telos-v2-shell-"))
    const harness = createHarness()
    await registerSddV2(harness.ctx, dir)
    await (createSddTools()["sdd.initialize"] as never as {
      execute(args: unknown, ctx: unknown): Promise<unknown>
    }).execute({ project_name: "Shell" }, { directory: dir })

    const before = harness.hooks.get("execute.before")! as (e: unknown) => void
    expect(() =>
      before({
        tool: "bash",
        sessionID: "ses_test",
        id: "call_6",
        input: { command: "echo x > src/app.ts" },
      }),
    ).toThrow(/SDD BLOCKED/)
  })

  it("leaves an unrelated tool call alone", async () => {
    const harness = createHarness()
    await registerSddV2(harness.ctx, harness.ctx.location.directory)

    const before = harness.hooks.get("execute.before")! as (e: unknown) => void
    expect(() =>
      before({ tool: "read", sessionID: "ses_test", id: "call_2", input: { filePath: "README.md" } }),
    ).not.toThrow()
  })

  it("records completed and failed executions", async () => {
    const harness = createHarness()
    await registerSddV2(harness.ctx, harness.ctx.location.directory)
    const after = harness.hooks.get("execute.after")! as (e: unknown) => void

    expect(() =>
      after({ tool: "sdd.inspect", sessionID: "ses_test", id: "call_3", status: "completed", result: { content: "ok" } }),
    ).not.toThrow()
    expect(() =>
      after({ tool: "sdd.inspect", sessionID: "ses_test", id: "call_4", status: "error", error: { message: "boom" } }),
    ).not.toThrow()
  })

  it("returns a release function that cleans up runtime state", async () => {
    const harness = createHarness()
    const result = await registerSddV2(harness.ctx, harness.ctx.location.directory)
    expect(() => result.release()).not.toThrow()
  })
})

describe("V2 SDK — tool context shim", () => {
  it("maps signal onto the V1 abort and keeps the project directory", () => {
    const controller = new AbortController()
    const context = toV1ToolContext(
      {
        sessionID: "ses_1",
        agent: "build",
        messageID: "msg_1",
        id: "call_1",
        signal: controller.signal,
        progress: async () => {},
      },
      "/tmp/project",
      async () => {},
    )
    expect(context.abort).toBe(controller.signal)
    expect(context.directory).toBe("/tmp/project")
    expect(context.worktree).toBe("/tmp/project")
    expect(context.sessionID).toBe("ses_1")
  })
})

describe("Dual entrypoint", () => {
  it("exposes the V2 id/setup contract and the V1 server export", () => {
    expect(TelosPlugin.id).toBe("opencode-telos")
    expect(typeof TelosPlugin.setup).toBe("function")
    expect(typeof TelosPlugin.server).toBe("function")
  })
})
