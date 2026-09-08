import { existsSync, chmodSync } from "fs";
import { join } from "path";
import { atomicWriteFile } from "../sdd/cache/atomic.js";
export function generateShellHooks(config) {
    const created = [];
    if (config.hooks.includes("pre-commit")) {
        createPreCommitHook(config.projectDir);
        created.push("pre-commit");
    }
    if (config.hooks.includes("post-checkout")) {
        createPostCheckoutHook(config.projectDir);
        created.push("post-checkout");
    }
    if (config.hooks.includes("post-merge")) {
        createPostMergeHook(config.projectDir);
        created.push("post-merge");
    }
    return created;
}
function createPreCommitHook(projectDir) {
    const hookDir = join(projectDir, ".git", "hooks");
    if (!existsSync(hookDir))
        return;
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
`;
    const hookPath = join(hookDir, "pre-commit");
    atomicWriteFile(hookPath, hook);
    chmodSync(hookPath, "755");
}
function createPostCheckoutHook(projectDir) {
    const hookDir = join(projectDir, ".git", "hooks");
    if (!existsSync(hookDir))
        return;
    const hook = `#!/bin/sh
# OPENCODE TELOS Post-Checkout Hook
# Logs checkout events for SDD tracking

echo "🔄 SDD: Branch checkout detected"
exit 0
`;
    const hookPath = join(hookDir, "post-checkout");
    atomicWriteFile(hookPath, hook);
    chmodSync(hookPath, "755");
}
function createPostMergeHook(projectDir) {
    const hookDir = join(projectDir, ".git", "hooks");
    if (!existsSync(hookDir))
        return;
    const hook = `#!/bin/sh
# OPENCODE TELOS Post-Merge Hook
# Logs merge events for SDD tracking

echo "🔀 SDD: Merge detected"
exit 0
`;
    const hookPath = join(hookDir, "post-merge");
    atomicWriteFile(hookPath, hook);
    chmodSync(hookPath, "755");
}
export function formatShellHookResult(created) {
    if (created.length === 0) {
        return "No shell hooks created.";
    }
    const lines = [
        "## Shell Hooks Installed",
        "",
    ];
    for (const hook of created) {
        lines.push(`- ✅ ${hook}`);
    }
    lines.push("\nHooks are located in `.git/hooks/`");
    return lines.join("\n");
}
