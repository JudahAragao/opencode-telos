/**
 * Workflow Tools — Tool definitions para workflow chains.
 *
 * Cada tool chain é uma tool SDD que o LLM pode chamar diretamente.
 * Internamente, executa a chain de steps usando o executor.
 *
 * Consumido por: createSddTools() em tools.ts
 * Dependências: chains.ts, executor.ts
 */

import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { ALL_CHAINS, type WorkflowChain } from "./chains.js"
import { executeChain, formatChainResult, type ToolExecutor, type WorkflowExecutorHooks } from "./executor.js"
import { DEFAULT_EXECUTOR_CONFIG } from "./types.js"
import { createRepository } from "../../sdd/persistence/repository.js"
import { createSnapshot, executeRollback } from "../../sdd/rollback/manager.js"
import { getWorkflowState, workflowScope } from "../../sdd/enforcement/workflow-tracker.js"

/**
 * Cria uma tool definition para uma workflow chain.
 */
function createChainTool(chain: WorkflowChain): ToolDefinition {
  // Build args schema from chain params
  const argsSchema: Record<string, any> = {}
  for (const param of chain.params) {
    if (param.type === "string") {
      argsSchema[param.name] = tool.schema.string().describe(param.description)
    } else if (param.type === "number") {
      argsSchema[param.name] = tool.schema.number().describe(param.description)
    } else if (param.type === "boolean") {
      argsSchema[param.name] = tool.schema.boolean().describe(param.description)
    }
  }

  return tool({
    description: chain.description,
    args: argsSchema,
    async execute(args, ctx) {
      // Construir params iniciais
      const params: Record<string, unknown> = {}
      for (const param of chain.params) {
        if (args[param.name] !== undefined) {
          params[param.name] = args[param.name]
        }
      }

      // Tool executor: chama as tools SDD diretamente
      const executeTool: ToolExecutor = async (toolName, toolArgs) => {
        // Import dinâmico para evitar circular dependencies
        const { createSddTools } = await import("../tools.js")
        const tools = createSddTools()
        const sddTool = tools[toolName]

        if (!sddTool) {
          return `Error: Tool ${toolName} not found`
        }

        const result = await sddTool.execute(toolArgs as any, ctx)
        // ToolResult pode ser string ou objeto com output
        if (typeof result === "string") return result
        if (result && typeof result === "object" && "output" in result) return result.output
        return JSON.stringify(result)
      }

      const executorHooks: WorkflowExecutorHooks = {
        beforeStep: (_stepIndex) => {
          const workflow = getWorkflowState(workflowScope(ctx.directory, ctx.sessionID))
          if (!workflow.changeId) return null
          const repo = createRepository(ctx.directory)
          if (!repo.isInitialized()) return null
          const snapshot = createSnapshot(repo.loadGraph(), workflow.changeId, ctx.directory)
          return { changeId: workflow.changeId, snapshotId: snapshot.id }
        },
        rollback: (snapshots) => {
          const last = [...snapshots].reverse().find((item): item is { changeId: string } =>
            Boolean(item && typeof item === "object" && "changeId" in item && typeof item.changeId === "string"),
          )
          if (!last) return
          const repo = createRepository(ctx.directory)
          if (!repo.isInitialized()) return
          const graph = repo.loadGraph()
          executeRollback(graph, last.changeId, ctx.directory)
          repo.saveGraph(graph)
        },
      }

      // Executar chain
      const result = await executeChain(chain, params, executeTool, DEFAULT_EXECUTOR_CONFIG, executorHooks)
      return formatChainResult(result)
    },
  })
}

/**
 * Cria todas as tools de workflow chains.
 * Retorna um Record compatível com createSddTools().
 */
export function createWorkflowTools(): Record<string, ToolDefinition> {
  const tools: Record<string, ToolDefinition> = {}

  for (const chain of ALL_CHAINS) {
    tools[chain.name] = createChainTool(chain)
  }

  return tools
}

/**
 * Lista todas as workflow tools disponíveis.
 */
export function listWorkflowTools(): Array<{ name: string; description: string; params: string[] }> {
  return ALL_CHAINS.map(chain => ({
    name: chain.name,
    description: chain.description,
    params: chain.params.map(p => `${p.name}: ${p.type}${p.required ? " (required)" : ""}`),
  }))
}
