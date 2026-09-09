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

  test("unknown subcommand reports command not found", () => {
    const result = runSddCommand(dir, "sdd frobnicate")
    expect(result.matched).toBe(true)
    expect(result.text).toContain("Unrecognized SDD command")
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