import type { Hooks } from "@opencode-ai/plugin"
import { setToggleState, getToggleState } from "../sdd/toggle/state.js"
import {
  resetWorkflowState,
  workflowScope,
} from "../sdd/enforcement/workflow-tracker.js"
import { getCacheManager } from "../sdd/cache/manager.js"
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

export interface SddCommandInput {
  command: string
  sessionID: string
  arguments: string
}

import type { Part } from "@opencode-ai/sdk"

export interface SddCommandOutput {
  parts: Part[]
}

function parseCommand(raw: string): { sub: string; args: string } {
  const trimmed = raw.trim()
  const word = trimmed.split(/\s+/)[0] ?? trimmed
  const sub = word.replace(/^sdd:?/, "").trim().toLowerCase()
  const args = trimmed.slice(word.length).trim()
  return { sub, args }
}

function commandNotFound(projectDir: string, input: SddCommandInput): string {
  return [
    "## SDD — Command Hub",
    "",
    "Unrecognized SDD command. Available subcommands:",
    "",
    "- `sdd on` / `sdd:on`            — Enable SDD enforcement.",
    "- `sdd off` / `sdd:off`           — Disable SDD enforcement.",
    "- `sdd status` / `sdd:status`     — Show current SDD toggle.",
    "- `sdd cache_reset` / `sdd:cache_reset` — Full cache reset.",
    "",
    "Toggle and status are executed deterministically by the plugin (no LLM needed).",
    "",
    `Toggle state file: ${joinPath(projectDir, ".sdd", "enabled")}`,
  ].join("\n")
}

function sddOn(projectDir: string, input: SddCommandInput): string {
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
    "Commands: `/sdd on`, `/sdd off`, `/sdd status`, `/sdd cache_reset`",
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

function sddPanel(projectDir: string, input: SddCommandInput): string {
  const state = getToggleState(projectDir)
  const status = state.enabled ? "🟢 ON" : "🔴 OFF"

  return [
    "## SDD — Command Panel",
    "",
    "**Status:** " + status,
    "**Last Changed:** " + state.changed_at,
    "",
    "This panel is an interactive shortcut for the most common SDD operations.",
    "Select a subcommand by typing it explicitly:",
    "",
    "- `sdd on`       — Enable SDD enforcement (deterministic).",
    "- `sdd off`      — Disable SDD enforcement (deterministic).",
    "- `sdd status`   — Show current toggle state.",
    "- `sdd cache_reset` — Clear caches without killing the session.",
    "",
    "The panel itself does not modify the graph. It routes to deterministic actions.",
    "",
    `Toggle file: ${joinPath(projectDir, ".sdd", "enabled")}`,
  ].join("\n")
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
    "command.execute.before": async (input, output) => {
      sddDebug("command", `command.execute.before called: ${input.command} (${input.arguments})`)

      // Reconhece comandos com nomes como:
      //   sdd                 -> panel
      //   sdd on / sdd-on     -> enable
      //   sdd off / sdd-off   -> disable
      //   sdd status          -> status
      //   sdd cache_reset     -> reset
      const normalized = input.command.trim().toLowerCase()
      if (!normalized.startsWith("sdd")) return

      const parts = normalized.split(/\s+/)
      const primary = parts[0]
      const subRaw = parts.slice(1).join(" ").trim().toLowerCase()
      const sub = subRaw.replace(/^[:\-_]/, "").trim()

      let text: string
      const sessionID = input.sessionID ?? "unknown"

      if (sub === "" || sub === "panel" || sub === "help") {
        text = sddPanel(projectDir, { command: input.command, sessionID, arguments: input.arguments })
      } else if (sub === "on" || sub === "enable") {
        text = sddOn(projectDir, { command: input.command, sessionID, arguments: input.arguments })
      } else if (sub === "off" || sub === "disable") {
        text = sddOff(projectDir, { command: input.command, sessionID, arguments: input.arguments })
      } else if (sub === "status") {
        text = sddStatus(projectDir)
      } else if (sub === "cache_reset" || sub === "cachereset" || sub === "cache reset") {
        text = sddCacheReset(projectDir)
      } else {
        text = commandNotFound(projectDir, { command: input.command, sessionID, arguments: input.arguments })
      }

      output.parts = [{ type: "text" as const, text } as Part]
    },
  }
}
