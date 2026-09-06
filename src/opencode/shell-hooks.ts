import { writeFileSync, existsSync, chmodSync } from "fs"
import { join } from "path"

export interface ShellHookConfig {
  projectDir: string
  hooks: string[]
}

export function generateShellHooks(config: ShellHookConfig): string[] {
  const created: string[] = []

  if (config.hooks.includes("pre-commit")) {
    createPreCommitHook(config.projectDir)
    created.push("pre-commit")
  }

  if (config.hooks.includes("post-checkout")) {
    createPostCheckoutHook(config.projectDir)
    created.push("post-checkout")
  }

  if (config.hooks.includes("post-merge")) {
    createPostMergeHook(config.projectDir)
    created.push("post-merge")
  }

  return created
}

function createPreCommitHook(projectDir: string): void {
  const hookDir = join(projectDir, ".git", "hooks")
  if (!existsSync(hookDir)) return

  const hook = `#!/bin/sh
# OPENCODE TELOS Pre-Commit Hook
# Validates SDD state before allowing commits

echo "🔍 SDD: Checking specification state..."

# Check if SDD is initialized
if [ -f ".sdd/enabled" ]; then
  ENABLED=$(cat .sdd/enabled)
  if [ "$ENABLED" = "true" ]; then
    echo "✅ SDD is enabled"
    
    # Check for pending changes
    if [ -f ".sdd/graph.yaml" ]; then
      echo "📋 SDD graph found - run 'sdd.status' to check state"
    fi
  else
    echo "⚠️  SDD is disabled"
  fi
else
  echo "ℹ️  SDD not initialized"
fi

exit 0
`

  const hookPath = join(hookDir, "pre-commit")
  writeFileSync(hookPath, hook, "utf-8")
  chmodSync(hookPath, "755")
}

function createPostCheckoutHook(projectDir: string): void {
  const hookDir = join(projectDir, ".git", "hooks")
  if (!existsSync(hookDir)) return

  const hook = `#!/bin/sh
# OPENCODE TELOS Post-Checkout Hook
# Logs checkout events for SDD tracking

echo "🔄 SDD: Branch checkout detected"
exit 0
`

  const hookPath = join(hookDir, "post-checkout")
  writeFileSync(hookPath, hook, "utf-8")
  chmodSync(hookPath, "755")
}

function createPostMergeHook(projectDir: string): void {
  const hookDir = join(projectDir, ".git", "hooks")
  if (!existsSync(hookDir)) return

  const hook = `#!/bin/sh
# OPENCODE TELOS Post-Merge Hook
# Logs merge events for SDD tracking

echo "🔀 SDD: Merge detected"
exit 0
`

  const hookPath = join(hookDir, "post-merge")
  writeFileSync(hookPath, hook, "utf-8")
  chmodSync(hookPath, "755")
}

export function formatShellHookResult(created: string[]): string {
  if (created.length === 0) {
    return "No shell hooks created."
  }

  const lines = [
    "## Shell Hooks Installed",
    "",
  ]

  for (const hook of created) {
    lines.push(`- ✅ ${hook}`)
  }

  lines.push("\nHooks are located in `.git/hooks/`")
  return lines.join("\n")
}
