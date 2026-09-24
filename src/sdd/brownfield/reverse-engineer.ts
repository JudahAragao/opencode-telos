/**
 * Reverse Engineering Scanner — Analisa um codebase existente e gera um
 * BriefingDeepAnalysis agnóstico de tecnologia.
 *
 * O scanner extrai:
 * - Entidades e campos (de models/schemas/migrations)
 * - Endpoints (de routes/controllers)
 * - Regras de negócio (de services/use-cases)
 * - Componentes arquiteturais (por camada genérica)
 * - Decisões arquiteturais (inferidas da estrutura)
 *
 * Quando purpose === "reverse_engineering", TODA a tecnologia específica
 * é removida — o resultado descreve O QUE o sistema faz, não COMO.
 *
 * Consumido por: tools.ts (sdd.reverse_engineer)
 * Dependências: brownfield/scanner.ts, fs, path
 */

import { readFileSync, existsSync, readdirSync } from "fs"
import { join, relative, extname, basename } from "path"
import type { BriefingDeepAnalysis } from "../discovery/briefing-analyzer.js"
import { scanExistingProject, type BrownfieldAnalysis } from "./scanner.js"
import { detectBrownfieldFindings, type FindingInput } from "./findings.js"
import { sddDebug } from "../log.js"

// ── Types ─────────────────────────────────────────────────────────

export interface ReverseEngineeringOptions {
  purpose: "documentation" | "reverse_engineering"
  depth: "structure" | "full"
  focusDirs?: string[]
  excludeDirs?: string[]
  maxFiles?: number
}

export interface DiscoveredEntity {
  name: string
  description: string
  fields: Array<{ name: string; type: string; required?: boolean }>
  source: string
  confidence: "high" | "medium" | "low"
}

export interface DiscoveredEndpoint {
  method: string
  path: string
  description: string
  relatedEntity?: string
  source: string
  confidence: "high" | "medium" | "low"
}

export interface DiscoveredBusinessRule {
  name: string
  description: string
  source: string
  confidence: "high" | "medium" | "low"
}

export interface DiscoveredArchitecture {
  name: string
  layer: "frontend" | "backend" | "database" | "infrastructure" | "external"
  technology: string
  description: string
  source: string
}

export interface ReverseEngineeringResult {
  analysis: BriefingDeepAnalysis
  brownfield: BrownfieldAnalysis
  findings: FindingInput[]
  discoveredEntities: DiscoveredEntity[]
  discoveredEndpoints: DiscoveredEndpoint[]
  discoveredBusinessRules: DiscoveredBusinessRule[]
  discoveredArchitecture: DiscoveredArchitecture[]
  summary: string
}

// ── File Pattern Matchers ──────────────────────────────────────────

/** Patterns that indicate a model/schema file */
const MODEL_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  // Prisma
  { pattern: /\.prisma$/, type: "prisma" },
  // Sequelize
  { pattern: /\.(?:model|migration)\.(?:ts|js)$/, type: "sequelize" },
  // TypeORM
  { pattern: /\.entity\.(?:ts|js)$/, type: "typeorm" },
  // Mongoose
  { pattern: /\.schema\.(?:ts|js)$/, type: "mongoose" },
  // Drizzle
  { pattern: /\.schema\.(?:ts|js)$/, type: "drizzle" },
  // Generic model files
  { pattern: /(?:^|[\\/])models?[\\/]/i, type: "generic" },
  { pattern: /(?:^|[\\/])entities?[\\/]/i, type: "generic" },
  { pattern: /(?:^|[\\/])schemas?[\\/]/i, type: "generic" },
  // Go structs
  { pattern: /\.go$/, type: "go" },
  // Python models
  { pattern: /models?\.py$/, type: "python" },
  // Java entities
  { pattern: /Entity\.java$/, type: "java" },
]

/** Patterns that indicate a route/controller file */
const ROUTE_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /(?:^|[\\/])routes?[\\/]/i, type: "routes" },
  { pattern: /(?:^|[\\/])controllers?[\\/]/i, type: "controllers" },
  { pattern: /(?:^|[\\/])handlers?[\\/]/i, type: "handlers" },
  { pattern: /\.routes?\.(?:ts|js)$/, type: "routes" },
  { pattern: /\.controller\.(?:ts|js)$/, type: "controllers" },
  { pattern: /\.handler\.(?:ts|js)$/, type: "handlers" },
  // API routes (Next.js, etc.)
  { pattern: /(?:^|[\\/])api[\\/]/i, type: "api" },
]

/** Patterns that indicate a service/use-case file */
const SERVICE_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /(?:^|[\\/])services?[\\/]/i, type: "services" },
  { pattern: /(?:^|[\\/])use.?cases?[\\/]/i, type: "usecases" },
  { pattern: /(?:^|[\\/])repositories?[\\/]/i, type: "repositories" },
  { pattern: /\.service\.(?:ts|js)$/, type: "services" },
  { pattern: /\.usecase\.(?:ts|js)$/, type: "usecases" },
]

// ── Prisma Schema Parser ───────────────────────────────────────────

function parsePrismaSchema(content: string): DiscoveredEntity[] {
  const entities: DiscoveredEntity[] = []
  const modelBlocks = content.match(/model\s+(\w+)\s*\{([^}]+)\}/g) || []

  for (const block of modelBlocks) {
    const nameMatch = block.match(/model\s+(\w+)/)
    if (!nameMatch) continue
    const name = nameMatch[1]

    const bodyMatch = block.match(/\{([^}]+)\}/)
    if (!bodyMatch) continue

    const fields: DiscoveredEntity["fields"] = []
    const lines = bodyMatch[1].split("\n").filter(l => l.trim() && !l.trim().startsWith("//"))

    for (const line of lines) {
      const trimmed = line.trim()
      // Skip relations, blocks, enums
      if (trimmed.startsWith("@") || trimmed.startsWith("}") || trimmed.includes("@@")) continue

      const fieldMatch = trimmed.match(/^(\w+)\s+(\w+)(.*)$/)
      if (!fieldMatch) continue

      const [, fieldName, fieldType, rest] = fieldMatch
      if (fieldName === "id" && fieldType === "String") continue // skip auto-id

      const isRequired = rest.includes("@required") || !rest.includes("?")
      fields.push({
        name: fieldName,
        type: mapPrismaType(fieldType),
        required: isRequired,
      })
    }

    entities.push({
      name,
      description: `${name} entity`,
      fields,
      source: "prisma.schema",
      confidence: "high",
    })
  }

  return entities
}

function mapPrismaType(type: string): string {
  const t = type.toLowerCase().replace("?", "")
  if (t === "string" || t === "text") return "string"
  if (t === "int" || t === "integer" || t === "float" || t === "decimal" || t === "bigint") return "integer"
  if (t === "boolean" || t === "bool") return "boolean"
  if (t === "datetime" || t === "timestamp" || t === "date") return "timestamp"
  if (t === "json" || t === "jsonb") return "json"
  if (t.includes("uuid")) return "uuid"
  if (t.includes("[]")) return "array"
  return "string"
}

// ── TypeScript/JavaScript Entity Extractor ─────────────────────────

function extractTsEntities(filePath: string, content: string): DiscoveredEntity[] {
  const entities: DiscoveredEntity[] = []
  const fileName = basename(filePath)

  // Interface/type extraction
  const interfacePattern = /(?:export\s+)?(?:interface|type)\s+(\w+)\s*(?:extends\s+\w+\s*)?\{([^}]+)\}/g
  let match: RegExpExecArray | null

  while ((match = interfacePattern.exec(content)) !== null) {
    const name = match[1]
    // Skip internal types
    if (["Props", "State", "Config", "Options", "Result", "Response", "Request", "Context", "Event"].some(s => name.endsWith(s))) continue

    const body = match[2]
    const fields: DiscoveredEntity["fields"] = []

    const fieldLines = body.split("\n").filter(l => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    for (const line of fieldLines) {
      const fieldMatch = line.trim().match(/^(\w+)\??\s*:\s*(.+?)(?:;|$)/)
      if (!fieldMatch) continue
      const [, fname, ftype] = fieldMatch
      fields.push({
        name: fname,
        type: mapTsType(ftype.trim()),
        required: !line.includes("?"),
      })
    }

    if (fields.length > 0) {
      entities.push({
        name,
        description: `${name} from ${fileName}`,
        fields,
        source: filePath,
        confidence: "medium",
      })
    }
  }

  // Class extraction (for ORMs)
  const classPattern = /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+\w+)?\s*\{([^}]+)\}/g
  while ((match = classPattern.exec(content)) !== null) {
    const name = match[1]
    if (name.endsWith("Service") || name.endsWith("Controller") || name.endsWith("Handler") || name.endsWith("Test")) continue

    const body = match[2]
    const fields: DiscoveredEntity["fields"] = []

    // Look for property declarations
    const propPattern = /(?:private|public|protected|readonly)\s+(\w+)\s*[=:]\s*(.+?)(?:;|,|$)/g
    let propMatch: RegExpExecArray | null
    while ((propMatch = propPattern.exec(body)) !== null) {
      const [, pname, ptype] = propMatch
      if (pname === "id" || pname === "_") continue
      fields.push({
        name: pname,
        type: mapTsType(ptype.trim()),
        required: true,
      })
    }

    if (fields.length > 0) {
      entities.push({
        name,
        description: `${name} class from ${fileName}`,
        fields,
        source: filePath,
        confidence: "medium",
      })
    }
  }

  return entities
}

function mapTsType(type: string): string {
  const t = type.toLowerCase().replace(/[?\s]/g, "").replace(/"/g, "'")
  if (t === "string") return "string"
  if (t === "number") return "integer"
  if (t === "boolean") return "boolean"
  if (t === "date") return "timestamp"
  if (t.includes("date")) return "timestamp"
  if (t.includes("json") || t.includes("record")) return "json"
  if (t.includes("uuid")) return "uuid"
  if (t.includes("[]") || t.includes("array")) return "array"
  if (t.includes("string")) return "string"
  if (t.includes("number")) return "integer"
  return "string"
}

// ── Endpoint Extractor ─────────────────────────────────────────────

function extractEndpoints(filePath: string, content: string): DiscoveredEndpoint[] {
  const endpoints: DiscoveredEndpoint[] = []

  // Express/Fastify/Hono style: router.get('/path', ...) or app.post('/path', ...)
  const routerPattern = /(?:router|app|server)\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/g
  let match: RegExpExecArray | null

  while ((match = routerPattern.exec(content)) !== null) {
    const method = match[1].toUpperCase()
    const path = match[2]
    endpoints.push({
      method,
      path,
      description: `${method} ${path}`,
      source: filePath,
      confidence: "high",
    })
  }

  // NestJS decorators: @Get('/path'), @Post('/path'), etc.
  const nestPattern = /@(Get|Post|Put|Patch|Delete|Head|Options)\s*\(\s*['"`]?([^'"`)]*)['"`]?\s*\)/g
  while ((match = nestPattern.exec(content)) !== null) {
    const method = match[1].toUpperCase()
    const path = match[2] || "/"
    endpoints.push({
      method,
      path: path.startsWith("/") ? path : `/${path}`,
      description: `${method} ${path}`,
      source: filePath,
      confidence: "high",
    })
  }

  // Django style: path('api/...', views.xxx, name='...')
  const djangoPattern = /path\s*\(\s*['"]([^'"]+)['"]/g
  while ((match = djangoPattern.exec(content)) !== null) {
    endpoints.push({
      method: "ANY",
      path: `/${match[1]}`,
      description: `Endpoint at /${match[1]}`,
      source: filePath,
      confidence: "medium",
    })
  }

  // Go style: r.GET("/path", handler) or r.HandleFunc("/path", handler).Methods("GET")
  const goPattern = /(?:r|mux|router)\.\s*(GET|POST|PUT|PATCH|DELETE|Handle)\s*\(\s*"([^"]+)"/g
  while ((match = goPattern.exec(content)) !== null) {
    endpoints.push({
      method: match[1].toUpperCase(),
      path: match[2],
      description: `${match[1].toUpperCase()} ${match[2]}`,
      source: filePath,
      confidence: "high",
    })
  }

  return endpoints
}

// ── Business Rule Extractor ────────────────────────────────────────

function extractBusinessRules(filePath: string, content: string): DiscoveredBusinessRule[] {
  const rules: DiscoveredBusinessRule[] = []
  const fileName = basename(filePath)

  // Look for validation logic patterns
  const validationPatterns = [
    { pattern: /(?:if|else\s+if)\s*\([^)]*(?:valid|check|verify|ensure|assert|require|must|should)[^)]*\)/gi, type: "validation" },
    { pattern: /(?:throw|Error|Exception)\s*\([^)]*(?:invalid|missing|required|forbidden|unauthorized|not\s*found)[^)]*\)/gi, type: "error_handling" },
    { pattern: /(?:guard|assert|ensure|require)\s*\(/gi, type: "precondition" },
  ]

  for (const { pattern, type } of validationPatterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content)) !== null) {
      const context = content.slice(Math.max(0, match.index - 100), match.index + match[0].length + 100)
      const line = context.split("\n").find(l => l.includes(match![0])) || match[0]

      rules.push({
        name: `${type}: ${fileName}`,
        description: line.trim().slice(0, 200),
        source: filePath,
        confidence: "low",
      })
    }
  }

  // Deduplicate by description
  const seen = new Set<string>()
  return rules.filter(r => {
    const key = r.description.slice(0, 50)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 20)
}

// ── Architecture Detector ──────────────────────────────────────────

function detectArchitecture(
  brownfield: BrownfieldAnalysis,
  projectDir: string,
): DiscoveredArchitecture[] {
  const arch: DiscoveredArchitecture[] = []

  // Detect layers from directory structure
  const dirs = brownfield.structure.directories

  // Frontend detection
  const frontendDirs = dirs.filter(d =>
    /^(?:src[\\/])?(?:client|frontend|web|app|pages|components|views|ui)/i.test(d) ||
    /(?:public|static|assets)/i.test(d)
  )
  if (frontendDirs.length > 0) {
    arch.push({
      name: "Frontend",
      layer: "frontend",
      technology: brownfield.structure.frameworks.find(f => ["react", "vue", "angular", "svelte"].includes(f)) || "unknown",
      description: `Frontend layer (${frontendDirs.length} directories)`,
      source: frontendDirs[0],
    })
  }

  // Backend detection
  const backendDirs = dirs.filter(d =>
    /^(?:src[\\/])?(?:server|backend|api|routes|controllers|services|middleware)/i.test(d) ||
    /^(?:src[\\/])?(?:lib|core|domain|infrastructure)/i.test(d)
  )
  if (backendDirs.length > 0 || brownfield.entry_points.length > 0) {
    arch.push({
      name: "Backend",
      layer: "backend",
      technology: brownfield.structure.frameworks.find(f => ["express", "fastify", "nestjs", "django", "flask", "rails"].includes(f)) || "unknown",
      description: `Backend layer (${backendDirs.length} directories)`,
      source: backendDirs[0] || brownfield.entry_points[0],
    })
  }

  // Database detection
  const dbIndicators = [
    ...brownfield.config_files.filter(f => /(?:database|db|orm|prisma|sequelize|typeorm|drizzle)/i.test(f)),
    ...dirs.filter(d => /(?:migrations?|seeds?|db|database)/i.test(d)),
  ]
  if (dbIndicators.length > 0) {
    arch.push({
      name: "Database",
      layer: "database",
      technology: "unknown",
      description: "Database layer",
      source: dbIndicators[0],
    })
  }

  // Infrastructure detection
  const infraFiles = brownfield.config_files.filter(f =>
    /(?:docker|k8s|terraform|nginx|ci|cd|deploy|workflow)/i.test(f)
  )
  if (infraFiles.length > 0) {
    arch.push({
      name: "Infrastructure",
      layer: "infrastructure",
      technology: infraFiles.some(f => /docker/i.test(f)) ? "Docker" : "unknown",
      description: `Infrastructure configuration (${infraFiles.length} files)`,
      source: infraFiles[0],
    })
  }

  // If no layers detected, create generic ones
  if (arch.length === 0) {
    arch.push({
      name: "Application",
      layer: "backend",
      technology: "unknown",
      description: "Main application layer",
      source: projectDir,
    })
  }

  return arch
}

// ── Main Scanner ───────────────────────────────────────────────────

export function reverseEngineerProject(
  projectDir: string,
  options: ReverseEngineeringOptions,
): ReverseEngineeringResult {
  sddDebug("reverse-engineer", `Starting scan with purpose=${options.purpose}, depth=${options.depth}`)

  // 1. Run basic brownfield scan
  const brownfield = scanExistingProject(projectDir, {
    focusDirs: options.focusDirs,
    excludeDirs: options.excludeDirs,
    maxFiles: options.maxFiles,
  })

  // 2. Scan for entities in model/schema files
  const discoveredEntities: DiscoveredEntity[] = []
  const modelFiles = findFilesByPatterns(projectDir, MODEL_PATTERNS, options)

  for (const filePath of modelFiles) {
    try {
      const content = readFileSync(join(projectDir, filePath), "utf-8")
      const ext = extname(filePath).toLowerCase()

      if (ext === ".prisma") {
        discoveredEntities.push(...parsePrismaSchema(content))
      } else if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
        discoveredEntities.push(...extractTsEntities(filePath, content))
      }
    } catch {
      // Skip unreadable files
    }
  }

  // 3. Scan for endpoints in route/controller files
  const discoveredEndpoints: DiscoveredEndpoint[] = []
  const routeFiles = findFilesByPatterns(projectDir, ROUTE_PATTERNS, options)

  for (const filePath of routeFiles) {
    try {
      const content = readFileSync(join(projectDir, filePath), "utf-8")
      discoveredEndpoints.push(...extractEndpoints(filePath, content))
    } catch {
      // Skip
    }
  }

  // 4. Scan for business rules in service/use-case files (only for full depth)
  const discoveredBusinessRules: DiscoveredBusinessRule[] = []
  if (options.depth === "full") {
    const serviceFiles = findFilesByPatterns(projectDir, SERVICE_PATTERNS, options)
    for (const filePath of serviceFiles) {
      try {
        const content = readFileSync(join(projectDir, filePath), "utf-8")
        discoveredBusinessRules.push(...extractBusinessRules(filePath, content))
      } catch {
        // Skip
      }
    }
  }

  // 5. Detect architecture layers
  const discoveredArchitecture = detectArchitecture(brownfield, projectDir)

  // 6. Build BriefingDeepAnalysis
  const analysis = buildAnalysis(
    discoveredEntities,
    discoveredEndpoints,
    discoveredBusinessRules,
    discoveredArchitecture,
    brownfield,
    options.purpose,
  )

  const findingScan = detectBrownfieldFindings(projectDir, brownfield, options.purpose)

  // 7. Build summary
  const summary = buildSummary(
    discoveredEntities,
    discoveredEndpoints,
    discoveredBusinessRules,
    discoveredArchitecture,
    brownfield,
    options.purpose,
  )

  return {
    analysis,
    brownfield,
    findings: findingScan.findings,
    discoveredEntities,
    discoveredEndpoints,
    discoveredBusinessRules,
    discoveredArchitecture,
    summary,
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function findFilesByPatterns(
  projectDir: string,
  patterns: Array<{ pattern: RegExp; type: string }>,
  options: ReverseEngineeringOptions,
): string[] {
  const results: string[] = []
  const excludeDirs = new Set(options.excludeDirs || ["node_modules", ".git", "dist", "build", ".sdd", "coverage"])

  const walk = (dir: string, depth = 0) => {
    if (depth > 6) return
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith(".") || excludeDirs.has(entry.name)) continue
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1)
        } else {
          const relPath = relative(projectDir, fullPath)
          for (const { pattern } of patterns) {
            if (pattern.test(relPath) || pattern.test(entry.name)) {
              results.push(relPath)
              break
            }
          }
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  const roots = options.focusDirs?.length
    ? options.focusDirs.map(d => join(projectDir, d))
    : [projectDir]

  for (const root of roots) {
    if (existsSync(root)) walk(root)
  }

  return results
}

function buildAnalysis(
  entities: DiscoveredEntity[],
  endpoints: DiscoveredEndpoint[],
  rules: DiscoveredBusinessRule[],
  architecture: DiscoveredArchitecture[],
  _brownfield: BrownfieldAnalysis,
  purpose: "documentation" | "reverse_engineering",
): BriefingDeepAnalysis {
  const isReverseEng = purpose === "reverse_engineering"

  const discoveredFeatures = [
    ...endpoints.map((endpoint) => ({
      name: `${endpoint.method} ${endpoint.path}`,
      description: endpoint.description,
      priority: "medium" as const,
    })),
    ...entities.map((entity) => ({
      name: `Gerenciar ${entity.name}`,
      description: `Permite consultar e operar a entidade ${entity.name}.`,
      priority: "medium" as const,
    })),
  ].filter((feature, index, all) => all.findIndex((candidate) => candidate.name.toLowerCase() === feature.name.toLowerCase()) === index)

  const discoveredRequirements = [
    ...endpoints.map((endpoint) => ({
      name: `Expor ${endpoint.method} ${endpoint.path}`,
      description: `O sistema deve disponibilizar o comportamento observado em ${endpoint.method} ${endpoint.path}.`,
      type: "functional" as const,
      priority: "medium" as const,
      acceptanceCriteria: [
        `O fluxo ${endpoint.method} ${endpoint.path} deve possuir contrato documentado.`,
        "Cenários de sucesso e falha devem ser verificáveis por testes.",
      ],
    })),
    ...entities.map((entity) => ({
      name: `Persistir ${entity.name}`,
      description: `O sistema deve representar a entidade ${entity.name} e seus campos observados.`,
      type: "functional" as const,
      priority: "medium" as const,
      acceptanceCriteria: [
        `Os campos observados de ${entity.name} devem possuir contrato agnóstico de tecnologia.`,
        "Regras de validação e persistência devem ser verificáveis.",
      ],
    })),
  ].filter((requirement, index, all) => all.findIndex((candidate) => candidate.name.toLowerCase() === requirement.name.toLowerCase()) === index)

  const discoveredDecisions = architecture.map((component) => ({
    title: `Preservar camada ${component.layer}`,
    context: `A análise encontrou o componente arquitetural ${component.name} na origem (${component.source}).`,
    decision: `O SDD alvo deve manter a responsabilidade da camada ${component.layer}, podendo substituir a tecnologia.`,
    consequences: "A escolha concreta de framework e infraestrutura permanece pendente da decisão de stack do novo projeto.",
  }))

  return {
    features: discoveredFeatures,
    entities: entities.map(e => ({
      name: e.name,
      description: e.description,
      fields: e.fields.map(f => ({
        name: f.name,
        type: f.type,
        required: f.required,
      })),
    })),
    endpoints: endpoints.map(ep => ({
      method: ep.method,
      path: ep.path,
      description: ep.description,
      relatedEntity: ep.relatedEntity,
    })),
    businessRules: rules.map(r => ({
      name: r.name,
      description: r.description,
    })),
    architectureComponents: architecture.map(a => ({
      name: a.name,
      layer: a.layer,
      // For reverse engineering: use generic technology labels
      technology: isReverseEng ? `[${a.layer}]` : a.technology,
      description: a.description,
    })),
    decisions: discoveredDecisions,
    requirements: discoveredRequirements,
    tasks: isReverseEng ? discoveredRequirements.map((requirement) => ({
      name: `Implement ${requirement.name}`,
      description: `Implement the target behaviour specified by ${requirement.name}.`,
      goal: requirement.description,
      acceptance: requirement.acceptanceCriteria,
      priority: requirement.priority,
      requirement: requirement.name,
    })) : [],
    relationships: [], // Relationships are built by the graph builder
    domains: inferDomains(entities, endpoints),
    // For reverse engineering: clear tech stack (will be chosen by user)
    // For documentation: infer from architecture components
    techStack: (() => {
      const stack: Record<string, string> = {}
      for (const comp of architecture) {
        if (!isReverseEng && comp.technology && comp.technology !== "unknown") {
          stack[comp.layer] = comp.technology
        }
      }
      if (isReverseEng) {
        // Empty stack — technologies will be chosen by the user
        stack["frontend"] = ""
        stack["backend"] = ""
        stack["database"] = ""
      }
      return stack
    })(),
  }
}

function inferDomains(
  entities: DiscoveredEntity[],
  endpoints: DiscoveredEndpoint[],
): string[] {
  const domains = new Set<string>()

  for (const e of entities) {
    const name = e.name.toLowerCase()
    if (name.includes("user") || name.includes("auth") || name.includes("role")) domains.add("security")
    if (name.includes("order") || name.includes("payment") || name.includes("invoice")) domains.add("commerce")
    if (name.includes("product") || name.includes("catalog") || name.includes("inventory")) domains.add("catalog")
    if (name.includes("post") || name.includes("article") || name.includes("content") || name.includes("page")) domains.add("content")
    if (name.includes("notification") || name.includes("email") || name.includes("message")) domains.add("communication")
    if (name.includes("file") || name.includes("media") || name.includes("upload")) domains.add("media")
    if (name.includes("log") || name.includes("audit") || name.includes("event")) domains.add("analytics")
    if (name.includes("tenant") || name.includes("organization") || name.includes("team")) domains.add("multi-tenancy")
  }

  for (const ep of endpoints) {
    const path = ep.path.toLowerCase()
    if (path.includes("/auth") || path.includes("/login") || path.includes("/register")) domains.add("security")
    if (path.includes("/admin")) domains.add("administration")
    if (path.includes("/api/webhook")) domains.add("integration")
  }

  return [...domains]
}

function buildSummary(
  entities: DiscoveredEntity[],
  endpoints: DiscoveredEndpoint[],
  rules: DiscoveredBusinessRule[],
  architecture: DiscoveredArchitecture[],
  brownfield: BrownfieldAnalysis,
  purpose: "documentation" | "reverse_engineering",
): string {
  const lines: string[] = []

  if (purpose === "reverse_engineering") {
    lines.push("## Reverse Engineering Scan Complete")
    lines.push("")
    lines.push("Generated a **technology-agnostic** SDD from the existing codebase.")
    lines.push("The spec describes WHAT the system does, not HOW it's implemented.")
    lines.push("When using this SDD in a new project, the LLM will ask for technology choices.")
  } else {
    lines.push("## Documentation Scan Complete")
    lines.push("")
    lines.push("Generated an SDD documenting the existing system with its real tech stack.")
  }

  lines.push("")
  lines.push(`### Scan Results`)
  lines.push(`- **Entities discovered:** ${entities.length}`)
  lines.push(`- **Endpoints discovered:** ${endpoints.length}`)
  lines.push(`- **Business rules discovered:** ${rules.length}`)
  lines.push(`- **Architecture layers:** ${architecture.length}`)
  lines.push(`- **Total files scanned:** ${brownfield.structure.total_files}`)

  if (entities.length > 0) {
    lines.push("")
    lines.push("### Entities")
    for (const e of entities.slice(0, 15)) {
      lines.push(`- **${e.name}** (${e.fields.length} fields) — confidence: ${e.confidence}`)
    }
    if (entities.length > 15) lines.push(`- ... and ${entities.length - 15} more`)
  }

  if (endpoints.length > 0) {
    lines.push("")
    lines.push("### Endpoints")
    for (const ep of endpoints.slice(0, 15)) {
      lines.push(`- **${ep.method}** ${ep.path} — confidence: ${ep.confidence}`)
    }
    if (endpoints.length > 15) lines.push(`- ... and ${endpoints.length - 15} more`)
  }

  if (architecture.length > 0) {
    lines.push("")
    lines.push("### Architecture Layers")
    for (const a of architecture) {
      lines.push(`- **${a.name}** (${a.layer})`)
    }
  }

  return lines.join("\n")
}
