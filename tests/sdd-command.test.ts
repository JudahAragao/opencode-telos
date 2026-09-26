import { describe, expect, test, beforeEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  runSddCommand,
  extractSddCommandText,
  renderSddCommandMessage,
  SDD_COMMAND_TEMPLATE,
} from "../src/opencode/command.js"
import { annotateToolDefinition } from "../src/opencode/sdd-runtime.js"

describe("extractSddCommandText", () => {
  test("detects raw command forms", () => {
    expect(extractSddCommandText("/sdd on")).toBe("sdd on")
    expect(extractSddCommandText("sdd on")).toBe("sdd on")
    expect(extractSddCommandText("sdd status")).toBe("sdd status")
    expect(extractSddCommandText("sdd cache_reset")).toBe("sdd cache_reset")
    expect(extractSddCommandText("sdd cache reset")).toBe("sdd cache reset")
    expect(extractSddCommandText("sdd:off")).toBe("sdd:off")
    expect(extractSddCommandText("/sdd-on")).toBe("sdd-on")
    expect(extractSddCommandText("sdd")).toBe("sdd")
  })

  test("detects template-rendered command messages", () => {
    const rendered = SDD_COMMAND_TEMPLATE.replace("$ARGUMENTS", "on")
    expect(extractSddCommandText(rendered)).toBe("sdd on")
  })

  test("rejects ordinary prose that merely mentions sdd", () => {
    expect(extractSddCommandText("what does /sdd on mean?")).toBeUndefined()
    expect(extractSddCommandText("sdd is great")).toBeUndefined()
    expect(extractSddCommandText("please run sdd on across the cluster")).toBeUndefined()
    expect(extractSddCommandText("")).toBeUndefined()
  })
})

describe("runSddCommand", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sdd-command-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
  })

  test("non-sdd input is not matched", () => {
    const result = runSddCommand(dir, "hello world")
    expect(result.matched).toBe(false)
  })

  test("unknown subcommand is not matched, so it reaches the model", () => {
    const result = runSddCommand(dir, "sdd frobnicate")
    expect(result.matched).toBe(false)
    expect(result.text).toBe("")
  })

  test("on writes the toggle and reports enabled", () => {
    const result = runSddCommand(dir, "sdd on")
    expect(result.matched).toBe(true)
    expect(result.text).toContain("enabled")
    const state = JSON.parse(readFileSync(join(dir, ".sdd", "enabled"), "utf-8"))
    expect(state.enabled).toBe(true)
  })

  test("off writes the toggle and reports disabled", () => {
    const result = runSddCommand(dir, "sdd off")
    expect(result.matched).toBe(true)
    expect(result.text).toContain("disabled")
    const state = JSON.parse(readFileSync(join(dir, ".sdd", "enabled"), "utf-8"))
    expect(state.enabled).toBe(false)
  })

  test("status reports current toggle", () => {
    const result = runSddCommand(dir, "sdd status")
    expect(result.matched).toBe(true)
    expect(result.text).toContain("Status")
  })

  test("panel renders static help", () => {
    const result = runSddCommand(dir, "sdd")
    expect(result.matched).toBe(true)
    expect(result.text).toContain("Command Panel")
  })
})

describe("renderSddCommandMessage", () => {
  let dir: string
  let messageID: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sdd-render-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
    messageID = `msg-${Math.random().toString(36).slice(2)}-${dir.split("-").pop()}`
  })

  test("returns the deterministic result", () => {
    const text = renderSddCommandMessage(dir, "sdd on", messageID)
    expect(text).toContain("enabled")
  })

  test("caches per message id and does not re-execute side effects", () => {
    const first = renderSddCommandMessage(dir, "sdd on", messageID)
    const fileAfterFirst = readFileSync(join(dir, ".sdd", "enabled"), "utf-8")

    const second = renderSddCommandMessage(dir, "sdd on", messageID)
    expect(second).toBe(first)

    const fileAfterSecond = readFileSync(join(dir, ".sdd", "enabled"), "utf-8")
    expect(fileAfterSecond).toBe(fileAfterFirst)
  })

  test("different message ids re-execute", () => {
    const first = renderSddCommandMessage(dir, "sdd on", "msg-a")
    const second = renderSddCommandMessage(dir, "sdd on", "msg-b")
    expect(first).toContain("enabled")
    expect(second).toContain("enabled")
  })
})
describe("retired /sdd tool-names command", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "telos-retired-cmd-"))
  })

  test("is no longer a recognized subcommand", () => {
    for (const raw of ["sdd tool-names", "sdd tool-names safe", "sdd tool_names canonical"]) {
      const result = runSddCommand(dir, raw, "ses_test")
      expect(result.matched, raw).toBe(false)
      expect(result.text, raw).toBe("")
    }
  })

  test("is not advertised by the panel or the status footer", () => {
    for (const raw of ["sdd", "sdd help", "sdd status"]) {
      const result = runSddCommand(dir, raw, "ses_test")
      expect(result.text, raw).not.toContain("tool-names")
    }
  })
})

describe("/sdd grammar is derived from one table", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sdd-grammar-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
  })

  // Every subcommand the hub advertises must behave identically through both
  // entry points: the TUI command and the plain-text admission check. This is
  // the invariant that used to break, because the dispatcher and the regex were
  // two hand-written copies of the same grammar.
  const KNOWN = [
    "sdd", "sdd panel", "sdd help", "sdd on", "sdd enable", "sdd off", "sdd disable",
    "sdd status", "sdd renew", "sdd cache_reset", "sdd cache reset", "sdd cachereset",
    "sdd tasks", "sdd tasks board", "sdd tasks integrate", "sdd tasks change TASK-1",
    "sdd acceptance", "sdd acceptance REQ-1", "sdd guide NODE-1 do the thing",
    "sdd viz", "sdd viz stop", "sdd viz status",
  ] as const

  test("both entry points agree on every known subcommand", () => {
    for (const raw of KNOWN) {
      const asCommand = runSddCommand(dir, raw, "ses_t").matched
      const asText = extractSddCommandText(raw) !== undefined
      expect(asCommand, `dispatch: ${raw}`).toBe(true)
      expect(asText, `text admission: ${raw}`).toBe(true)
    }
  })

  test("both entry points reject what is not a subcommand", () => {
    for (const raw of [
      "sdd bogus", "sdd tool-names", "sdd tool-names safe", "sdd on extra", "sdd frobnicate",
    ]) {
      const asCommand = runSddCommand(dir, raw, "ses_t").matched
      const asText = extractSddCommandText(raw) !== undefined
      expect(asCommand, `dispatch: ${raw}`).toBe(false)
      expect(asText, `text admission: ${raw}`).toBe(false)
    }
  })

  test("ordinary prose is still never treated as a command", () => {
    for (const prose of [
      "what does /sdd on mean?", "sdd is great", "please run sdd on across the cluster",
      "the sdd workflow requires a change", "",
    ]) {
      expect(extractSddCommandText(prose), prose).toBeUndefined()
    }
  })

  test("the advertised list is exactly the dispatchable list", () => {
    const panel = runSddCommand(dir, "sdd", "ses_t").text
    const status = runSddCommand(dir, "sdd status", "ses_t").text
    for (const alias of [
      "on", "off", "status", "renew", "tasks", "acceptance", "guide", "viz", "cache_reset", "panel",
    ]) {
      expect(panel, `panel: ${alias}`).toContain(`\`sdd ${alias}\``)
      expect(status, `status footer: ${alias}`).toContain(`\`/sdd ${alias}\``)
      // and it is real, not just advertised
      expect(runSddCommand(dir, `sdd ${alias}`, "ses_t").matched, `dispatch: ${alias}`).toBe(true)
    }
  })

  test("the tool annotation advertises only real subcommands", () => {
    const annotation = annotateToolDefinition("sdd", undefined) ?? ""
    for (const alias of ["on", "off", "status", "renew", "tasks", "viz", "cache_reset"]) {
      expect(annotation).toContain(`\`sdd ${alias}\``)
      expect(runSddCommand(dir, `sdd ${alias}`, "ses_t").matched).toBe(true)
    }
  })
})
