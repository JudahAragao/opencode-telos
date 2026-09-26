/**
 * Runtime policy shared by the V1 and V2 plugin hosts.
 *
 * The V1 host (OpenCode 1.18) delivers hook events as `(input, output)` pairs and
 * the V2 host (`@opencode/plugin` 2.x) delivers a single mutable event. To keep
 * the enforcement rules — SDD-first write gate, shell bypass prevention, audit
 * log, execution ledger, telemetry, snapshots, cache invalidation — byte for byte
 * identical on both hosts, every rule lives here as a plain function and each
 * host only adapts the event shape.
 *
 * Nothing in this module may import a host SDK: it is pure domain logic.
 */

import { createRepository } from "../sdd/persistence/repository.js"
import { SDD_CORE_SYSTEM_PROMPT, buildSddContextPack } from "./system-prompt.js"
import { validateGraph } from "../sdd/validation/validator.js"
import { getPendingChanges } from "../sdd/changes/manager.js"
import { isSddEnabled } from "../sdd/toggle/state.js"
import { checkPermission, getUserRoleWithAuth, addAuditEntry } from "../sdd/permissions/access.js"
import { createSnapshot } from "../sdd/rollback/manager.js"
import { getCacheManager } from "../sdd/cache/manager.js"
import { checkToolAccess, getWorkflowState, markSpecUpdated, workflowScope } from "../sdd/enforcement/workflow-tracker.js"
import { ALL_TOOL_NAMES, getToolsForSession } from "./router/tool-registry.js"
import { invalidateSnapshotCache } from "./router/graph-state-snapshot.js"
import { hasPendingMigrations } from "../sdd/migrations/index.js"
import { graphFingerprint, sourceFingerprint } from "../sdd/cache/fingerprint.js"
import { sddDebug } from "../sdd/log.js"
import { projectPath } from "../sdd/security/paths.js"
import { getPendingIntegrationTasks } from "../sdd/tasks/board.js"
import { getTasksAwaitingChangeApproval } from "../sdd/tasks/change-bridge.js"
import { setDashboardSessionID } from "../server/dashboard-context.js"
import { finishExecution, findLatestExecutionByCall, startExecution } from "../sdd/execution/ledger.js"
import { recordTelemetry } from "../sdd/monitoring/telemetry.js"
import { restoreToolNames, rewriteToolNames, toCanonicalToolName, toWireToolName } from "./tool-names.js"
import { extractSddCommandText, renderSddCommandMessage } from "./command.js"

/** File extensions treated as source code for the SDD write gate. */
const SDD_FILE_PATTERNS = [
  /\.ts$/,
  /\.tsx$/,
  /\.js$/,
  /\.jsx$/,
  /\.py$/,
  /\.go$/,
  /\.rs$/,
  /\.java$/,
  /\.rb$/,
  /\.vue$/,
  /\.svelte$/,
]

const SDD_EXCLUDED_PATTERNS = [
  /node_modules/,
  /\.sdd\//,
  /dist\//,
  /build\//,
  /\.git\//,
  /\.opencode\//,
  /package\.json/,
  /tsconfig\.json/,
  /\.env/,
]

/**
 * Patterns that indicate a shell command is writing source files.
 * Used to enforce SDD-first even when agents try to bypass via a terminal tool.
 */
const SRC_EXT = /\.(?:ts|tsx|js|jsx|mjs|mts|py|go|rs|java|rb|vue|svelte|c|cpp|h|hpp|cs|swift|kt)$/

const SHELL_WRITE_PATTERNS: Array<{ pattern: RegExp; extractor: (match: RegExpMatchArray) => string[] }> = [
  // open('file','w').write(...) pattern (primary detection for python heredocs and -c)
  {
    pattern: /open\(['"]([^'"]+)['"]/g,
    extractor: (m) => [m[1]],
  },
  // node -e "fs.writeFileSync('file',...)"
  {
    pattern: /node\s+(-e|--eval)\s+['"].*writeFile(?:Sync)?\s*\(\s*['"]([^'"]+)['"]/,
    extractor: (m) => [m[2]],
  },
  // touch file.ts (creates new files)
  {
    pattern: /touch\s+(\S+\.\w+)/,
    extractor: (m) => [m[1]],
  },
  // install [options] source dest.ts (copies/creates files)
  {
    pattern: /install\s+(?:[^\s]+\s+)*?(\S+\.\w+)\s*$/,
    extractor: (m) => [m[1]],
  },
  // dd if=... of=file.ts
  {
    pattern: /dd\s+.*of=([^\s>]+)/,
    extractor: (m) => [m[1]],
  },
  // truncate -s 0 file.ts or truncate --size=0 file.ts
  {
    pattern: /truncate\s+(?:\S+\s+)*?(\S+\.\w+)$/,
    extractor: (m) => [m[1]],
  },
  // Generic shell redirect: any command > file.ts or >> file.ts
  {
    pattern: />\s*(\S+\.\w+)/,
    extractor: (m) => [m[1]],
  },
  // sed -i 's/...' file.ts
  {
    pattern: /sed\s+(-i[^\s]*|--in-place)\s+['"][^"]*['"]\s+([^\s]+)/,
    extractor: (m) => [m[2]],
  },
  // mv/rename to source file
  {
    pattern: /mv\s+\S+\s+(\S+\.\w+)/,
    extractor: (m) => [m[1]],
  },
  // cp source dest (copying to source file)
  {
    pattern: /cp\s+\S+\s+(\S+\.\w+)/,
    extractor: (m) => [m[1]],
  },
  // tee file.ts
  {
    pattern: /tee\s+(?:-a\s+)?(\S+\.\w+)/,
    extractor: (m) => [m[1]],
  },
]

/**
 * Detect if a shell command attempts to write source code files.
 * Returns extracted file paths that match source patterns.
 * Exported for testing.
 */
export function detectShellFileWrites(command: string): string[] {
  const files: string[] = []

  for (const { pattern, extractor } of SHELL_WRITE_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0

    if (pattern.global) {
      let match: RegExpMatchArray | null
      while ((match = pattern.exec(command)) !== null) {
        const paths = extractor(match)
        for (const p of paths) {
          if (p && SRC_EXT.test(p) && !SDD_EXCLUDED_PATTERNS.some((ep) => ep.test(p))) {
            files.push(p)
          }
        }
      }
    } else {
      const match = command.match(pattern)
      if (match) {
        const paths = extractor(match)
        for (const p of paths) {
          if (p && SRC_EXT.test(p) && !SDD_EXCLUDED_PATTERNS.some((ep) => ep.test(p))) {
            files.push(p)
          }
        }
      }
    }
  }

  // Also detect heredoc-style writes (python3 - <<'EOF' ... open('file','w') ... EOF)
  // These are multi-line patterns; the command string may contain newlines
  if (/python[3]?\s+\-/.test(command) || /node\s+(-e|--eval)/.test(command)) {
    // Extract all open('file','w') or writeFileSync calls
    const openPattern = /open\(['"]([^'"]+)['"]/g
    let match: RegExpMatchArray | null
    while ((match = openPattern.exec(command)) !== null) {
      const p = match[1]
      if (p && SRC_EXT.test(p) && !SDD_EXCLUDED_PATTERNS.some((ep) => ep.test(p))) {
        if (!files.includes(p)) files.push(p)
      }
    }

    const writePattern = /writeFile(?:Sync)?\s*\(\s*['"]([^'"]+)['"]/g
    while ((match = writePattern.exec(command)) !== null) {
      const p = match[1]
      if (p && SRC_EXT.test(p) && !SDD_EXCLUDED_PATTERNS.some((ep) => ep.test(p))) {
        if (!files.includes(p)) files.push(p)
      }
    }
  }

  return [...new Set(files)]
}

/**
 * Mutable per-host runtime state.
 *
 * The system prompt is rebuilt only when the graph or the source tree actually
 * changes, so a long session does not re-read the repository on every turn.
 */
export interface SddRuntimeState {
  systemInjected: boolean
  injectedGraphFingerprint: string
  injectedSourceSignature: string
  activeExecutions: Map<string, ReturnType<typeof startExecution>>
}

export function createRuntimeState(): SddRuntimeState {
  return {
    systemInjected: false,
    injectedGraphFingerprint: "",
    injectedSourceSignature: "",
    activeExecutions: new Map(),
  }
}

/** Tools whose success must invalidate the injected graph snapshot. */
const SNAPSHOT_INVALIDATING_TOOLS = [
  "sdd.build_graph", "sdd.update_from_answers",
  "sdd.enforce", "sdd.approve_change", "sdd.complete_change",
  "sdd.generate_code",
  // Storage migration: backend changed — force full system re-injection
  // so the next turn shows the new "Storage: sqlite/yaml" line.
  "sdd.migrate_storage",
  // Composite tools
  "sdd.graph_mutation", "sdd.graph_admin",
  "sdd.workflow_new_feature", "sdd.workflow_bug_fix",
  "sdd.workflow_hotfix", "sdd.workflow_refactor",
  "sdd.workflow_full_cycle",
  // Reverse engineering: mutates graph from codebase scan
  "sdd.reverse_engineer", "sdd.workflow_reverse_engineer",
]

/** Tools that satisfy the "spec was updated after enforce" gate. */
const SPEC_MUTATION_TOOLS = new Set([
  "sdd.update_from_answers",
  "sdd.build_graph",
  "sdd.generate_code",
  // Reverse engineering builds spec from codebase
  "sdd.reverse_engineer",
  // Composite tools that update spec
  "sdd.graph_mutation", "sdd.graph_admin",
  "sdd.workflow_new_feature", "sdd.workflow_bug_fix",
  "sdd.workflow_hotfix", "sdd.workflow_refactor",
  "sdd.workflow_full_cycle",
  "sdd.workflow_reverse_engineer",
])

/**
 * Normalize a host tool id to a comparison key.
 *
 * V1 spells its file tools `Write` / `Edit` / `run_terminal_command`; V2 uses
 * lowercase ids such as `read` / `edit` / `bash`. Enforcement must fire on both,
 * so every host tool id is reduced to lowercase alphanumerics before matching.
 */
export function normalizeToolId(toolId: string): string {
  return toolId.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/** File-mutating tools, across V1 and V2 spellings. */
const FILE_WRITE_TOOL_IDS = new Set([
  "write", "edit", "multiedit", "writefile", "editfile", "patch", "applypatch", "str_replace_editor",
])

/** Terminal/shell tools, across V1 and V2 spellings. */
const SHELL_TOOL_IDS = new Set([
  "runterminalcommand", "bash", "shell", "terminal", "runcommand", "executecommand", "sh",
])

export function isFileWriteTool(toolId: string): boolean {
  return FILE_WRITE_TOOL_IDS.has(normalizeToolId(toolId))
}

export function isShellTool(toolId: string): boolean {
  return SHELL_TOOL_IDS.has(normalizeToolId(toolId))
}

/**
 * Enforce the SDD-first gate before a tool runs.
 *
 * Returns `undefined` when the call may proceed, or the blocking message when it
 * must not. Callers translate the message into their host's error mechanism
 * (`throw` in both V1 and V2).
 */
export function enforceToolExecution(
  projectDir: string,
  sessionID: string,
  callID: string,
  hostToolId: string,
  args: Record<string, unknown> | undefined,
  state: SddRuntimeState,
  safeToolNames: boolean,
): string | undefined {
  const toolName = toCanonicalToolName(hostToolId, ALL_TOOL_NAMES, safeToolNames)
  // Skip enforcement if SDD is disabled
  if (!isSddEnabled(projectDir)) return

  const repository = createRepository(projectDir)
  const execution = startExecution({
    runId: `OC-${sessionID}-${callID}`,
    projectDir,
    sessionId: sessionID,
    callId: callID,
    toolName,
  }, {
    id: `CALL-${callID}`,
    args: (args || {}) as Record<string, unknown>,
    graphFingerprintBefore: repository.isInitialized() ? graphFingerprint(repository.loadGraph()) : undefined,
  })
  state.activeExecutions.set(callID, execution)

  // Enforce workflow context for SDD graph mutation tools
  if (toolName.startsWith("sdd.")) {
    const scope = workflowScope(projectDir, sessionID)
    const action = args?.action && args?.learn_action
      ? `${args.action}:${args.learn_action}`
      : args?.action
    const access = checkToolAccess(toolName, scope, action)
    if (!access.allowed) {
      addAuditEntry(
        projectDir,
        process.env.USER || "current",
        toolName,
        "graph",
        "denied",
        access.reason || "Workflow not active",
      )
      return access.reason
    }
  }

  // Intercept shell commands that write source files (bypass prevention)
  if (isShellTool(hostToolId)) {
    const command = args?.command || args?.cmd || ""
    if (typeof command === "string" && command.length > 0) {
      // ENFORCEMENT: Block shell writes to .sdd/ directory
      if (command.includes(".sdd/") && (/[>]|writeFile|open\(['"].*['"],\s*['"]w/.test(command))) {
        addAuditEntry(
          projectDir,
          process.env.USER || "current",
          "shell_command",
          ".sdd/",
          "denied",
          "Shell command writes to .sdd/ directory",
        )
        return [
          `[SDD BLOCKED] Shell command detected that writes to .sdd/ directory.`,
          `  Command: ${command.slice(0, 200)}`,
          "",
          "The Knowledge Graph can ONLY be modified through SDD tools.",
          "Direct shell edits to .sdd/ are not allowed.",
        ].join("\n")
      }

      const detectedFiles = detectShellFileWrites(command)
      const looksLikeSourceWrite = /(?:writeFile|writeFileSync|write_text|write_bytes|pathlib|open\s*\([^)]*['"](?:w|a)|(?:^|\s)(?:sed\s+-i|cp|mv|install|touch|dd|truncate|tee)\b|>{1,2})/i.test(command) &&
        /\.(?:ts|tsx|js|jsx|mjs|mts|py|go|rs|java|rb|vue|svelte|c|cpp|h|hpp|cs|swift|kt)\b/i.test(command)
      const unresolvedVariableWrite = /(?:^|\s)(?:cp|mv|install|touch|tee|python[3]?|node|ruby|perl)\b/i.test(command) &&
        /\$[A-Za-z_][A-Za-z0-9_]*/.test(command) &&
        /(?:writeFile|write_text|write_bytes|open\s*\(|>{1,2})/i.test(command)
      if ((looksLikeSourceWrite || unresolvedVariableWrite) && detectedFiles.length === 0) {
        addAuditEntry(projectDir, process.env.USER || "current", "shell_command", "unknown", "denied", "Unable to resolve shell write target safely")
        return "[SDD BLOCKED] Shell write target could not be resolved safely. Use an SDD tool or provide an explicit project-relative source path."
      }
      if (detectedFiles.length > 0) {
        for (const file of detectedFiles) {
          try {
            projectPath(projectDir, file)
          } catch {
            addAuditEntry(projectDir, process.env.USER || "current", "shell_command", file, "denied", "Shell write path escapes project")
            return `[SDD BLOCKED] Shell write path is outside the active project: ${file}`
          }
        }
        const repo = createRepository(projectDir)
        if (!repo.isInitialized()) return

        const graph = repo.loadGraph()

        // Check spec nodes exist
        const specNodeTypes = ["feature", "entity", "requirement", "architecture_component", "module"]
        const hasSpecNodes = graph.nodes.some(n => specNodeTypes.includes(n.type))

        if (!hasSpecNodes && graph.nodes.length > 0) {
          addAuditEntry(
            projectDir,
            process.env.USER || "current",
            "shell_command",
            detectedFiles.join(", "),
            "denied",
            "Shell command writes source files without spec nodes",
          )
          return [
            `[SDD BLOCKED] Shell command detected that writes source files:`,
            `  Files: ${detectedFiles.join(", ")}`,
            "",
            "The Knowledge Graph has no feature, entity, requirement, or component nodes.",
            "You MUST create specification nodes before writing code:",
            "",
            "1. Run sdd.discover to create features and entities",
            "2. Run sdd.update_from_answers to populate the specification",
            "3. THEN retry this write",
            "",
            "Or run sdd.full_cycle for the complete automated cycle.",
          ].join("\n")
        }

        // Check for approved Change node covering these files
        const approvedChanges = getPendingChanges(graph).filter((c) => {
          if (c.status !== "APPROVED") return false
          const affectedFiles = c.metadata.affected_files || []
          return detectedFiles.some((f) =>
            affectedFiles.some((af: string) => f.includes(af) || af.includes(f))
          )
        })

        if (approvedChanges.length === 0) {
          addAuditEntry(
            projectDir,
            process.env.USER || "current",
            "shell_command",
            detectedFiles.join(", "),
            "denied",
            "No approved Change node for shell-written files",
          )
          return [
            `[SDD BLOCKED] Shell command detected that writes source files without SDD approval:`,
            `  Command: ${command.slice(0, 200)}`,
            `  Files: ${detectedFiles.join(", ")}`,
            "",
            "Using shell commands to bypass SDD enforcement is not allowed.",
            "You MUST follow the SDD workflow before writing code:",
            "",
            "1. Run sdd.enforce to classify and create a Change node",
            "2. Run sdd.update_from_answers to update the specification",
            "3. Run sdd.approve_change to approve the Change",
            "4. THEN retry this write",
            "",
            "Or run sdd.full_cycle for the complete automated cycle.",
          ].join("\n")
        }

        // ENFORCEMENT: Require spec update before shell write
        const shellWorkflow = getWorkflowState(workflowScope(projectDir, sessionID))
        if (shellWorkflow.enforced && !shellWorkflow.specUpdated) {
          addAuditEntry(
            projectDir,
            process.env.USER || "current",
            "shell_command",
            detectedFiles.join(", "),
            "denied",
            "SDD spec not updated after enforce",
          )
          return [
            `[SDD BLOCKED] Cannot write code before updating the specification.`,
            `  Files: ${detectedFiles.join(", ")}`,
            `  Change: ${shellWorkflow.changeId}`,
            "",
            "After sdd.enforce, you MUST update the SDD graph BEFORE writing code:",
            "",
            "1. Run sdd.graph_mutation(action=\"add_node\") to create feature/entity/business_rule nodes",
            "2. Run sdd.update_from_answers to populate the specification",
            "3. Run sdd.validate to verify the updated spec",
            "4. THEN retry this write",
            "",
            "The SDD specification is the source of truth. Code must follow the spec, not the other way around.",
          ].join("\n")
        }

        // Approved — create snapshots
        for (const change of approvedChanges) {
          createSnapshot(graph, change.id, projectDir)
        }
        addAuditEntry(
          projectDir,
          process.env.USER || "current",
          "shell_command",
          detectedFiles.join(", "),
          "allowed",
          `Approved changes: ${approvedChanges.map((c) => c.id).join(", ")}`,
        )
        return
      }
    }
  }

  // Intercept file write tools (Write, Edit) to enforce SDD-first
  if (isFileWriteTool(hostToolId)) {
    const filePath = (args?.filePath || args?.path || "") as string

    // ENFORCEMENT: Block direct writes to .sdd/ directory
    // The SDD graph can ONLY be modified through sdd.* tools
    if (filePath.includes(".sdd/")) {
      addAuditEntry(
        projectDir,
        process.env.USER || "current",
        hostToolId,
        filePath,
        "denied",
        "Direct .sdd/ modification blocked",
      )
      return [
        `[SDD BLOCKED] Cannot write directly to .sdd/ directory.`,
        `  File: ${filePath}`,
        "",
        "The Knowledge Graph can ONLY be modified through SDD tools:",
        "- sdd.graph_mutation(action=\"add_node\"|\"update_node\"|\"remove_node\")",
        "- sdd.graph_mutation(action=\"add_relationship\"|\"remove_relationship\")",
        "- sdd.build_graph (initial setup)",
        "",
        "Direct file edits to .sdd/ are not allowed.",
      ].join("\n")
    }

    // Check if this is a source code file
    const isSourceFile = SDD_FILE_PATTERNS.some((p) => p.test(filePath)) &&
      !SDD_EXCLUDED_PATTERNS.some((p) => p.test(filePath))

    if (!isSourceFile) return

    // Check if SDD is initialized
    const repo = createRepository(projectDir)
    if (!repo.isInitialized()) return

    const graph = repo.loadGraph()

    // Check if graph has required spec nodes before allowing code creation
    const specNodeTypes = ["feature", "entity", "requirement", "architecture_component", "module"]
    const hasSpecNodes = graph.nodes.some(n => specNodeTypes.includes(n.type))

    if (!hasSpecNodes && graph.nodes.length > 0) {
      addAuditEntry(
        projectDir,
        process.env.USER || "current",
        "write_file",
        filePath,
        "denied",
        "No spec nodes in graph",
      )
      return [
        `[SDD BLOCKED] Cannot create code without specification.`,
        "",
        "The Knowledge Graph has no feature, entity, requirement, or component nodes.",
        "You MUST create specification nodes before writing code:",
        "",
        "1. Run sdd.discover to create features and entities",
        "2. Run sdd.update_from_answers to populate the specification",
        "3. THEN retry this write",
        "",
        "Or run sdd.full_cycle for the complete automated cycle.",
      ].join("\n")
    }

    // Check permissions before allowing changes
    const userRole = getUserRoleWithAuth(projectDir, process.env.USER || "current")
    const hasPermission = checkPermission(userRole, "create_change", projectDir)

    if (!hasPermission) {
      addAuditEntry(
        projectDir,
        process.env.USER || "current",
        "write_file",
        filePath,
        "denied",
        "Insufficient permissions",
      )
      return [
        `[SDD PERMISSION DENIED] Cannot modify ${filePath}.`,
        "",
        `Your role (${userRole}) does not have permission to create changes.`,
        "Contact an admin to grant you the 'create_change' permission.",
      ].join("\n")
    }

    // Find an approved Change node that covers this file
    const approvedChanges = getPendingChanges(graph).filter((c) => {
      if (c.status !== "APPROVED") return false
      const files = c.metadata.affected_files || []
      return files.some((f: string) => filePath.includes(f) || f.includes(filePath))
    })

    if (approvedChanges.length > 0) {
      // ENFORCEMENT: Require spec update before code write
      const workflow = getWorkflowState(workflowScope(projectDir, sessionID))
      if (workflow.enforced && !workflow.specUpdated) {
        addAuditEntry(
          projectDir,
          process.env.USER || "current",
          "write_file",
          filePath,
          "denied",
          "SDD spec not updated after enforce",
        )
        return [
          `[SDD BLOCKED] Cannot write code before updating the specification.`,
          `  File: ${filePath}`,
          `  Change: ${workflow.changeId}`,
          "",
          "After sdd.enforce, you MUST update the SDD graph BEFORE writing code:",
          "",
          "1. Run sdd.graph_mutation(action=\"add_node\") to create feature/entity/business_rule nodes",
          "2. Run sdd.update_from_answers to populate the specification",
          "3. Run sdd.validate to verify the updated spec",
          "4. THEN retry this write",
          "",
          "The SDD specification is the source of truth. Code must follow the spec, not the other way around.",
        ].join("\n")
      }

      // Create snapshot before approving change
      for (const change of approvedChanges) {
        createSnapshot(graph, change.id, projectDir)
      }
      addAuditEntry(
        projectDir,
        process.env.USER || "current",
        "write_file",
        filePath,
        "allowed",
        `Approved changes: ${approvedChanges.map((c) => c.id).join(", ")}`,
      )
      return
    }

    // File not covered by any approved Change → BLOCK the write
    addAuditEntry(
      projectDir,
      process.env.USER || "current",
      "write_file",
      filePath,
      "denied",
      "No approved Change node",
    )
    return [
      `[SDD BLOCKED] Cannot modify ${filePath}.`,
      "",
      "This file is not covered by an approved SDD Change node.",
      "You MUST follow the SDD workflow before writing code:",
      "",
      "1. Run sdd.enforce to classify and create a Change node",
      "2. Run sdd.update_from_answers to update the specification",
      "3. Run sdd.approve_change to approve the Change",
      "4. THEN retry this write",
      "",
      "Or run sdd.full_cycle for the complete automated cycle.",
    ].join("\n")
  }

  return
}

/**
 * Close the execution record opened by `enforceToolExecution`, write telemetry
 * and refresh the spec/graph bookkeeping after a tool ran.
 */
export function observeToolExecution(
  projectDir: string,
  sessionID: string | undefined,
  callID: string,
  hostToolId: string,
  outputText: string,
  state: SddRuntimeState,
  safeToolNames: boolean,
): void {
  const toolName = toCanonicalToolName(hostToolId, ALL_TOOL_NAMES, safeToolNames)
  const execution = state.activeExecutions.get(callID) || findLatestExecutionByCall(projectDir, callID)
  if (execution) {
    const repository = createRepository(projectDir)
    const status = outputText.includes("BLOCKED") || outputText.startsWith("Error:") ? "blocked" : "completed"
    finishExecution(execution, status, {
      output: outputText,
      graphFingerprintAfter: repository.isInitialized() ? graphFingerprint(repository.loadGraph()) : undefined,
    })
    recordTelemetry(projectDir, {
      name: "tool_execution",
      duration_ms: Date.now() - Date.parse(execution.startedAt),
      run_id: execution.runId,
      step_id: execution.stepId,
      session_id: execution.sessionId,
      call_id: execution.callId,
      metadata: { tool: execution.toolName, status },
    })
    state.activeExecutions.delete(callID)
  }
  if (!toolName.startsWith("sdd.")) return

  // Invalidate state snapshot cache after mutations
  if (SNAPSHOT_INVALIDATING_TOOLS.includes(toolName)) {
    invalidateSnapshotCache()
    state.systemInjected = false
  }

  // Mark spec as updated when spec-mutating tools are called
  if (SPEC_MUTATION_TOOLS.has(toolName)) {
    markSpecUpdated(workflowScope(projectDir, sessionID))
  }
}

/**
 * Build the SDD system prompt sections for one model request.
 *
 * `safeToolNames` projects every `sdd.x` reference to the wire name the host
 * actually exposes (`sdd_x`), so the model never calls a name that is not
 * registered. V2 always projects because its core normalizes namespaces to `_`.
 */
export async function buildSystemPromptSections(
  projectDir: string,
  sessionID: string | undefined,
  safeToolNames: boolean,
  state: SddRuntimeState,
): Promise<string[]> {
  // Track the session driving the current turn so the dashboard can wake the
  // agent for task integration (see src/server/dashboard-context.ts).
  setDashboardSessionID(sessionID, projectDir)

  if (state.systemInjected) {
    try {
      const currentRepo = createRepository(projectDir)
      if (currentRepo.isInitialized()) {
        const currentSource = sourceFingerprint(projectDir).signature
        if (graphFingerprint(currentRepo.loadGraph()) === state.injectedGraphFingerprint && currentSource === state.injectedSourceSignature) return []
      }
      state.systemInjected = false
    } catch {
      return []
    }
  }
  if (!isSddEnabled(projectDir)) return []

  const sections: string[] = []

  // Migrations are explicit operations. The prompt may report pending
  // work, but session initialization must not write to the project.
  if (hasPendingMigrations(projectDir)) {
    sections.push("## 🔄 opencode-telos Migrations\nPending migrations exist. Run `sdd.run_migrations` explicitly to apply them.")
  }

  const repo = createRepository(projectDir)

  // The central policy and the tool catalog MUST reach the model even
  // without a graph: the graph is created BY those tools (sdd.initialize /
  // sdd.build_graph). Gating the announcement behind isInitialized() hid
  // os entry points do agente — ciclo fechado.
  sections.push(rewriteToolNames(SDD_CORE_SYSTEM_PROMPT, ALL_TOOL_NAMES, safeToolNames))
  try {
    sections.push(rewriteToolNames(getToolsForSession(projectDir).formattedMessage, ALL_TOOL_NAMES, safeToolNames))
  } catch (error) { sddDebug("hooks", "Failed to build tool registry message") }

  if (repo.isInitialized()) {
    // Restore persistent cache from disk (cross-session)
    try {
      const cacheMgr = getCacheManager(projectDir)
      cacheMgr.restoreFromPersistentCache()
    } catch (error) { sddDebug("hooks", "Failed to restore persistent cache") }

    // Tool Registry: injeta o estado atual do grafo
    try {
      const { getGraphSnapshot, formatGraphState } = await import("./router/graph-state-snapshot.js")
      const snapshot = getGraphSnapshot(projectDir)
      sections.push(formatGraphState(snapshot))
    } catch (error) { sddDebug("hooks", "Failed to inject graph state snapshot") }
    try {
      const graph = repo.loadGraph()

      // Inject context pack for focused node info
      sections.push(buildSddContextPack(graph))
      state.injectedGraphFingerprint = graphFingerprint(graph)
      state.injectedSourceSignature = sourceFingerprint(projectDir).signature

      // Validation is cheap enough to expose blocking state. Drift, full
      // health, promises, coverage and handoff are available on demand;
      // running all of them at session start is expensive on large repos.
      const validation = validateGraph(graph, undefined, projectDir)
      if (!validation.valid || validation.warnings.length > 0) {
        const valLines = ["## SDD Validation"]
        valLines.push(`**Valid:** ${validation.valid ? "✅" : "❌"}`)
        if (validation.errors.length > 0) valLines.push(`**Errors:** ${validation.errors.length}`)
        if (validation.warnings.length > 0) valLines.push(`**Warnings:** ${validation.warnings.length}`)
        sections.push(valLines.join("\n"))
      }

      // Inject pending changes summary
      const pending = getPendingChanges(graph)
      if (pending.length > 0) {
        sections.push(`## Pending Changes: ${pending.length} change(s) awaiting action`)
      }

      // Surface manual tasks created from the dashboard Kanban so the agent
      // integrates them into the spec.
      const pendingTasks = getPendingIntegrationTasks(graph)
      if (pendingTasks.length > 0) {
        sections.push([
          `## SDD Task Board: ${pendingTasks.length} task(s) pending AI integration`,
          'Run `sdd.integrate_tasks` (action="list") to get the integration plan, link each task',
          "(implements / tested_by / depends_on) and finish with action=\"mark_integrated\".",
          "An integrated task opens its SDD Change automatically — that Change is what authorizes the code.",
        ].join("\n"))
      }

      // Integrated tasks whose Change is still a draft: no Write/Edit is
      // allowed until the Change is approved (that is the write gate).
      const awaitingApproval = getTasksAwaitingChangeApproval(graph)
      if (awaitingApproval.length > 0) {
        sections.push([
          `## SDD Task Board: ${awaitingApproval.length} task(s) with a Change awaiting approval`,
          ...awaitingApproval
            .slice(0, 5)
            .map(({ task, change }) => `- ${task.id}: ${task.name} → ${change.id} (${change.metadata.approval_level})`),
          'Approve it with `sdd.integrate_tasks` (action="approve_change", task_id="...") and then implement the matching code.',
        ].join("\n"))
      }
    } catch {
      // Handoff is optional, don't fail if it can't be generated
    }
    // Persist cache to disk for cross-session reuse
    try {
      const cacheMgr = getCacheManager(projectDir)
      cacheMgr.persistToDisk()
    } catch (error) { sddDebug("hooks", "Failed to persist cache to disk") }
    state.systemInjected = true
  }

  return sections
}

/**
 * Append the SDD enforcement warning to a host tool description.
 *
 * Returns the new description, or `undefined` when the tool is not one Telos
 * annotates. In V2 this reaches host built-ins through `editor.update(id, ...)`;
 * when the host does not expose the built-in, the caller falls back to the
 * system prompt, which already states the same policy.
 */
export function annotateToolDefinition(toolId: string, description: string | undefined): string | undefined {
  if (toolId === "sdd" || toolId === "sdd-panel") {
    return [
      "SDD command hub. Available: `sdd on`, `sdd off`, `sdd status`, `sdd renew`, `sdd viz`, `sdd cache_reset`, `sdd panel`.",
      "Toggle/status/renew/viz/cache_reset are deterministic and do not require the LLM.",
    ].join("\n")
  }

  if (normalizeToolId(toolId) === "runterminalcommand") {
    const warning = [
      "",
      "",
      "[SDD ENFORCEMENT] This tool is monitored. Any command that writes",
      "source code files (.ts, .tsx, .js, .jsx, .py, .go, .rs, etc.)",
      "WILL BE BLOCKED unless an approved SDD Change node covers those files.",
      "",
      "Use sdd.enforce BEFORE modifying code. Shell commands cannot",
      "bypass SDD-first workflow.",
    ].join("\n")
    return (description || "") + warning
  }

  return undefined
}

/** Wire names of every Telos tool, for permission matching. */
const SDD_WIRE_TOOL_NAMES = new Set(ALL_TOOL_NAMES.map((name) => toWireToolName(name, true)))

/**
 * Auto-allow Telos' own tools so a permission prompt never interrupts the SDD
 * workflow. Mirrors the V1 `permission.ask` hook for the V2 evaluate hook.
 *
 * Matching is exact against the registered wire names (or the `sdd` namespace
 * prefix) rather than a substring test, so a permission for an unrelated tool
 * that merely contains "sdd" is never silently allowed.
 */
export function shouldAutoAllowPermission(
  action: string,
  resources: readonly string[],
  safeToolNames: boolean,
): boolean {
  const candidates = [action, ...resources]
  return candidates.some((value) => {
    if (typeof value !== "string" || value === "") return false
    const canonical = restoreToolNames(value, ALL_TOOL_NAMES, safeToolNames)
    if (ALL_TOOL_NAMES.includes(canonical)) return true
    if (SDD_WIRE_TOOL_NAMES.has(value)) return true
    return /(^|[^A-Za-z0-9])sdd[._]/.test(value)
  })
}

/**
 * Release process-wide resources owned by the plugin (V1 `dispose` hook, V2
 * cleanup function).
 */
export function releaseRuntimeResources(projectDir: string): void {
  try {
    const cacheMgr = getCacheManager(projectDir)
    cacheMgr.persistToDisk()
    cacheMgr.releaseWriteLock()
  } catch (error) { sddDebug("hooks", "Failed to release cache lock on session end") }
}

/**
 * Replace an already-stored `/sdd ...` user message with its deterministic
 * result.
 *
 * V1 runs this in `experimental.chat.messages.transform`; V2 runs it against
 * `event.messages` in the session `context` hook. Either way the model only ever
 * sees the outcome of a command, never the raw command, so it cannot re-execute
 * or "investigate" it.
 */
export function rewriteSddCommandMessages(
  projectDir: string,
  messages: Array<{
    role?: string
    id?: string
    parts?: Array<{ type: string; text?: string }>
    content?: Array<{ type: string; text?: string }>
  }>,
): number {
  let rewritten = 0
  for (const entry of messages) {
    if (entry.role !== "user") continue
    // V1 addresses message content as `parts`; V2 as `content`.
    const parts = Array.isArray(entry.parts) ? entry.parts : entry.content
    if (!Array.isArray(parts)) continue
    const text = parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n")
    if (!text.trim()) continue

    const raw = extractSddCommandText(text)
    if (!raw) continue

    const firstText = parts.find((p) => p.type === "text")
    if (firstText) {
      firstText.text = renderSddCommandMessage(projectDir, raw, entry.id, "chat.messages.transform")
      rewritten++
    }
  }
  return rewritten
}
