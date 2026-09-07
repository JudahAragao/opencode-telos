import { describe, expect, test } from "bun:test"
import { ALL_CHAINS, type WorkflowChain } from "../src/opencode/workflows/chains.js"
import { executeChain, formatChainResult, type ToolExecutor } from "../src/opencode/workflows/executor.js"
import { DEFAULT_EXECUTOR_CONFIG } from "../src/opencode/workflows/types.js"

function makeMockExecutor(results: Record<string, string> = {}): ToolExecutor {
  return async (toolName: string, _args: Record<string, unknown>): Promise<string> => {
    return results[toolName] || `${toolName} executed`
  }
}

describe("Workflow Chains", () => {
  test("ALL_CHAINS contains expected chains", () => {
    const names = ALL_CHAINS.map((c) => c.name)
    expect(names).toContain("sdd.workflow_new_feature")
    expect(names).toContain("sdd.workflow_bug_fix")
    expect(names).toContain("sdd.workflow_refactor")
    expect(names).toContain("sdd.workflow_hotfix")
    expect(names).toContain("sdd.workflow_full_cycle")
  })

  test("workflow_new_feature has enforce, approve, generate, verify, complete steps", () => {
    const chain = ALL_CHAINS.find((c) => c.name === "sdd.workflow_new_feature")!
    const toolNames = chain.steps.map((s) => s.tool)
    expect(toolNames).toContain("sdd.enforce")
    expect(toolNames).toContain("sdd.approve_change")
    expect(toolNames).toContain("sdd.generate_code")
    expect(toolNames).toContain("sdd.verify_implementation")
    expect(toolNames).toContain("sdd.complete_change")
  })

  test("workflow_bug_fix has enforce, validate, approve, generate, verify, complete", () => {
    const chain = ALL_CHAINS.find((c) => c.name === "sdd.workflow_bug_fix")!
    const toolNames = chain.steps.map((s) => s.tool)
    expect(toolNames).toContain("sdd.enforce")
    expect(toolNames).toContain("sdd.approve_change")
    expect(toolNames).toContain("sdd.generate_code")
    expect(toolNames).toContain("sdd.verify_implementation")
    expect(toolNames).toContain("sdd.complete_change")
  })

  test("workflow_refactor has enforce, validate, approve, generate, verify, complete", () => {
    const chain = ALL_CHAINS.find((c) => c.name === "sdd.workflow_refactor")!
    const toolNames = chain.steps.map((s) => s.tool)
    expect(toolNames).toContain("sdd.enforce")
    expect(toolNames).toContain("sdd.approve_change")
    expect(toolNames).toContain("sdd.generate_code")
    expect(toolNames).toContain("sdd.verify_implementation")
    expect(toolNames).toContain("sdd.complete_change")
  })
})

describe("executeChain", () => {
  test("executes all steps in order", async () => {
    const chain: WorkflowChain = {
      name: "test-chain",
      description: "Test",
      params: [{ name: "input", type: "string", description: "Input" }],
      steps: [
        { tool: "step1", args: {}, required: true, description: "Step 1" },
        { tool: "step2", args: {}, required: true, description: "Step 2" },
      ],
    }
    const executed: string[] = []
    const executor = async (tool: string) => { executed.push(tool); return `${tool}-result` }
    const result = await executeChain(chain, { input: "test" }, executor)
    expect(result.success).toBe(true)
    expect(executed).toEqual(["step1", "step2"])
    expect(result.steps.length).toBe(2)
  })

  test("stops on required step failure", async () => {
    const chain: WorkflowChain = {
      name: "fail-chain",
      description: "Test",
      params: [],
      steps: [
        { tool: "ok", args: {}, required: true, description: "OK" },
        { tool: "fail", args: {}, required: true, description: "Fail" },
        { tool: "never", args: {}, required: true, description: "Never" },
      ],
    }
    const executor = async (tool: string) => {
      if (tool === "fail") throw new Error("step failed")
      return `${tool}-result`
    }
    const result = await executeChain(chain, {}, executor)
    expect(result.success).toBe(false)
    expect(result.steps.length).toBe(2)
    expect(result.completedSteps).toBe(1)
  })

  test("continues on optional step failure", async () => {
    const chain: WorkflowChain = {
      name: "optional-chain",
      description: "Test",
      params: [],
      steps: [
        { tool: "ok", args: {}, required: true, description: "OK" },
        { tool: "fail", args: {}, required: false, description: "Fail" },
        { tool: "also-ok", args: {}, required: true, description: "Also OK" },
      ],
    }
    const executor = async (tool: string) => {
      if (tool === "fail") throw new Error("step failed")
      return `${tool}-result`
    }
    const result = await executeChain(chain, {}, executor)
    expect(result.success).toBe(true)
    expect(result.steps.length).toBe(3)
  })

  test("chain timeout stops execution", async () => {
    const chain: WorkflowChain = {
      name: "timeout-chain",
      description: "Test",
      params: [],
      steps: [
        { tool: "slow", args: {}, required: true, description: "Slow" },
      ],
    }
    const executor = async () => new Promise<string>((resolve) => setTimeout(() => resolve("done"), 5000))
    const result = await executeChain(chain, {}, executor, { stepTimeoutMs: 100, chainTimeoutMs: 200 })
    expect(result.success).toBe(false)
  })

  test("step timeout stops individual step", async () => {
    const chain: WorkflowChain = {
      name: "step-timeout",
      description: "Test",
      params: [],
      steps: [
        { tool: "slow", args: {}, required: true, description: "Slow" },
      ],
    }
    const executor = async () => new Promise<string>((resolve) => setTimeout(() => resolve("done"), 5000))
    const result = await executeChain(chain, {}, executor, { stepTimeoutMs: 100, chainTimeoutMs: 10000 })
    expect(result.success).toBe(false)
  })

  test("args function receives initialParams and previousSteps", async () => {
    const chain: WorkflowChain = {
      name: "args-chain",
      description: "Test",
      params: [{ name: "briefing", type: "string", description: "Briefing" }],
      steps: [
        { tool: "step1", args: (_prev, initial) => ({ briefing: String(initial.briefing || "") }), required: true, description: "Step 1" },
      ],
    }
    const capturedArgs: Record<string, unknown>[] = []
    const executor = async (tool: string, args: Record<string, unknown>) => { capturedArgs.push(args); return "ok" }
    await executeChain(chain, { briefing: "test briefing" }, executor)
    expect(capturedArgs[0].briefing).toBe("test briefing")
  })
})

describe("formatChainResult", () => {
  test("formats success result", () => {
    const result = {
      chainName: "test",
      success: true,
      steps: [{ tool: "step1", result: "ok", success: true, timeMs: 100 }],
      finalResult: "step1-result",
      totalTimeMs: 100,
      completedSteps: 1,
    }
    const formatted = formatChainResult(result)
    expect(formatted).toContain("test")
    expect(formatted).toContain("✅")
  })

  test("formats failure result", () => {
    const result = {
      chainName: "test",
      success: false,
      steps: [{ tool: "step1", result: "error", success: false, timeMs: 100 }],
      finalResult: "error",
      totalTimeMs: 100,
      completedSteps: 0,
    }
    const formatted = formatChainResult(result)
    expect(formatted).toContain("test")
    expect(formatted).toContain("❌")
  })
})
