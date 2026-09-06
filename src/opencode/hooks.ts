import type { Hooks } from "@opencode-ai/plugin"
import { createRepository } from "../sdd/persistence/repository.js"
import { SDD_CORE_SYSTEM_PROMPT, buildSddContextPack } from "./system-prompt.js"
import { detectDrift } from "../sdd/drift/detector.js"
import { validateGraph } from "../sdd/validation/validator.js"
import { getPendingChanges } from "../sdd/changes/manager.js"
import { isSddEnabled, setToggleState, getToggleState } from "../sdd/toggle/state.js"
import { generateHandoff, formatHandoffPack, computeGraphHealth } from "../sdd/session/handoff.js"
import { checkPermission, getUserRoleWithAuth, addAuditEntry } from "../sdd/permissions/access.js"
import { createSnapshot } from "../sdd/rollback/manager.js"
import { extractPromises } from "../sdd/promises/tracker.js"
import { calculateCoverage } from "../sdd/coverage/tracker.js"
import { getCacheManager } from "../sdd/cache/manager.js"
import { checkToolAccess, resetWorkflowState, getWorkflowState, markSpecUpdated } from "../sdd/enforcement/workflow-tracker.js"
import { formatNudgeInput } from "./router/semantic-nudge.js"
import { getToolsForSession } from "./router/tool-registry.js"
import { invalidateSnapshotCache } from "./router/graph-state-snapshot.js"
import { runMigrations, hasPendingMigrations } from "../sdd/migrations/index.js"

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
 * Used to enforce SDD-first even when agents try to bypass via run_terminal_command.
 */
const SRC_EXT = /\.(?:ts|tsx|js|jsx|mjs|mts|py|go|rs|java|rb|vue|svelte|c|cpp|h|hpp|cs|swift|kt)$/
const SRC_FILE = /([^\s>"]+\.(?:ts|tsx|js|jsx|mjs|mts|py|go|rs|java|rb|vue|svelte|c|cpp|h|hpp|cs|swift|kt))/

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
        for (const p of paths) {           if (p && SRC_EXT.test(p) &&
              !SDD_EXCLUDED_PATTERNS.some((ep) => ep.test(p))) {
            files.push(p)
          }
        }
      }
    } else {
      const match = command.match(pattern)
      if (match) {
        const paths = extractor(match)
        for (const p of paths) {
          if (p && SRC_EXT.test(p) &&
              !SDD_EXCLUDED_PATTERNS.some((ep) => ep.test(p))) {
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
      if (p && SRC_EXT.test(p) &&
          !SDD_EXCLUDED_PATTERNS.some((ep) => ep.test(p))) {
        if (!files.includes(p)) files.push(p)
      }
    }

    const writePattern = /writeFile(?:Sync)?\s*\(\s*['"]([^'"]+)['"]/g
    while ((match = writePattern.exec(command)) !== null) {
      const p = match[1]
      if (p && SRC_EXT.test(p) &&
          !SDD_EXCLUDED_PATTERNS.some((ep) => ep.test(p))) {
        if (!files.includes(p)) files.push(p)
      }
    }
  }

  return [...new Set(files)]
}

export function createSddHooks(): Hooks {
  let systemInjected = false

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      if (systemInjected) return
      if (!isSddEnabled(process.cwd())) return

      // Run pending migrations on first load
      if (hasPendingMigrations(process.cwd())) {
        try {
          const migrationResults = runMigrations(process.cwd())
          const successful = migrationResults.filter(r => r.success)
          if (successful.length > 0) {
            output.system.push(`## 🔄 opencode-telos Migrations: ${successful.length} fix(es) applied`)  
          }
        } catch (err) {
          // Don't block system init on migration errors
          console.error("[opencode-telos] Migration error:", err)
        }
      }

      const repo = createRepository(process.cwd())
      if (repo.isInitialized()) {
        // Restore persistent cache from disk (cross-session)
        const cacheMgr = getCacheManager(process.cwd())
        cacheMgr.restoreFromPersistentCache()

        output.system.push(SDD_CORE_SYSTEM_PROMPT)

        // Tool Registry: injeta tools relevantes para o estado atual do grafo
        try {
          const { getGraphSnapshot } = await import("./router/graph-state-snapshot.js")
          const snapshot = getGraphSnapshot(process.cwd())
          const { formatGraphState } = await import("./router/graph-state-snapshot.js")
          output.system.push(formatGraphState(snapshot))
        } catch {}
        try {
          const graph = repo.loadGraph()

          // Inject context pack for focused node info
          const contextPack = buildSddContextPack(graph)
          output.system.push(contextPack)

          // Validation is cheap enough to expose blocking state. Drift, full
          // health, promises, coverage and handoff are available on demand;
          // running all of them at session start is expensive on large repos.
          const validation = validateGraph(graph)
          if (!validation.valid || validation.warnings.length > 0) {
            const valLines = ["## SDD Validation"]
            valLines.push(`**Valid:** ${validation.valid ? "✅" : "❌"}`)
            if (validation.errors.length > 0) valLines.push(`**Errors:** ${validation.errors.length}`)
            if (validation.warnings.length > 0) valLines.push(`**Warnings:** ${validation.warnings.length}`)
            output.system.push(valLines.join("\n"))
          }

          // Inject pending changes summary
          const pending = getPendingChanges(graph)
          if (pending.length > 0) {
            output.system.push(`## Pending Changes: ${pending.length} change(s) awaiting action`)
          }

          // G: Save graph snapshot to disk for fast cross-session restore
          try {
            const cacheMgrForSnapshot = getCacheManager(process.cwd())
            cacheMgrForSnapshot.saveGraphSnapshot(graph)
          } catch {}
        } catch {
          // Handoff is optional, don't fail if it can't be generated
        }
        // Persist cache to disk for cross-session reuse
        try {
          const cacheMgr = getCacheManager(process.cwd())
          cacheMgr.persistToDisk()
        } catch {}
        systemInjected = true
      }
    },

    "chat.message": async (_input, output) => {
      if (!output.parts) return

      for (const part of output.parts) {
        if (part.type !== "text") continue

        const text = part.text.trim()

        // Detect /sdd commands
        if (text === "/sdd on") {
          const state = setToggleState(process.cwd(), true)
          systemInjected = false
          part.text = `✅ SDD enforcement **enabled** at ${state.changed_at}.\n\nSpec-Driven Development is now active. All code changes will go through the SDD workflow.`
          return
        }

        if (text === "/sdd off") {
          const state = setToggleState(process.cwd(), false)
          systemInjected = false
          resetWorkflowState()
          part.text = `⏸️ SDD enforcement **disabled** at ${state.changed_at}.\n\nYou can now make code changes freely without SDD workflow. Use \`/sdd on\` to re-enable.`
          return
        }

        if (text === "/sdd status") {
          const state = getToggleState(process.cwd())
          const status = state.enabled ? "🟢 ON" : "🔴 OFF"
          part.text = `SDD Status: ${status}\nLast changed: ${state.changed_at}\n\nCommands: \`/sdd on\`, \`/sdd off\`, \`/sdd status\`, \`/sdd cache reset\``
          return
        }

        // H: /sdd cache reset — full cache reset without killing the process
        if (text === "/sdd cache reset") {
          const cacheMgr = getCacheManager(process.cwd())
          const result = cacheMgr.fullReset()
          const lines = ["## 🧹 Cache Reset Complete"]
          lines.push(`- Memory cache: ${result.cleared.memory ? "✅ cleared" : "⏭️ skipped"}`)
          lines.push(`- Persistent cache: ${result.cleared.disk ? "✅ cleared" : "⏭️ no file"}`)
          lines.push(`- Graph snapshot: ${result.cleared.snapshot ? "✅ cleared" : "⏭️ no snapshot"}`)
          lines.push(`- Lock file: ${result.cleared.lock ? "✅ released" : "⏭️ no lock"}`)
          lines.push(`\nInvalidation version: ${cacheMgr.getInvalidationVersion()}`)
          lines.push("\nThe next tool call will recompute fresh results.")
          part.text = lines.join("\n")
          return
        }

        // Semantic nudge — replaces regex-based pattern detection
        if (isSddEnabled(process.cwd())) {
          const nudge = formatNudgeInput(text)
          if (nudge) {
            part.text += `\n\n${nudge}`
          }
        }
      }
    },

    "tool.execute.before": async (input, output) => {
      // Skip enforcement if SDD is disabled
      if (!isSddEnabled(process.cwd())) return

      // Enforce workflow context for SDD graph mutation tools
      if (input.tool.startsWith("sdd.")) {
        const access = checkToolAccess(input.tool)
        if (!access.allowed) {
          addAuditEntry(
            process.cwd(),
            process.env.USER || "current",
            input.tool,
            "graph",
            "denied",
            access.reason || "Workflow not active",
          )
          throw new Error(access.reason)
        }
      }

      // Intercept shell commands that write source files (bypass prevention)
      if (input.tool === "run_terminal_command") {
        const command = output.args?.command || output.args?.cmd || ""
        if (typeof command === "string" && command.length > 0) {
          // ENFORCEMENT: Block shell writes to .sdd/ directory
          if (command.includes(".sdd/") && (/[>]|writeFile|open\(['"].*['"],\s*['"]w/.test(command))) {
            addAuditEntry(
              process.cwd(),
              process.env.USER || "current",
              "shell_command",
              ".sdd/",
              "denied",
              "Shell command writes to .sdd/ directory",
            )
            throw new Error(
              [
                `[SDD BLOCKED] Shell command detected that writes to .sdd/ directory.`,
                `  Command: ${command.slice(0, 200)}`,
                "",
                "The Knowledge Graph can ONLY be modified through SDD tools.",
                "Direct shell edits to .sdd/ are not allowed.",
              ].join("\n"),
            )
          }

          const detectedFiles = detectShellFileWrites(command)
          if (detectedFiles.length > 0) {
            const repo = createRepository(process.cwd())
            if (!repo.isInitialized()) return

            const graph = repo.loadGraph()

            // Check spec nodes exist
            const specNodeTypes = ["feature", "entity", "requirement", "architecture_component", "module"]
            const hasSpecNodes = graph.nodes.some(n => specNodeTypes.includes(n.type))

            if (!hasSpecNodes && graph.nodes.length > 0) {
              addAuditEntry(
                process.cwd(),
                process.env.USER || "current",
                "shell_command",
                detectedFiles.join(", "),
                "denied",
                "Shell command writes source files without spec nodes",
              )
              throw new Error(
                [
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
                ].join("\n"),
              )
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
                process.cwd(),
                process.env.USER || "current",
                "shell_command",
                detectedFiles.join(", "),
                "denied",
                "No approved Change node for shell-written files",
              )
              throw new Error(
                [
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
                ].join("\n"),
              )
            }

            // ENFORCEMENT: Require spec update before shell write
            const shellWorkflow = getWorkflowState()
            if (shellWorkflow.enforced && !shellWorkflow.specUpdated) {
              addAuditEntry(
                process.cwd(),
                process.env.USER || "current",
                "shell_command",
                detectedFiles.join(", "),
                "denied",
                "SDD spec not updated after enforce",
              )
              throw new Error(
                [
                  `[SDD BLOCKED] Cannot write code before updating the specification.`,
                  `  Files: ${detectedFiles.join(", ")}`,
                  `  Change: ${shellWorkflow.changeId}`,
                  "",
                  "After sdd.enforce, you MUST update the SDD graph BEFORE writing code:",
                  "",
                  "1. Run sdd.add_node to create feature/entity/business_rule nodes",
                  "2. Run sdd.update_from_answers to populate the specification",
                  "3. Run sdd.validate to verify the updated spec",
                  "4. THEN retry this write",
                  "",
                  "The SDD specification is the source of truth. Code must follow the spec, not the other way around.",
                ].join("\n"),
              )
            }

            // Approved — create snapshots
            for (const change of approvedChanges) {
              createSnapshot(graph, change.id, process.cwd())
            }
            addAuditEntry(
              process.cwd(),
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
      if (input.tool === "Write" || input.tool === "Edit") {
        const filePath = output.args?.filePath || output.args?.path || ""

        // ENFORCEMENT: Block direct writes to .sdd/ directory
        // The SDD graph can ONLY be modified through sdd.* tools
        if (filePath.includes(".sdd/")) {
          addAuditEntry(
            process.cwd(),
            process.env.USER || "current",
            input.tool,
            filePath,
            "denied",
            "Direct .sdd/ modification blocked",
          )
          throw new Error(
            [
              `[SDD BLOCKED] Cannot write directly to .sdd/ directory.`,
              `  File: ${filePath}`,
              "",
              "The Knowledge Graph can ONLY be modified through SDD tools:",
              "- sdd.add_node / sdd.update_node / sdd.remove_node",
              "- sdd.add_relationship / sdd.remove_relationship",
              "- sdd.build_graph (initial setup)",
              "",
              "Direct file edits to .sdd/ are not allowed.",
            ].join("\n"),
          )
        }

        // Check if this is a source code file
        const isSourceFile = SDD_FILE_PATTERNS.some((p) => p.test(filePath)) &&
          !SDD_EXCLUDED_PATTERNS.some((p) => p.test(filePath))

        if (!isSourceFile) return

        // Check if SDD is initialized
        const repo = createRepository(process.cwd())
        if (!repo.isInitialized()) return

        const graph = repo.loadGraph()

        // Check if graph has required spec nodes before allowing code creation
        const specNodeTypes = ["feature", "entity", "requirement", "architecture_component", "module"]
        const hasSpecNodes = graph.nodes.some(n => specNodeTypes.includes(n.type))
        
        if (!hasSpecNodes && graph.nodes.length > 0) {
          addAuditEntry(
            process.cwd(),
            process.env.USER || "current",
            "write_file",
            filePath,
            "denied",
            "No spec nodes in graph",
          )
          throw new Error(
            [
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
            ].join("\n"),
          )
        }

        // Check permissions before allowing changes
        const userRole = getUserRoleWithAuth(process.cwd(), process.env.USER || "current")
        const hasPermission = checkPermission(userRole, "create_change", process.cwd())

        if (!hasPermission) {
          addAuditEntry(
            process.cwd(),
            process.env.USER || "current",
            "write_file",
            filePath,
            "denied",
            "Insufficient permissions",
          )
          throw new Error(
            [
              `[SDD PERMISSION DENIED] Cannot modify ${filePath}.`,
              "",
              `Your role (${userRole}) does not have permission to create changes.`,
              "Contact an admin to grant you the 'create_change' permission.",
            ].join("\n"),
          )
        }

        // Find an approved Change node that covers this file
        const approvedChanges = getPendingChanges(graph).filter((c) => {
          if (c.status !== "APPROVED") return false
          const files = c.metadata.affected_files || []
          return files.some((f: string) => filePath.includes(f) || f.includes(filePath))
        })

        if (approvedChanges.length > 0) {
          // ENFORCEMENT: Require spec update before code write
          const workflow = getWorkflowState()
          if (workflow.enforced && !workflow.specUpdated) {
            addAuditEntry(
              process.cwd(),
              process.env.USER || "current",
              "write_file",
              filePath,
              "denied",
              "SDD spec not updated after enforce",
            )
            throw new Error(
              [
                `[SDD BLOCKED] Cannot write code before updating the specification.`,
                `  File: ${filePath}`,
                `  Change: ${workflow.changeId}`,
                "",
                "After sdd.enforce, you MUST update the SDD graph BEFORE writing code:",
                "",
                "1. Run sdd.add_node to create feature/entity/business_rule nodes",
                "2. Run sdd.update_from_answers to populate the specification",
                "3. Run sdd.validate to verify the updated spec",
                "4. THEN retry this write",
                "",
                "The SDD specification is the source of truth. Code must follow the spec, not the other way around.",
              ].join("\n"),
            )
          }

          // Create snapshot before approving change
          for (const change of approvedChanges) {
            createSnapshot(graph, change.id, process.cwd())
          }
          addAuditEntry(
            process.cwd(),
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
          process.cwd(),
          process.env.USER || "current",
          "write_file",
          filePath,
          "denied",
          "No approved Change node",
        )
        throw new Error(
          [
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
          ].join("\n"),
        )
      }
    },

    "tool.execute.after": async (input, output) => {
      if (!input.tool.startsWith("sdd.")) return

      const timestamp = new Date().toISOString()
      if (output.metadata) {
        output.metadata.sdd_tool = true
        output.metadata.sdd_timestamp = timestamp
      }

      // Invalidate state snapshot cache after mutations
      const mutationTools = [
        "sdd.add_node", "sdd.update_node", "sdd.remove_node",
        "sdd.add_relationship", "sdd.remove_relationship",
        "sdd.build_graph", "sdd.update_from_answers",
        "sdd.enforce", "sdd.approve_change", "sdd.complete_change",
        "sdd.generate_code",
        // Composite tools
        "sdd.graph_mutation", "sdd.graph_admin",
        "sdd.workflow_new_feature", "sdd.workflow_bug_fix",
        "sdd.workflow_hotfix", "sdd.workflow_refactor",
        "sdd.workflow_full_cycle",
      ]
      if (mutationTools.includes(input.tool)) {
        invalidateSnapshotCache()
      }

      // Mark spec as updated when spec-mutating tools are called
      const specMutationTools = new Set([
        "sdd.add_node", "sdd.update_node", "sdd.remove_node",
        "sdd.add_relationship", "sdd.remove_relationship",
        "sdd.update_from_answers",
        "sdd.build_graph",
        "sdd.generate_code",
        // Composite tools that update spec
        "sdd.graph_mutation", "sdd.graph_admin",
        "sdd.workflow_new_feature", "sdd.workflow_bug_fix",
        "sdd.workflow_hotfix", "sdd.workflow_refactor",
        "sdd.workflow_full_cycle",
      ])
      if (specMutationTools.has(input.tool)) {
        markSpecUpdated()
      }
    },

    "tool.definition": async (input, output) => {
      if (!isSddEnabled(process.cwd())) return

      // Inject SDD enforcement warning into run_terminal_command description
      if (input.toolID === "run_terminal_command") {
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
        output.description = (output.description || "") + warning
      }
    },

    "permission.ask": async (input, output) => {
      const pattern = input.pattern
      if (typeof pattern === "string" && pattern.includes("sdd.")) {
        output.status = "allow"
      } else if (Array.isArray(pattern) && pattern.some((p: string) => p.includes("sdd."))) {
        output.status = "allow"
      }
    },

    dispose: async () => {
      // E: Persist cache and release resources on session end
      try {
        const cacheMgr = getCacheManager(process.cwd())
        cacheMgr.persistToDisk()
        cacheMgr.releaseWriteLock()
      } catch {}
    },
  }
}
