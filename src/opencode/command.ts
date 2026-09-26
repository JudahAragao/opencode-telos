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
import { createRepository, loadSddConfig } from "../sdd/persistence/repository.js"
import {
  TASK_COLUMN_LABELS,
  TASK_COLUMNS,
  buildIntegrationBrief,
  getPendingIntegrationTasks,
  listTasks,
} from "../sdd/tasks/board.js"
import { formatOpenChangeResult, openChangeForTask } from "../sdd/tasks/change-bridge.js"
import {
  startSharedDashboard,
  stopSharedDashboard,
  getSharedDashboardUrl,
  resolveDashboardPort,
} from "../server/server.js"
import { join as joinPath } from "path"
import { sddDebug } from "../sdd/log.js"
import { AcceptanceService, materializeLegacyAcceptanceCriteria } from "../sdd/acceptance/service.js"
import { addAuditEntry, checkPermission, getUserRoleWithAuth, type Permission } from "../sdd/permissions/access.js"
import { createAcceptanceAuditSink } from "../sdd/acceptance/audit.js"
import { transitionFinalAcceptance } from "../sdd/acceptance/final.js"

/**
 * Command hub interativo para SDD.
 *
 * O plugin registra um handler no hook `command.execute.before`.
 * When OpenCode sees a `sdd <subcommand>` command (or `sdd:<subcommand>`),
 * before any execution the hook intercepts it and runs the matching action
 * deterministically — without depending on the LLM.
 *
 * This is the "new interactive screen" at this stage: a single `sdd` shortcut that
 * roteia para os subcomandos comuns. O atalho `sdd` pode ser invocado como
 * `/sdd`, `/sdd on`, `/sdd status`, `/sdd cache_reset` (ou qualquer forma
 * que o runtime normalize como um command `sdd`).
 *
 * "Show on the home screen" is, in practice, command records. OpenCode already
 * recognizes setup commands (e.g. via `~/.config/opencode/command/`),
 * e o plugin pode anexar uma mensagem de ajuda ao detectar um command
 * unknown/auxiliary. Here we keep that message available and use
 * deterministic routing.
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
 * One entry per `/sdd` subcommand. This table is the single source of truth:
 * the dispatcher, the raw-command grammar, the panel and the tool annotation
 * are all derived from it, so a subcommand cannot exist in one place and be
 * missing from another.
 *
 * `aliases` are the tokens accepted right after the `sdd` prefix. The first one
 * is canonical and is the spelling shown in help output. `takesArgs` marks the
 * subcommands whose arguments make the grammar unbounded (`.*`).
 */
export interface SddSubcommand {
  aliases: string[]
  takesArgs: boolean
  summary: string
  handler: (projectDir: string, input: SddCommandInput) => string
}

const SDD_SUBCOMMANDS: readonly SddSubcommand[] = [
  { aliases: ["panel", "help"], takesArgs: false, summary: "Show this panel.", handler: sddPanel },
  { aliases: ["on", "enable"], takesArgs: false, summary: "Enable SDD enforcement (deterministic).", handler: sddOn },
  { aliases: ["off", "disable"], takesArgs: false, summary: "Disable SDD enforcement (deterministic).", handler: sddOff },
  { aliases: ["status"], takesArgs: false, summary: "Show current toggle state.", handler: sddStatus },
  { aliases: ["renew"], takesArgs: false, summary: "Renew the active workflow window (keeps the same Change).", handler: sddRenew },
  { aliases: ["cache_reset", "cachereset"], takesArgs: false, summary: "Clear caches without killing the session (deterministic).", handler: sddCacheReset },
  { aliases: ["tasks"], takesArgs: true, summary: "List the Kanban task board. Also `tasks board`, `tasks integrate`, `tasks change <TASK-ID>`.", handler: sddTasks },
  { aliases: ["acceptance"], takesArgs: true, summary: "Human acceptance criteria. Also `acceptance accept|reject|waive|create|update|final-accept <ID>`.", handler: sddAcceptance },
  { aliases: ["guide"], takesArgs: true, summary: "Register human guidance: `guide <NODE-ID> <instruction>`.", handler: sddGuide },
  { aliases: ["viz"], takesArgs: true, summary: "Start the Knowledge Graph dashboard (deterministic). Also `viz stop`, `viz status`.", handler: sddViz },
]

/** Canonical subcommand list, one line per entry, for help and error output. */
function sddSubcommandHelp(): string[] {
  return SDD_SUBCOMMANDS.map((entry) => `- \`sdd ${entry.aliases[0]}\` — ${entry.summary}`)
}

/**
 * One-line command reference derived from `SDD_SUBCOMMANDS`, for surfaces that
 * advertise the hub outside `/sdd` itself (tool descriptions, system prompt).
 */
export function sddSubcommandReference(): string {
  return SDD_SUBCOMMANDS.map((entry) => `\`sdd ${entry.aliases[0]}\``).join(", ")
}

/** Compact one-line list, for the `sdd status` footer and the toggle tool. */
export function sddSubcommandNames(): string {
  return SDD_SUBCOMMANDS.map((entry) => `\`/sdd ${entry.aliases[0]}\``).join(", ")
}

/** `cache_reset`, `cache reset` and `cachereset` are the same subcommand. */
function normalizeSubcommand(value: string): string {
  return value.replace(/[\s:_-]+/g, "")
}

/**
 * Resolve the subcommand token to its table entry.
 *
 * Two stages, because an alias may itself contain a separator (`cache reset`)
 * and an accepted subcommand may carry arguments (`tasks change TASK-1`):
 *
 * 1. the whole token, ignoring separators — resolves `cache reset` and stops
 *    `on extra` from being mistaken for `on`;
 * 2. otherwise the first word, but only for entries that declare `takesArgs`,
 *    so `tasks integrate` reaches the task router.
 */
function resolveSddSubcommand(sub: string): SddSubcommand | undefined {
  if (sub === "") return SDD_SUBCOMMANDS.find((entry) => entry.aliases.includes("panel"))

  const normalized = normalizeSubcommand(sub)
  const exact = SDD_SUBCOMMANDS.find((entry) => entry.aliases.some((alias) => normalizeSubcommand(alias) === normalized))
  if (exact) return exact

  const head = normalizeSubcommand(sub.split(/\s+/)[0] ?? "")
  return SDD_SUBCOMMANDS.find((entry) => entry.takesArgs && entry.aliases.some((alias) => normalizeSubcommand(alias) === head))
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

  // `sdd viz`, `sdd:viz` and `sdd-viz` are the same thing: the separator after
  // "sdd" is consumed here so no form falls into the panel by mistake.
  const parts = raw.replace(/^sdd(?:[\s:_-]+|$)/i, "").split(/\s+/).filter(Boolean)
  const subRaw = parts.join(" ").trim().toLowerCase()
  const sub = subRaw.replace(/^[:\-_]/, "").trim()

  const input: SddCommandInput = { command: "sdd", sessionID, arguments: subRaw }

  // Dispatch is a table lookup, so the grammar the panel advertises, the
  // grammar the regex admits and the grammar the router answers can never
  // drift apart. An unknown subcommand is deliberately *not* matched: it is
  // not an SDD command, so it must reach the model instead of being swallowed
  // by a canned error. `extractSddCommandText` applies the same rule to text
  // that arrives outside the TUI, which keeps both entry points identical.
  const entry = resolveSddSubcommand(sub)
  if (!entry) return { matched: false, text: "" }

  return { matched: true, text: entry.handler(projectDir, input) }
}

/**
 * Raw `/sdd ...` command grammar, derived from `SDD_SUBCOMMANDS`.
 * Anchored full-text match so normal prose that merely contains "sdd" is
 * never treated as a command.
 */
const SDD_RAW_COMMAND_RE = new RegExp(
  `^sdd(?:[\\s:_-]+(?:` +
    SDD_SUBCOMMANDS.map((entry) => {
      const alternatives = entry.aliases.map((alias) => alias.replaceAll("_", "[_\\s-]*")).join("|")
      return entry.takesArgs ? `(?:${alternatives})(?:[\\s:_-]+.*)?` : `(?:${alternatives})`
    }).join("|") +
    `))?$`,
  "i",
)

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
    `Commands: ${sddSubcommandNames()}`,
  ].join("\n")
}

/**
 * `/sdd renew` — renova a janela do workflow ativo preservando o Change atual
 * (and the verification report already stored). It is the path for tasks that go
 * beyond the 30 min without repeating `sdd.enforce` and creating an orphan Change.
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
    ...sddSubcommandHelp(),
    "",
    "The panel itself does not modify the graph. It routes to deterministic actions.",
    "",
    `Toggle file: ${joinPath(projectDir, ".sdd", "enabled")}`,
  ].join("\n")
}

/**
 * `/sdd tasks` — board de tasks (Kanban) do dashboard.
 *
 * Deterministic: reads the graph and formats the board; `tasks board` starts the dashboard
 * (same route as `/sdd viz`) and points to the Kanban tab.
 */
function sddAcceptance(projectDir: string, input: SddCommandInput): string {
  const raw = input.arguments.replace(/^acceptance[:\s]*/i, "").trim()
  const parts = raw.split(/\s+/).filter(Boolean)
  const repo = createRepository(projectDir)
  if (!repo.isInitialized()) return "## SDD Acceptance\n\nThe Knowledge Graph is not initialized. Run `sdd.initialize` first."
  const graph = repo.loadGraph()
  const service = new AcceptanceService(graph, loadSddConfig(projectDir).acceptance.legacy_fallback, createAcceptanceAuditSink(projectDir))
  const actor = process.env.USER || process.env.USERNAME || "current"
  const action = (parts[0] || "list").toLowerCase()
  const target = parts[1]

  const requiredPermission: Permission | undefined = action === "accept" || action === "accept-all"
    ? "accept_requirement"
    : action === "reject"
      ? "reject_requirement"
      : action === "waive"
        ? "waive_requirement"
        : action === "reopen"
          ? "reopen_requirement"
    : action === "create" || action === "update" || action === "migrate"
      ? "create_requirement"
      : action === "final-accept"
        ? "accept_final"
        : action === "final-reject"
          ? "reject_final"
          : undefined
  if (requiredPermission && !checkPermission(getUserRoleWithAuth(projectDir, actor), requiredPermission, projectDir)) {
    addAuditEntry(projectDir, actor, `acceptance.${action}`, target || "unknown", "denied", `Missing permission ${requiredPermission}`)
    return `Permission denied: ${requiredPermission}`
  }

  if (action === "list" || action === "summary") {
    if (!target) return "Provide a Requirement ID: `/sdd acceptance REQ-001`."
    if (action === "summary") return JSON.stringify(service.summary(target), null, 2)
    const criteria = service.list(target)
    if (criteria.length === 0) return `No criterion found for ${target}.`
    return [`## Acceptance — ${target}`, "", ...criteria.map((criterion) => `- ${criterion.id} [${criterion.status}] v${criterion.metadata.criterion_version}: ${criterion.metadata.text}`)].join("\n")
  }

  if (["accept", "reject", "waive", "reopen"].includes(action)) {
    if (!target) return "Provide the criterion ID."
    const result = action === "accept"
      ? service.accept(target, { actor })
      : action === "reject"
        ? service.reject(target, { actor })
        : action === "waive"
          ? service.waive(target, { actor, observation: parts.slice(2).join(" ") || "Waived through CLI" })
          : service.reopen(target, { actor })
    repo.saveGraph(graph)
    return `${target} -> ${result.criterion.status}`
  }

  if (action === "accept-all") {
    if (!target) return "Provide the Requirement ID."
    const result = service.acceptAll(target, { actor })
    repo.saveGraph(graph)
    return JSON.stringify(result, null, 2)
  }

  if (action === "create") {
    if (!target || parts.length < 3) return "Usage: `/sdd acceptance create REQ-001 criterion text`."
    const criterion = service.create(target, parts.slice(2).join(" "), undefined, actor)
    repo.saveGraph(graph)
    return `Acceptance criterion created: ${criterion.id}`
  }

  if (action === "update") {
    if (!target || parts.length < 3) return "Usage: `/sdd acceptance update AC-001 new text`."
    const result = service.updateText(target, parts.slice(2).join(" "), { actor })
    repo.saveGraph(graph)
    return `Acceptance criterion ${result.criterion.id} updated to version ${result.criterion.metadata.criterion_version} and returned to PENDING.`
  }

  if (action === "migrate") {
    const result = materializeLegacyAcceptanceCriteria(graph, { removeLegacy: true })
    repo.saveGraph(graph)
    addAuditEntry(projectDir, actor, "acceptance.migrate", "knowledge-graph", "allowed", JSON.stringify(result))
    return JSON.stringify(result, null, 2)
  }

  if (action === "final-accept" || action === "final-reject") {
    if (!target) return "Usage: `/sdd acceptance final-accept CHG-001 [observation]`."
    const result = transitionFinalAcceptance(graph, target, action === "final-accept" ? "ACCEPTED" : "REJECTED", {
      actor,
      observation: parts.slice(2).join(" ") || undefined,
    })
    repo.saveGraph(graph)
    addAuditEntry(projectDir, actor, `acceptance.${action}`, target, "allowed", JSON.stringify(result))
    return `${target} -> final acceptance ${result.status}`
  }

  return "Usage: `/sdd acceptance REQ-001`, `create REQ-001 text`, `update AC-001 text`, `accept AC-001`, `reject AC-001`, `waive AC-001`, `reopen AC-001`, `migrate`, `final-accept CHG-001` or `accept-all REQ-001`."
}

function sddGuide(projectDir: string, input: SddCommandInput): string {
  const raw = input.arguments.replace(/^guide[:\s]*/i, "").trim()
  const match = raw.match(/^(\S+)\s+(.+)$/)
  if (!match) return "Usage: `/sdd guide NODE-001 human guidance`."
  const repo = createRepository(projectDir)
  if (!repo.isInitialized()) return "The Knowledge Graph is not initialized. Run `sdd.initialize` first."
  const { createGuidance } = require("../sdd/guidance/service.js") as typeof import("../sdd/guidance/service.js")
  const graph = repo.loadGraph()
  const actor = process.env.USER || process.env.USERNAME || "current"
  if (!checkPermission(getUserRoleWithAuth(projectDir, actor), "guide_node", projectDir)) {
    addAuditEntry(projectDir, actor, "guidance.create", match[1], "denied", "Missing permission guide_node")
    return "Permission denied: guide_node"
  }
  const guidance = createGuidance(graph, match[1], { instruction: match[2], requested_by: actor })
  repo.saveGraph(graph)
  addAuditEntry(projectDir, actor, "guidance.create", guidance.id, "allowed", match[2])
  return `Guidance created: ${guidance.id} for ${match[1]}`
}

function sddTasks(projectDir: string, input: SddCommandInput): string {
  const rawAction = input.arguments.replace(/^tasks[:\s]*/i, "").trim()
  const action = rawAction.toLowerCase()

  const repo = createRepository(projectDir)
  if (!repo.isInitialized()) {
    return [
      "## SDD Tasks",
      "",
      "The Knowledge Graph is not initialized. Run `sdd.initialize` first.",
    ].join("\n")
  }
  const graph = repo.loadGraph()

  if (action === "integrate" || action === "pending") {
    return buildIntegrationBrief(graph)
  }

  // `/sdd tasks change <TASK-ID> [--approve]` — opens the SDD Change that
  // authorizes the code of the task (the write gate needs an approved Change).
  if (/^change\b/i.test(rawAction)) {
    const rest = rawAction.replace(/^change\b\s*/i, "")
    const approve = /--approve\b/i.test(rest)
    const requested = rest.replace(/--approve\b/i, "").trim()
    if (!requested) {
      return [
        "## SDD Tasks — Change",
        "",
        "Provide the task: `/sdd tasks change TASK-001` (use `--approve` to approve a REVIEW/APPROVAL-level Change).",
        "",
        "Tasks no board:",
        ...listTasks(graph).map((task) => `- ${task.id}: ${task.name}${task.change_id ? ` · ${task.change_id}(${task.change_status})` : ""}`),
      ].join("\n")
    }

    const task = listTasks(graph).find(
      (candidate) =>
        candidate.id.toLowerCase() === requested.toLowerCase() ||
        candidate.name.toLowerCase() === requested.toLowerCase(),
    )
    if (!task) {
      return [
        "## SDD Tasks — Change",
        "",
        `Task \`${requested}\` not found on the board. Run \`/sdd tasks\` to list them.`,
      ].join("\n")
    }

    const result = openChangeForTask(graph, task.id, { approve })
    repo.saveGraph(graph)
    const footer = result.approved
      ? "\nNext step: implement the code covered by the Change (the agent also receives this request through the dashboard)."
      : "\nRun `/sdd tasks change " + task.id + " --approve` to approve it and unlock code writing."
    return formatOpenChangeResult(result) + footer
  }

  if (action === "board" || action === "kanban" || action === "open") {
    try {
      const port = startSharedDashboard(projectDir, resolveDashboardPort())
      const url = getSharedDashboardUrl() ?? `http://127.0.0.1:${port}`
      return [
        "## SDD Task Board",
        "",
        `**URL:** ${url}`,
        "",
        "Open the URL and switch to the **Kanban** tab. Tasks created there are integrated into the SDD by the AI.",
        "",
        "Stop the dashboard with `/sdd viz stop`.",
      ].join("\n")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return [
        "## SDD Task Board Unavailable",
        "",
        `**Reason:** ${message}`,
        "",
        message.toLowerCase().includes("not initialized")
          ? "Initialize the Knowledge Graph first (`sdd.initialize`)."
          : "Retry with `/sdd tasks board`, or set a free port via SDD_DASHBOARD_PORT.",
      ].join("\n")
    }
  }

  const tasks = listTasks(graph)
  if (tasks.length === 0) {
    return [
      "## SDD Tasks",
      "",
      "No tasks on the board yet.",
      "",
      "Open the board with `/sdd tasks board`, or ask the agent to run `sdd.integrate_tasks`.",
    ].join("\n")
  }

  const pending = getPendingIntegrationTasks(graph).length
  const lines = [
    `## SDD Tasks (${tasks.length})`,
    "",
    `**Pending AI integration:** ${pending}`,
    "",
  ]
  for (const column of TASK_COLUMNS) {
    const items = tasks.filter((t) => t.column === column)
    if (items.length === 0) continue
    lines.push(`### ${TASK_COLUMN_LABELS[column]} (${items.length})`)
    for (const task of items) {
      const flag = task.integration_status === "pending" ? " ⏳" : ""
      lines.push(`- ${task.id}: ${task.name}${flag}`)
    }
    lines.push("")
  }
  lines.push("Commands: `/sdd tasks`, `/sdd tasks integrate`, `/sdd tasks board`, `/sdd tasks change <TASK-ID>`")
  return lines.join("\n")
}

/**
 * `/sdd viz` — dashboard do Knowledge Graph.
 *
 * Fully deterministic: starting the server is a side effect and cannot
 * depend on the LLM — the command template even forbids tool calls.
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
 * Detects SDD commands and executes them deterministically.
 *
 * We chose `command.execute.before` because it is the public SDK 1.18 hook that
 * corresponds to a TUI command arriving before execution. The hook
 * permite interceptar e substituir o comportamento de comandos reconhecidos
 * (neste caso, o command `sdd`), sem depender do chat.message/LLM.
 */
export function createSddCommandHooks(projectDir: string): Hooks {
  return {
    config: async (cfg) => {
      // Registra o command `sdd` programaticamente. Isso faz `/sdd` aparecer
      // in the TUI command preview without the user creating `.md` files.
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
      // separated (e.g. command="sdd", arguments="on") or already concatenated
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
