/**
 * Verify No Dead Code — Verificação de código morto e arquivos não consumidos.
 *
 * Executa: npx tsx scripts/verify-no-dead-code.ts
 *
 * Verifica:
 * 1. Todos os arquivos criados são importados por alguém
 * 2. Todas as funções exportadas são usadas
 * 3. Não há imports circulares
 * 4. Não há arquivos órfãos
 */

import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, "..")
const SRC = path.join(ROOT, "src")

// Arquivos criados pela implementação
const NEW_FILES = [
  // Router (Item 1 + 2 + 3)
  "src/opencode/router/index.ts",
  "src/opencode/router/tool-taxonomy.ts",
  "src/opencode/router/tools-composite.ts",
  "src/opencode/router/state-gate.ts",
  "src/opencode/router/graph-state-snapshot.ts",
  "src/opencode/router/intent-classifier.ts",
  "src/opencode/router/tool-registry.ts",
  "src/opencode/router/embeddings.ts",
  "src/opencode/router/categories.ts",
  "src/opencode/router/semantic-nudge.ts",
  "src/opencode/router/tool-embeddings.ts",
  // Workflows (Item 4)
  "src/opencode/workflows/index.ts",
  "src/opencode/workflows/chains.ts",
  "src/opencode/workflows/executor.ts",
  "src/opencode/workflows/types.ts",
  "src/opencode/workflows/tools-workflow.ts",
  // Script
  "scripts/verify-no-dead-code.ts",
]

// Arquivos existentes que importam os novos módulos
const CONSUMERS = [
  "src/opencode/tools.ts",       // importa tools-composite.ts, tools-workflow.ts
  "src/opencode/hooks.ts",       // importa router/semantic-nudge.ts, router/tool-registry.ts, router/graph-state-snapshot.ts
  "src/opencode/system-prompt.ts", // Referenciado mas não importa diretamente
  // Internos dos módulos novos
  "src/opencode/router/index.ts",
  "src/opencode/router/state-gate.ts",
  "src/opencode/router/graph-state-snapshot.ts",
  "src/opencode/router/intent-classifier.ts",
  "src/opencode/router/tool-registry.ts",
  "src/opencode/router/semantic-nudge.ts",
  "src/opencode/router/tool-embeddings.ts",
  "src/opencode/router/embeddings.ts",
  "src/opencode/router/categories.ts",
  "src/opencode/router/tool-taxonomy.ts",
  "src/opencode/router/tools-composite.ts",
  "src/opencode/workflows/index.ts",
  "src/opencode/workflows/chains.ts",
  "src/opencode/workflows/executor.ts",
  "src/opencode/workflows/types.ts",
  "src/opencode/workflows/tools-workflow.ts",
]

interface VerificationResult {
  file: string
  consumed: boolean
  consumers: string[]
  exports: string[]
  unusedExports: string[]
}

function checkFileConsumed(filePath: string): { consumed: boolean; consumers: string[] } {
  const relativePath = path.relative(ROOT, filePath)
  const baseName = path.basename(filePath, ".ts")
  const dirName = path.dirname(relativePath)

  // Search for imports of this file
  const consumers: string[] = []
  const searchPatterns = [
    `from "${dirName}/${baseName}"`,
    `from "${dirName}/${baseName}.js"`,
    `from "./${baseName}"`,
    `from "./${baseName}.js"`,
    `from "../${path.relative("src/opencode", dirName)}/${baseName}"`,
    `from "../${path.relative("src/opencode", dirName)}/${baseName}.js"`,
    // Also match full relative paths from any consumer
    `/${baseName}.js"`,
    `/${baseName}"`,
  ]

  // Also check dynamic imports
  const dynamicPatterns = [
    `import("${dirName}/${baseName}`,
    `import("./${baseName}`,
    `import("../${path.relative("src/opencode", dirName)}/${baseName}`,
  ]

  // Also check for barrel imports (e.g., from "./router/index")
  const barrelPatterns = [
    `from "./${dirName.split("/").pop()}/index"`,
    `from "./${dirName.split("/").pop()}/index.js"`,
  ]

  for (const consumer of CONSUMERS) {
    const content = fs.readFileSync(path.join(ROOT, consumer), "utf-8")
    for (const pattern of [...searchPatterns, ...dynamicPatterns, ...barrelPatterns]) {
      if (content.includes(pattern)) {
        consumers.push(consumer)
        break
      }
    }
  }

  // Also check barrel exports
  if (dirName.includes("router")) {
    const routerIndex = fs.readFileSync(path.join(ROOT, "src/opencode/router/index.ts"), "utf-8")
    if (routerIndex.includes(baseName)) {
      // Router index re-exports this file
      // Check if router/index.ts is consumed
      for (const consumer of CONSUMERS) {
        const content = fs.readFileSync(path.join(ROOT, consumer), "utf-8")
        if (content.includes("./router/index") || content.includes("./router/index.js")) {
          if (!consumers.includes(consumer)) {
            consumers.push(consumer + " (via barrel)")
          }
        }
      }
    }
  }

  if (dirName.includes("workflows")) {
    const workflowsIndex = fs.readFileSync(path.join(ROOT, "src/opencode/workflows/index.ts"), "utf-8")
    if (workflowsIndex.includes(baseName)) {
      for (const consumer of CONSUMERS) {
        const content = fs.readFileSync(path.join(ROOT, consumer), "utf-8")
        if (content.includes("./workflows/index") || content.includes("./workflows/index.js")) {
          if (!consumers.includes(consumer)) {
            consumers.push(consumer + " (via barrel)")
          }
        }
      }
    }
  }

  return { consumed: consumers.length > 0, consumers }
}

function checkExportsUsed(filePath: string): { exports: string[]; unused: string[] } {
  const fullPath = filePath.startsWith(ROOT) ? filePath : path.join(ROOT, filePath)
  const content = fs.readFileSync(fullPath, "utf-8")

  // Extract exported names
  const exportPattern = /export\s+(?:function|const|type|interface|enum)\s+(\w+)/g
  const exports: string[] = []
  let match
  while ((match = exportPattern.exec(content)) !== null) {
    exports.push(match[1])
  }

  // Also check barrel re-exports
  const reExportPattern = /export\s+\{\s+([^}]+)\}\s+from/g
  while ((match = reExportPattern.exec(content)) !== null) {
    const names = match[1].split(",").map(n => n.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)
    exports.push(...names)
  }

  // Check if each export is used anywhere in the codebase
  const unused: string[] = []
  for (const name of exports) {
    let used = false

    // Search all source files
    const srcFiles = fs.readdirSync(path.join(ROOT, "src"), { recursive: true }) as string[]
    for (const file of srcFiles) {
      if (!file.endsWith(".ts") || file === filePath) continue
      const fileContent = fs.readFileSync(path.join(ROOT, "src", file), "utf-8")
      if (fileContent.includes(name)) {
        used = true
        break
      }
    }

    if (!used) {
      unused.push(name)
    }
  }

  return { exports, unused }
}

// Main verification
console.log("=== Dead Code Verification ===\n")

let hasIssues = false

for (const file of NEW_FILES) {
  const fullPath = path.join(ROOT, file)
  if (!fs.existsSync(fullPath)) {
    console.log(`❌ MISSING: ${file}`)
    hasIssues = true
    continue
  }

  const { consumed, consumers } = checkFileConsumed(fullPath)
  const { exports: exportedNames, unused } = checkExportsUsed(fullPath)

  if (!consumed) {
    console.log(`⚠️  NOT CONSUMED: ${file}`)
    console.log(`   No imports found in consumer files.`)
    hasIssues = true
  } else {
    console.log(`✅ CONSUMED: ${file}`)
    console.log(`   By: ${consumers.join(", ")}`)
  }

  if (unused.length > 0) {
    console.log(`   ⚠️  Unused exports: ${unused.join(", ")}`)
    hasIssues = true
  }

  if (exportedNames.length > 0) {
    console.log(`   Exports: ${exportedNames.join(", ")}`)
  }
  console.log("")
}

// Check for circular dependencies
console.log("\n=== Circular Dependency Check ===\n")

function hasCircularImport(filePath: string, visited: Set<string> = new Set()): boolean {
  if (visited.has(filePath)) return true
  visited.add(filePath)

  const content = fs.readFileSync(path.join(ROOT, filePath), "utf-8")
  const importPattern = /from\s+["']([^"']+)["']/g
  let match

  while ((match = importPattern.exec(content)) !== null) {
    const importPath = match[1]
    if (!importPath.startsWith(".") && !importPath.startsWith("../")) continue

    const resolved = path.resolve(path.dirname(path.join(ROOT, filePath)), importPath)
    const tsFile = resolved.endsWith(".ts") ? resolved : resolved + ".ts"

    const normalizedTsFile = path.normalize(tsFile)
    if (fs.existsSync(normalizedTsFile) && NEW_FILES.some(f => path.normalize(path.join(ROOT, f)) === normalizedTsFile)) {
      if (hasCircularImport(normalizedTsFile, new Set(visited))) {
        return true
      }
    }
  }

  return false
}

for (const file of NEW_FILES) {
  if (!file.endsWith(".ts")) continue
  if (hasCircularImport(file)) {
    console.log(`❌ CIRCULAR: ${file}`)
    hasIssues = true
  }
}

if (!hasIssues) {
  console.log("✅ No circular dependencies found.")
}

// Summary
console.log("\n=== Summary ===\n")
if (hasIssues) {
  console.log("⚠️  Some issues found. Review above.")
} else {
  console.log("✅ All files consumed, no dead code detected.")
}
