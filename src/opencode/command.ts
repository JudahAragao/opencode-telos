import type { Hooks } from "@opencode-ai/plugin"
import { setToggleState, getToggleState } from "../sdd/toggle/state.js"
import {
  resetWorkflowState,
  workflowScope,
  renewWorkflow,
  workflowTtlMs,
  getWorkflowState,
} from "../sdd/enforcement/workflow-tracker.js"
import { getCacheManager } from "../sdd/cache/manager.js"
import {
  startSharedDashboard,
  stopSharedDashboard,
  getSharedDashboardUrl,
  resolveDashboardPort,
} from "../server/server.js"
import { join as joinPath } from "path"
import { sddDebug } from "../sdd/log.js"

/**
 * Command hub interativo para SDD.
 *
 * O plugin registra um handler no hook `command.execute.before`.
 * Quando o OpenCode vê um comando `sdd <subcommand>` (ou `sdd:<subcommand>`),
 * antes de qualquer execução, o hook intercepta e executa a ação correspondente
 * de forma determinística — sem depender do LLM.
 *
 * Essa é a "tela interativa nova" nesse estágio: um único atalho `sdd` que
 * roteia para os subcomandos comuns. O atalho `sdd` pode ser invocado como
 * `/sdd`, `/sdd on`, `/sdd status`, `/sdd cache_reset` (ou qualquer forma
 * que o runtime normalize como um command `sdd`).
 *
 * "Exibir na tela inicial" é, na prática, registros de comando. O sistema
 * do OpenCode já reconhece comandos setup (ex: via `~/.config/opencode/command/`),
 * e o plugin pode anexar uma mensagem de ajuda ao detectar um command
 * desconhecido/auxiliar. Aqui deixamos essa mensagem disponível e usamos
 * o roteamento determinístico.
 */

export const SDD_COMMAND_NAME = "sdd"
export const SDD_COMMAND_DESCRIPTION =
  "SDD command hub: enable/disable enforcement, show status, open the dashboard, or reset caches (deterministic, no LLM needed)."

/**
 * Template registered via `config(cfg).command` so `/sdd` shows up in the
 * command preview without the user having to create `.md` files.
 *
 * The deterministic action is already executed by `command.execute.before`.
 * OpenCode still dispatches an LLM turn after the hook (no `noReply` in
 * @opencode-ai/plugin 1.18). This template constrains that turn to only echo
 * the plugin result — no tool calls, no file changes, no workflow mutation.
 */
export const SDD_COMMAND_TEMPLATE = [
  "You are the interactive hub for the opencode-telos SDD plugin.",
  "",
  "The request has ALREADY been handled deterministically by the plugin runtime. Its exact result is in the 'User input' at the end of this message.",
  "",
  "REQUIRED BEHAVIOR:",
  "- Reply ONLY with the result text found in 'User input', reproducing it verbatim.",
  "- Do NOT call any tools.",
  "- Do NOT create, modify, or delete any files.",
  "- Do NOT execute, re-run, or alter any /sdd command — the side effects already happened.",
  "- Do NOT investigate, summarize, or question the result.",
  "",
  "If 'User input' contains no result, reply ONLY with: 'SDD command executed. Run /sdd status to see the current state.'",
  "",
  "User input:",
  "$ARGUMENTS",
].join("\n")

export interface SddCommandInput {
  command: string
  sessionID: string
  arguments: string
}

import type { Part } from "@opencode-ai/sdk"

export interface SddCommandOutput {
  parts: Part[]
}

export interface SddCommandResult {
  matched: boolean
  text: string
}

/**
 * Tracks the deterministic result produced for each command message (keyed by
 * message id). The runtime re-invokes `experimental.chat.messages.transform`
 * on every LLM turn, re-sending stored command messages; this cache prevents
 * re-executing side effects (toggle writes, cache resets) on later turns.
 */
const executedSddCommands = new Map<string, string>()

/**
 * Execute an SDD command deterministically (no LLM involved) and return its
 * result text. Side effects (toggle write, cache reset, workflow reset) are
 * applied here; the caller decides when that is appropriate.
 */
export function runSddCommand(
  projectDir: string,
  rawInput: string,
  sessionID = "unknown",
): SddCommandResult {
  const raw = rawInput.replace(/^[/\s]+/, "").trim().toLowerCase()
  if (!raw.startsWith("sdd")) return { matched: false, text: "" }

  // `sdd viz`, `sdd:viz` e `sdd-viz` são a mesma coisa: o separador depois de
  // "sdd" é consumido aqui para que nenhuma forma caia no painel por engano.
  const parts = raw.replace(/^sdd(?:[\s:_-]+|$)/i, "").split(/\s+/).filter(Boolean)
  const subRaw = parts.join(" ").trim().toLowerCase()
  const sub = subRaw.replace(/^[:\-_]/, "").trim()

  const input: SddCommandInput = { command: "sdd", sessionID, arguments: subRaw }

  let text: string
  if (sub === "" || sub === "panel" || sub === "help") {
    text = sddPanel(projectDir, input)
  } else if (sub === "on" || sub === "enable") {
    text = sddOn(projectDir, input)
  } else if (sub === "off" || sub === "disable") {
    text = sddOff(projectDir, input)
  } else if (sub === "status") {
    text = sddStatus(projectDir)
  } else if (sub === "renew") {
    text = sddRenew(projectDir, input)
  } else if (sub === "cache_reset" || sub === "cachereset" || sub === "cache reset") {
    text = sddCacheReset(projectDir)
  } else if (sub === "viz" || sub.startsWith("viz ") || sub.startsWith("viz:")) {
    text = sddViz(projectDir, input)
  } else {
    text = commandNotFound(projectDir, input)
  }

  return { matched: true, text }
}

/**
 * Raw `/sdd ...` command grammar, restricted to the known subcommands.
 * Anchored full-text match so normal prose that merely contains "sdd" is
 * never treated as a command.
 */
const SDD_RAW_COMMAND_RE = /^sdd(?:[\s:_-]+(?:on|off|status|enable|disable|panel|help|renew|cache[_\s-]*reset|viz(?:[\s:_-]+(?:start|stop|status))?))?$/i

/**
 * Detect a user message that is (or renders) an SDD command and normalize it
 * to the canonical `sdd <sub>` form:
 *   - raw command form: `/sdd on`, `sdd on`, `sdd-on`, `sdd:on`, `sdd`
 *   - template-rendered form produced by the registered `sdd` command
 * Returns undefined when the text is not an SDD command message.
 */
export function extractSddCommandText(text: string): string | undefined {
  const normalized = text.trim()
  const lower = normalized.toLowerCase()

  const stripped = normalized.replace(/^[/\s]+/, "")
  if (SDD_RAW_COMMAND_RE.test(stripped)) return stripped.trim()

  if (lower.startsWith("you are the interactive hub for the opencode-telos sdd plugin")) {
    const idx = lower.lastIndexOf("user input:")
    if (idx === -1) return undefined
    const args = normalized.slice(idx + "user input:".length).trim()
    return args.length > 0 ? `sdd ${args}` : "sdd"
  }

  return undefined
}

/**
 * Produce (and cache) the deterministic result for an SDD command message so
 * the model receives the same text on every LLM turn without repeating the
 * side effect. Executes the command on first sight for a given message id.
 */
export function renderSddCommandMessage(
  projectDir: string,
  raw: string,
  messageID: string | undefined,
  sessionID = "unknown",
): string {
  if (messageID) {
    const cached = executedSddCommands.get(messageID)
    if (cached !== undefined) return cached
  }
  const result = runSddCommand(projectDir, raw, sessionID)
  if (result.matched && messageID) executedSddCommands.set(messageID, result.text)
  return result.text
}

function commandNotFound(projectDir: string, _input: SddCommandInput): string {
  return [
    "## SDD — Command Hub",
    "",
    "Unrecognized SDD command. Available subcommands:",
    "",
    "- `sdd on` / `sdd:on`            — Enable SDD enforcement.",
    "- `sdd off` / `sdd:off`           — Disable SDD enforcement.",
    "- `sdd status` / `sdd:status`     — Show current SDD toggle.",
    "- `sdd renew`                     — Renew the active workflow window (keeps the same Change).",
    "- `sdd viz`                       — Start the Knowledge Graph dashboard.",
    "- `sdd viz stop`                  — Stop the dashboard.",
    "- `sdd viz status`                — Show the dashboard URL.",
    "- `sdd cache_reset` / `sdd:cache_reset` — Full cache reset.",
    "",
    "Toggle, status, viz and cache_reset are executed deterministically by the plugin (no LLM needed).",
    "",
    `Toggle state file: ${joinPath(projectDir, ".sdd", "enabled")}`,
  ].join("\n")
}

function sddOn(projectDir: string, _input: SddCommandInput): string {
  const state = setToggleState(projectDir, true)
  return [
    "✅ SDD enforcement **enabled** at " + state.changed_at + ".",
    "",
    "Spec-Driven Development is now active. All code changes will go through the SDD workflow.",
    "",
    `Toggle written to: ${joinPath(projectDir, ".sdd", "enabled")}`,
  ].join("\n")
}

function sddOff(projectDir: string, input: SddCommandInput): string {
  const state = setToggleState(projectDir, false)
  resetWorkflowState(workflowScope(projectDir, input.sessionID))
  return [
    "⏸️ SDD enforcement **disabled** at " + state.changed_at + ".",
    "",
    "You can now make code changes freely without SDD workflow. Use `/sdd on` to re-enable.",
    "",
    `Toggle written to: ${joinPath(projectDir, ".sdd", "enabled")}`,
  ].join("\n")
}

function sddStatus(projectDir: string): string {
  const state = getToggleState(projectDir)
  const status = state.enabled ? "🟢 ON" : "🔴 OFF"
  return [
    "## SDD Toggle Status",
    "",
    "**Status:** " + status,
    "**Last Changed:** " + state.changed_at,
    "",
    `Toggle file: ${joinPath(projectDir, ".sdd", "enabled")}`,
    "",
    "Commands: `/sdd on`, `/sdd off`, `/sdd status`, `/sdd renew`, `/sdd viz`, `/sdd cache_reset`",
  ].join("\n")
}

/**
 * `/sdd renew` — renova a janela do workflow ativo preservando o Change atual
 * (e o laudo de verificação já gravado). É o caminho para tarefas que passam
 * dos 30 min sem precisar repetir `sdd.enforce` e criar um Change órfão.
 */
function sddRenew(projectDir: string, input: SddCommandInput): string {
  const scope = workflowScope(projectDir, input.sessionID)
  const active = getWorkflowState(scope)
  const result = renewWorkflow(undefined, scope)

  if (!result.renewed) {
    return [
      "## SDD Workflow: NOT RENEWED",
      "",
      result.reason || "Unknown reason.",
      "",
      "Start a workflow with `sdd.enforce` (or the `sdd.enforce` tool) before renewing.",
    ].join("\n")
  }

  return [
    `## SDD Workflow Renewed (${result.changeId})`,
    "",
    `**Valid again for:** ${Math.round(workflowTtlMs() / 60000)} min`,
    `**Expires at:** ${result.expiresAt ? new Date(result.expiresAt).toISOString() : "n/a"}`,
    `**Approved:** ${active.approved ? "yes" : "no"}`,
    "",
    "The active Change and its verification report are preserved.",
  ].join("\n")
}

function sddCacheReset(projectDir: string): string {
  const cacheMgr = getCacheManager(projectDir)
  const result = cacheMgr.fullReset()
  const lines = [
    "## 🧹 Cache Reset Complete",
    "",
    "- Memory cache: " + (result.cleared.memory ? "✅ cleared" : "⏭️ skipped"),
    "- Persistent cache: " + (result.cleared.disk ? "✅ cleared" : "⏭️ no file"),
    "- Graph snapshot: " + (result.cleared.snapshot ? "✅ cleared" : "⏭️ no snapshot"),
    "- Lock file: " + (result.cleared.lock ? "✅ released" : "⏭️ no lock"),
    "",
    "Invalidation version: " + cacheMgr.getInvalidationVersion(),
    "",
    "The next tool call will recompute fresh results.",
  ]
  return lines.join("\n")
}

function sddPanel(projectDir: string, _input: SddCommandInput): string {
  const state = getToggleState(projectDir)
  const status = state.enabled ? "🟢 ON" : "🔴 OFF"
  const dashboardUrl = getSharedDashboardUrl()

  return [
    "## SDD — Command Panel",
    "",
    "**Status:** " + status,
    "**Last Changed:** " + state.changed_at,
    "**Dashboard:** " + (dashboardUrl ?? "not running"),
    "",
    "This panel is an interactive shortcut for the most common SDD operations.",
    "Select a subcommand by typing it explicitly:",
    "",
    "- `sdd on`       — Enable SDD enforcement (deterministic).",
    "- `sdd off`      — Disable SDD enforcement (deterministic).",
    "- `sdd status`   — Show current toggle state.",
    "- `sdd renew`    — Renew the active workflow window (keeps the same Change).",
    "- `sdd viz`      — Start the Knowledge Graph dashboard (deterministic).",
    "- `sdd viz stop` — Stop the dashboard.",
    "- `sdd cache_reset` — Clear caches without killing the session.",
    "",
    "The panel itself does not modify the graph. It routes to deterministic actions.",
    "",
    `Toggle file: ${joinPath(projectDir, ".sdd", "enabled")}`,
  ].join("\n")
}

/**
 * `/sdd viz` — dashboard do Knowledge Graph.
 *
 * Totalmente determinístico: subir o servidor é um efeito colateral e não pode
 * depender do LLM — o template do comando inclusive proíbe tool calls.
 */
function sddViz(projectDir: string, input: SddCommandInput): string {
  const action = input.arguments.replace(/^viz[:\s]*/i, "").trim().toLowerCase()

  if (action === "stop" || action === "off") {
    const stopped = stopSharedDashboard()
    return [
      stopped ? "🛑 SDD dashboard **stopped**." : "ℹ️ SDD dashboard is not running.",
      "",
      "Start it again with `/sdd viz`.",
    ].join("\n")
  }

  if (action === "status") {
    const url = getSharedDashboardUrl()
    return [
      "## SDD Dashboard Status",
      "",
      `**Running:** ${url ?? "no"}`,
      `**Preferred port:** ${resolveDashboardPort()} (override with SDD_DASHBOARD_PORT)`,
      "",
      "Commands: `/sdd viz`, `/sdd viz stop`, `/sdd viz status`",
    ].join("\n")
  }

  try {
    const port = startSharedDashboard(projectDir, resolveDashboardPort())
    const url = getSharedDashboardUrl() ?? `http://127.0.0.1:${port}`
    return [
      "## SDD Dashboard Running",
      "",
      `**URL:** ${url}`,
      "",
      "Open the URL in a browser to view the Knowledge Graph in real time",
      "(auto-refresh every 5 seconds).",
      "",
      "Stop it with `/sdd viz stop`.",
    ].join("\n")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [
      "## SDD Dashboard Unavailable",
      "",
      `**Reason:** ${message}`,
      "",
      message.toLowerCase().includes("not initialized")
        ? "Initialize the Knowledge Graph first (`sdd.initialize`) and run `/sdd viz` again."
        : "Retry with `/sdd viz`, or set a free port via SDD_DASHBOARD_PORT.",
    ].join("\n")
  }
}

/**
 * Detecta comandos SDD e os executa de forma determinística.
 *
 * Escolhemos `command.execute.before` porque é o hook público do SDK 1.18 que
 * corresponde à chegada de um command do TUI antes de sua execução. O hook
 * permite interceptar e substituir o comportamento de comandos reconhecidos
 * (neste caso, o command `sdd`), sem depender do chat.message/LLM.
 */
export function createSddCommandHooks(projectDir: string): Hooks {
  return {
    config: async (cfg) => {
      // Registra o command `sdd` programaticamente. Isso faz `/sdd` aparecer
      // no preview de comandos do TUI sem o usuário criar arquivos `.md`.
      cfg.command = cfg.command ?? {}
      if (!cfg.command.sdd) {
        cfg.command.sdd = {
          template: SDD_COMMAND_TEMPLATE,
          description: SDD_COMMAND_DESCRIPTION,
        }
      }
    },

    "command.execute.before": async (input, output) => {
      sddDebug("command", `command.execute.before called: ${input.command} (${input.arguments})`)

      // Reconhece comandos com nomes como:
      //   sdd                 -> panel
      //   sdd on / sdd-on     -> enable
      //   sdd off / sdd-off   -> disable
      //   sdd status          -> status
      //   sdd renew           -> renew the active workflow window
      //   sdd cache_reset     -> reset
      // O runtime pode entregar o comando como `command` + `arguments`
      // separados (ex: command="sdd", arguments="on") ou já concatenados
      // (ex: command="/sdd on"). Normalizamos ambas as formas.
      const raw = `${input.command} ${input.arguments ?? ""}`.replace(/^[/\s]+/, "").trim().toLowerCase()
      if (!raw.startsWith("sdd")) return

      const sessionID = input.sessionID ?? "unknown"
      const result = runSddCommand(projectDir, raw, sessionID)
      if (!result.matched) return

      output.parts = [{ type: "text" as const, text: result.text } as Part]
    },
  }
}
