import type {
  KnowledgeGraph,
  EntityNode,
  FeatureNode,
  ArchitectureComponentNode,
  EndpointNode,
  DatabaseNode,
  TableNode,
  BusinessRuleNode,
} from "../domain/types.js"
import { getNodesByType } from "../graph/engine.js"
import { getExclusionSets, isNodeExcludedOrDeprecated } from "../drift/exclusion.js"
import { writeFileSync, mkdirSync, existsSync } from "fs"
import { join, dirname, resolve, relative } from "path"

export interface GeneratedFile {
  path: string
  content: string
  description: string
}

export interface GenerationPlan {
  files: GeneratedFile[]
  directories: string[]
  summary: string
}

export interface TechStack {
  frontend?: string
  backend?: string
  database?: string
  language?: string
  orm?: string
  testFramework?: string
}

export function detectTechStack(graph: KnowledgeGraph): TechStack {
  const archNodes = getNodesByType<ArchitectureComponentNode>(graph, "architecture_component")
  const dbNodes = getNodesByType<DatabaseNode>(graph, "database")

  const stack: TechStack = {}

  for (const arch of archNodes) {
    const tech = arch.metadata.technology?.toLowerCase() || ""
    const layer = arch.metadata.layer

    if (layer === "frontend") {
      if (tech.includes("react")) stack.frontend = "react"
      else if (tech.includes("vue")) stack.frontend = "vue"
      else if (tech.includes("angular")) stack.frontend = "angular"
      else if (tech.includes("svelte")) stack.frontend = "svelte"
      else stack.frontend = tech || undefined
    }

    if (layer === "backend") {
      if (tech.includes("express")) stack.backend = "express"
      else if (tech.includes("fastify")) stack.backend = "fastify"
      else if (tech.includes("nestjs")) stack.backend = "nestjs"
      else if (tech.includes("django")) stack.backend = "django"
      else if (tech.includes("fastapi")) stack.backend = "fastapi"
      else if (tech.includes("flask")) stack.backend = "flask"
      else if (tech.includes("rails")) stack.backend = "rails"
      else if (tech.includes("laravel")) stack.backend = "laravel"
      else if (tech.includes("gin")) stack.backend = "gin"
      else if (tech.includes("fiber")) stack.backend = "fiber"
      else if (tech.includes("actix") || tech.includes("axum")) stack.backend = "rust"
      else if (tech.includes("spring")) stack.backend = "spring"
      else stack.backend = tech || undefined
    }
  }

  for (const db of dbNodes) {
    const engine = db.metadata.engine?.toLowerCase() || ""
    if (engine.includes("postgres")) stack.database = "postgresql"
    else if (engine.includes("mysql")) stack.database = "mysql"
    else if (engine.includes("sqlite")) stack.database = "sqlite"
    else if (engine.includes("mongo")) stack.database = "mongodb"
    else if (engine.includes("redis")) stack.database = "redis"
    else stack.database = engine || undefined
  }

  return stack
}

const SUPPORTED_BACKENDS = new Set(["express", "fastify", "nestjs"])
const SUPPORTED_FRONTENDS = new Set(["react"])
const SUPPORTED_DATABASES = new Set(["sqlite", "postgresql", "mysql"])

export function hasCodegenSupport(stack: TechStack): boolean {
  return (
    !stack.backend || SUPPORTED_BACKENDS.has(stack.backend)
  ) && (
    !stack.frontend || SUPPORTED_FRONTENDS.has(stack.frontend)
  ) && (
    !stack.database || SUPPORTED_DATABASES.has(stack.database)
  )
}

export function generateProject(
  graph: KnowledgeGraph,
  stack?: TechStack,
): GenerationPlan {
  const detectedStack = stack || detectTechStack(graph)

  // If the stack is partially/fully unknown, return a spec prompt for the AI to generate
  if (!hasCodegenSupport(detectedStack)) {
    return generateSpecPrompt(graph, detectedStack)
  }

  const { removed, deprecated } = getExclusionSets(graph)
  const entities = getNodesByType<EntityNode>(graph, "entity")
    .filter((e) => !isNodeExcludedOrDeprecated(e.id, e.status, removed, deprecated))
  const features = getNodesByType<FeatureNode>(graph, "feature")
    .filter((f) => !isNodeExcludedOrDeprecated(f.id, f.status, removed, deprecated))
  const endpoints = getNodesByType<EndpointNode>(graph, "endpoint")
    .filter((e) => !isNodeExcludedOrDeprecated(e.id, e.status, removed, deprecated))
  const tables = getNodesByType<TableNode>(graph, "table")
    .filter((t) => !isNodeExcludedOrDeprecated(t.id, t.status, removed, deprecated))
  const businessRules = getNodesByType<BusinessRuleNode>(graph, "business_rule")
    .filter((b) => !isNodeExcludedOrDeprecated(b.id, b.status, removed, deprecated))

  const files: GeneratedFile[] = []
  const directories: Set<string> = new Set()

  // Generate backend
  if (detectedStack.backend === "express" || detectedStack.backend === "fastify") {
    generateExpressBackend(graph, entities, endpoints, tables, businessRules, files, directories, detectedStack)
  }

  // Generate frontend
  if (detectedStack.frontend === "react") {
    generateReactFrontend(graph, entities, features, endpoints, files, directories, detectedStack)
  }

  // Generate database schema
  generateDatabaseSchema(graph, entities, tables, files, directories, detectedStack)

  // Generate tests
  generateTests(graph, entities, endpoints, files, directories, detectedStack)

  // Generate shared types
  generateSharedTypes(graph, entities, files, directories, detectedStack)

  const dirList = [...directories].sort()

  return {
    files,
    directories: dirList,
    summary: buildGenerationSummary(graph, entities, features, files, detectedStack),
  }
}function generateSpecPrompt(graph: KnowledgeGraph, stack: TechStack): GenerationPlan {
  const entities = getNodesByType<EntityNode>(graph, "entity")
  const endpoints = getNodesByType<EndpointNode>(graph, "endpoint")
  const businessRules = getNodesByType<BusinessRuleNode>(graph, "business_rule")

  // ── Context-aware: gather decisions, constraints, architecture ──
  const decisions = graph.nodes.filter(n => n.type === "decision")
  const constraints = graph.nodes.filter(n => n.type === "constraint")
  const archComponents = graph.nodes.filter(n => n.type === "architecture_component")
  const constitution = graph.nodes.find(n => n.type === "constitution")

  const stackDesc = [
    stack.frontend && `Frontend: ${stack.frontend}`,
    stack.backend && `Backend: ${stack.backend}`,
    stack.database && `Database: ${stack.database}`,
    stack.language && `Language: ${stack.language}`,
  ].filter(Boolean).join(" | ") || "Unknown stack"

  const entityList = entities.map((e) => {
    const fields = (e.metadata.fields || []).map((f) => `  - ${f.name}: ${f.type}${f.required ? " (required)" : ""}`).join("\n")
    return `- **${e.name}**\n${fields}`
  }).join("\n")

  const endpointList = endpoints.map((ep) => {
    const meta = ep.metadata
    return `- \`${meta.method || "GET"} ${meta.path || ep.name}\` — ${ep.description || ep.name}`
  }).join("\n")

  const rulesList = businessRules.map((r) => `- **${r.name}:** ${r.description || r.metadata.rule_text || ""}`).join("\n")

  // Context sections
  const decisionsList = decisions.map((d) => {
    const meta = d.metadata as any
    return `- **${meta.title || d.name}:** ${meta.decision || d.description}`
  }).join("\n")

  const constraintsList = constraints.map((c) => {
    const meta = c.metadata as any
    return `- [${meta.constraint_type || "technical"}] ${meta.rule_text || c.description}`
  }).join("\n")

  const archList = archComponents.map((a) => {
    const meta = a.metadata as any
    return `- **${a.name}** (${meta.layer}): ${meta.technology || "unknown"} — ${a.description || ""}`
  }).join("\n")

  const principlesList = (() => {
    if (!constitution) return ""
    const meta = constitution.metadata as any
    if (!meta.principles) return ""
    return meta.principles.map((p: any) => `- [${p.severity}] ${p.rule}`).join("\n")
  })()

  const prompt = [
    `## Code Generation Prompt`,
    ``,
    `**Detected Stack:** ${stackDesc}`,
    `**Note:** The detected tech stack is not in the set of stacks with built-in templates.`,
    `Generate the project code using your knowledge of the specified technologies.`,
    ``,
    `### Entities`,
    entityList || "No entities defined.",
    ``,
    `### API Endpoints`,
    endpointList || "No endpoints defined.",
    ``,
    `### Business Rules`,
    rulesList || "No business rules defined.",
    ``,
  ]

  if (decisionsList) {
    prompt.push(`### Architecture Decisions (ADRs)`, decisionsList, ``)
  }
  if (constraintsList) {
    prompt.push(`### Constraints`, constraintsList, ``)
  }
  if (archList) {
    prompt.push(`### Architecture Components`, archList, ``)
  }
  if (principlesList) {
    prompt.push(`### Constitution (Mandatory Principles)`, principlesList, ``)
  }

  prompt.push(
    `### Instructions`,
    `Generate a complete project structure for a ${stackDesc} application.`,
    `Include:`,
    `1. Project configuration files (package.json, tsconfig, etc.)`,
    `2. Backend: routes, controllers/services, database access layer`,
    `3. Frontend: components, pages, state management`,
    `4. Database schema/migrations`,
    `5. Tests`,
    `6. README with setup instructions`,
    ``,
    `Follow the conventions and patterns commonly used with the specified technologies.`,
    `Use the entity fields and API endpoints above to generate the actual code.`,
  )

  if (decisionsList) {
    prompt.push(`Respect the architecture decisions listed above.`)
  }
  if (constraintsList) {
    prompt.push(`Apply all constraints listed above.`)
  }
  if (principlesList) {
    prompt.push(`Follow ALL constitution principles — they are mandatory.`)
  }

  return {
    files: [],
    directories: [],
    summary: prompt.join("\n"),
  }
}

function generateExpressBackend(
  _graph: KnowledgeGraph,
  entities: EntityNode[],
  _endpoints: EndpointNode[],
  _tables: TableNode[],
  _rules: BusinessRuleNode[],
  files: GeneratedFile[],
  dirs: Set<string>,
  _stack: TechStack,
): void {
  dirs.add("src/server")
  dirs.add("src/server/routes")
  dirs.add("src/server/controllers")
  dirs.add("src/server/services")
  dirs.add("src/server/repositories")
  dirs.add("src/server/middleware")
  dirs.add("src/server/models")

  // Server entry
  files.push({
    path: "src/server/index.ts",
    description: "Express server entry point",
    content: `import express from "express"
import cors from "cors"
import { router } from "./routes/index.js"

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

app.use("/api", router)

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`)
})
`,
  })

  // Routes index
  const routeImports = entities.map((e) => {
    const name = e.name.toLowerCase()
    return `import { ${name}Router } from "./${name}.js"`
  }).join("\n")

  const routeUses = entities.map((e) => {
    const name = e.name.toLowerCase()
    return `router.use("/${name}s", ${name}Router)`
  }).join("\n")

  files.push({
    path: "src/server/routes/index.ts",
    description: "Route aggregator",
    content: `import { Router } from "express"
${routeImports}

const router = Router()
${routeUses}

export { router }
`,
  })

  // Generate per-entity: model, repository, service, controller, routes
  for (const entity of entities) {
    const name = entity.name
    const nameLower = name.toLowerCase()
    const namePlural = `${nameLower}s`
    const fields = entity.metadata.fields || []

    // Model
    const modelFields = fields.map((f) => {
      const tsType = mapToTsType(f.type)
      const optional = f.required ? "" : "?"
      return `  ${f.name}${optional}: ${tsType}`
    }).join("\n")

    files.push({
      path: `src/server/models/${nameLower}.ts`,
      description: `${name} model/type definition`,
      content: `export interface ${name} {
  id: string
${modelFields}
  created_at: Date
  updated_at: Date
}

export type Create${name}Input = Omit<${name}, "id" | "created_at" | "updated_at">
export type Update${name}Input = Partial<Create${name}Input>
`,
    })

    // Repository
    files.push({
      path: `src/server/repositories/${nameLower}.repository.ts`,
      description: `${name} repository (database access)`,
      content: `import { db } from "../database.js"
import type { ${name}, Create${name}Input, Update${name}Input } from "../models/${nameLower}.js"

export const ${name}Repository = {
  async findAll(): Promise<${name}[]> {
    return db.select().from("${namePlural}")
  },

  async findById(id: string): Promise<${name} | undefined> {
    return db.select().from("${namePlural}").where({ id }).first()
  },

  async create(data: Create${name}Input): Promise<${name}> {
    const id = crypto.randomUUID()
    const now = new Date()
    await db.insert("${namePlural}").values({ id, ...data, created_at: now, updated_at: now })
    return { id, ...data, created_at: now, updated_at: now }
  },

  async update(id: string, data: Update${name}Input): Promise<${name} | undefined> {
    const existing = await this.findById(id)
    if (!existing) return undefined
    const updated = { ...existing, ...data, updated_at: new Date() }
    await db.update("${namePlural}").set(updated).where({ id })
    return updated
  },

  async delete(id: string): Promise<boolean> {
    const result = await db.delete("${namePlural}").where({ id })
    return result.changes > 0
  },
}
`,
    })

    // Service
    files.push({
      path: `src/server/services/${nameLower}.service.ts`,
      description: `${name} service (business logic)`,
      content: `import { ${name}Repository } from "../repositories/${nameLower}.repository.js"
import type { Create${name}Input, Update${name}Input } from "../models/${nameLower}.js"

export const ${name}Service = {
  async list() {
    return ${name}Repository.findAll()
  },

  async getById(id: string) {
    const item = await ${name}Repository.findById(id)
    if (!item) throw new Error("${name} not found")
    return item
  },

  async create(data: Create${name}Input) {
    return ${name}Repository.create(data)
  },

  async update(id: string, data: Update${name}Input) {
    const item = await ${name}Repository.update(id, data)
    if (!item) throw new Error("${name} not found")
    return item
  },

  async delete(id: string) {
    const deleted = await ${name}Repository.delete(id)
    if (!deleted) throw new Error("${name} not found")
  },
}
`,
    })

    // Controller
    files.push({
      path: `src/server/controllers/${nameLower}.controller.ts`,
      description: `${name} controller (HTTP handling)`,
      content: `import type { Request, Response } from "express"
import { ${name}Service } from "../services/${nameLower}.service.js"

export const ${name}Controller = {
  async list(_req: Request, res: Response) {
    try {
      const items = await ${name}Service.list()
      res.json(items)
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
  },

  async getById(req: Request, res: Response) {
    try {
      const item = await ${name}Service.getById(req.params.id)
      res.json(item)
    } catch (err) {
      res.status(404).json({ error: (err as Error).message })
    }
  },

  async create(req: Request, res: Response) {
    try {
      const item = await ${name}Service.create(req.body)
      res.status(201).json(item)
    } catch (err) {
      res.status(400).json({ error: (err as Error).message })
    }
  },

  async update(req: Request, res: Response) {
    try {
      const item = await ${name}Service.update(req.params.id, req.body)
      res.json(item)
    } catch (err) {
      res.status(400).json({ error: (err as Error).message })
    }
  },

  async remove(req: Request, res: Response) {
    try {
      await ${name}Service.delete(req.params.id)
      res.status(204).end()
    } catch (err) {
      res.status(404).json({ error: (err as Error).message })
    }
  },
}
`,
    })

    // Routes
    files.push({
      path: `src/server/routes/${nameLower}.ts`,
      description: `${name} routes`,
      content: `import { Router } from "express"
import { ${name}Controller } from "../controllers/${nameLower}.controller.js"

export const ${nameLower}Router = Router()

${nameLower}Router.get("/", ${name}Controller.list)
${nameLower}Router.get("/:id", ${name}Controller.getById)
${nameLower}Router.post("/", ${name}Controller.create)
${nameLower}Router.put("/:id", ${name}Controller.update)
${nameLower}Router.delete("/:id", ${name}Controller.remove)
`,
    })
  }
}

function generateReactFrontend(
  graph: KnowledgeGraph,
  entities: EntityNode[],
  _features: FeatureNode[],
  _endpoints: EndpointNode[],
  files: GeneratedFile[],
  dirs: Set<string>,
  _stack: TechStack,
): void {
  dirs.add("src/client")
  dirs.add("src/client/components")
  dirs.add("src/client/pages")
  dirs.add("src/client/hooks")
  dirs.add("src/client/services")

  // API client
  files.push({
    path: "src/client/services/api.ts",
    description: "API client",
    content: `const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000/api"

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(\`\${API_BASE}\${path}\`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  })
  if (!res.ok) throw new Error(await res.text())
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(data) }),
  put: <T>(path: string, data: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(data) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
}
`,
  })

  // Generate per-entity: hook, list component, form component, page
  for (const entity of entities) {
    const name = entity.name
    const nameLower = name.toLowerCase()
    const namePlural = `${nameLower}s`
    const fields = entity.metadata.fields || []

    // Hook
    const hookFields = fields.filter(f => f.name !== "id").map(f => {
      const tsType = mapToTsType(f.type)
      return `  ${f.name}: ${tsType}`
    }).join("\n")

    files.push({
      path: `src/client/hooks/use${name}.ts`,
      description: `${name} CRUD hook`,
      content: `import { useState, useEffect, useCallback } from "react"
import { api } from "../services/api.js"

export interface ${name} {
  id: string
${hookFields}
  created_at: string
  updated_at: string
}

export function use${namePlural.charAt(0).toUpperCase() + namePlural.slice(1)}() {
  const [items, setItems] = useState<${name}[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api.get<${name}[]>("/${namePlural}")
      setItems(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const create = async (data: Omit<${name}, "id" | "created_at" | "updated_at">) => {
    const item = await api.post<${name}>("/${namePlural}", data)
    setItems(prev => [...prev, item])
    return item
  }

  const update = async (id: string, data: Partial<Omit<${name}, "id">>) => {
    const item = await api.put<${name}>(\`/${namePlural}/\${id}\`, data)
    setItems(prev => prev.map(i => i.id === id ? item : i))
    return item
  }

  const remove = async (id: string) => {
    await api.delete(\`/${namePlural}/\${id}\`)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  return { items, loading, error, create, update, remove, refetch: fetchAll }
}
`,
    })

    // List component
    const tableHeaders = fields.slice(0, 5).map(f =>
      `              <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">${f.name}</th>`
    ).join("\n")

    const tableCells = fields.slice(0, 5).map(f =>
      `              <td className="px-4 py-2 text-sm text-gray-600">{item.${f.name}}</td>`
    ).join("\n")

    files.push({
      path: `src/client/components/${name}List.tsx`,
      description: `${name} list/table component`,
      content: `import type { ${name} } from "../hooks/use${name}.js"

interface ${name}ListProps {
  items: ${name}[]
  onEdit: (item: ${name}) => void
  onDelete: (id: string) => void
}

export function ${name}List({ items, onEdit, onDelete }: ${name}ListProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
${tableHeaders}
            <th className="px-4 py-2 text-right text-sm font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-gray-50">
${tableCells}
              <td className="px-4 py-2 text-right space-x-2">
                <button onClick={() => onEdit(item)} className="text-blue-600 hover:text-blue-800 text-sm">Edit</button>
                <button onClick={() => onDelete(item.id)} className="text-red-600 hover:text-red-800 text-sm">Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
`,
    })

    // Form component
    const formFields = fields.filter(f => f.name !== "id").map(f => {
      const inputType = f.type === "number" || f.type === "integer" || f.type === "float" ? "number" : "text"
      return `        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">${f.name}</label>
          <input
            type="${inputType}"
            name="${f.name}"
            defaultValue={initialValues?.${f.name} ?? ""}
            onChange={handleChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>`
    }).join("\n\n")

    files.push({
      path: `src/client/components/${name}Form.tsx`,
      description: `${name} form component`,
      content: `import { useState, type FormEvent, type ChangeEvent } from "react"
import type { ${name} } from "../hooks/use${name}.js"

interface ${name}FormProps {
  initialValues?: Partial<${name}>
  onSubmit: (data: Record<string, unknown>) => Promise<void>
  onCancel: () => void
}

export function ${name}Form({ initialValues, onSubmit, onCancel }: ${name}FormProps) {
  const [values, setValues] = useState<Record<string, unknown>>(initialValues || {})
  const [submitting, setSubmitting] = useState(false)

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setValues(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try { await onSubmit(values) } finally { setSubmitting(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 bg-white rounded-lg shadow">
${formFields}
      <div className="flex justify-end space-x-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-gray-600 hover:text-gray-800">Cancel</button>
        <button type="submit" disabled={submitting} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">
          {submitting ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  )
}
`,
    })

    // Page
    files.push({
      path: `src/client/pages/${name}Page.tsx`,
      description: `${name} page (full CRUD)`,
      content: `import { useState } from "react"
import { use${namePlural.charAt(0).toUpperCase() + namePlural.slice(1)} } from "../hooks/use${name}.js"
import { ${name}List } from "../components/${name}List.js"
import { ${name}Form } from "../components/${name}Form.js"
import type { ${name} } from "../hooks/use${name}.js"

export function ${name}Page() {
  const { items, loading, error, create, update, remove } = use${namePlural.charAt(0).toUpperCase() + namePlural.slice(1)}()
  const [editing, setEditing] = useState<${name} | null>(null)
  const [showForm, setShowForm] = useState(false)

  const handleCreate = async (data: Record<string, unknown>) => {
    await create(data as any)
    setShowForm(false)
  }

  const handleUpdate = async (data: Record<string, unknown>) => {
    if (editing) {
      await update(editing.id, data as any)
      setEditing(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure?")) await remove(id)
  }

  if (loading) return <div className="p-8 text-center">Loading...</div>
  if (error) return <div className="p-8 text-center text-red-600">Error: {error}</div>

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">${name}</h1>
        <button onClick={() => { setEditing(null); setShowForm(true) }} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
          Add ${name}
        </button>
      </div>

      {showForm && (
        <${name}Form onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
      )}

      {editing && (
        <${name}Form initialValues={editing} onSubmit={handleUpdate} onCancel={() => setEditing(null)} />
      )}

      <${name}List items={items} onEdit={(item) => { setEditing(item); setShowForm(false) }} onDelete={handleDelete} />
    </div>
  )
}
`,
    })
  }

  // App.tsx
  const pageImports = entities.map(e =>
    `import { ${e.name}Page } from "./pages/${e.name}Page.js"`
  ).join("\n")

  const pageRoutes = entities.map(e => {
    const nameLower = e.name.toLowerCase()
    const namePlural = `${nameLower}s`
    return `          <Route path="/${namePlural}" element={<${e.name}Page />} />`
  }).join("\n")

  files.push({
    path: "src/client/App.tsx",
    description: "Main App component with routing",
    content: `import { BrowserRouter, Routes, Route, Link } from "react-router-dom"
${pageImports}

function Home() {
  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">${graph.project_id}</h1>
      <nav className="space-y-2">
${entities.map(e => `        <Link to="/${e.name.toLowerCase()}s" className="block text-blue-600 hover:underline">${e.name}</Link>`).join("\n")}
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-100">
        <nav className="bg-white shadow-sm">
          <div className="max-w-6xl mx-auto px-4 py-3">
            <Link to="/" className="text-lg font-bold text-gray-900">${graph.project_id}</Link>
          </div>
        </nav>
        <Routes>
          <Route path="/" element={<Home />} />
${pageRoutes}
        </Routes>
      </div>
    </BrowserRouter>
  )
}
`,
  })
}

function generateDatabaseSchema(
  _graph: KnowledgeGraph,
  entities: EntityNode[],
  _tables: TableNode[],
  files: GeneratedFile[],
  dirs: Set<string>,
  stack: TechStack,
): void {
  dirs.add("src/server")

  if (stack.database === "sqlite" || stack.database === "postgresql" || stack.database === "mysql") {
    const createStatements = entities.map(entity => {
      const name = entity.name.toLowerCase()
      const namePlural = `${name}s`
      const fields = entity.metadata.fields || []

      const columns = [
        "  id TEXT PRIMARY KEY",
        ...fields.map(f => {
          const colType = mapToSqlType(f.type)
          const nullable = f.required ? " NOT NULL" : ""
          const unique = f.unique ? " UNIQUE" : ""
          return `  ${f.name} ${colType}${nullable}${unique}`
        }),
        "  created_at TEXT NOT NULL",
        "  updated_at TEXT NOT NULL",
      ]

      return `CREATE TABLE IF NOT EXISTS ${namePlural} (\n${columns.join(",\n")}\n);`
    })

    files.push({
      path: "src/server/schema.sql",
      description: "Database schema",
      content: createStatements.join("\n\n") + "\n",
    })

    // Database connection - built as array to avoid template literal nesting
    if (stack.database === "sqlite") {
      const dbLines: string[] = [
        'import Database from "bun:sqlite"',
        "",
        'const sqlite = new Database(":memory:")',
        "",
        "export const db = {",
        "  select() {",
        "    return {",
        "      from: (table: string) => ({",
        "        where: (conditions: Record<string, unknown>) => ({",
        "          first: () => {",
        "            const keys = Object.keys(conditions)",
        "            const vals = Object.values(conditions)",
        '            const placeholders = keys.map(k => k + " = ?").join(" AND ")',
        "            const stmt = sqlite.prepare(`SELECT * FROM ${" + "table" + "} WHERE ${" + "placeholders" + "}`)",
        "            return stmt.get(...vals) as any",
        "          },",
        "        }),",
        "        all: () => sqlite.prepare(`SELECT * FROM ${" + "table" + "}`).all() as any[],",
        "      }),",
        "    }",
        "  },",
        "",
        "  insert(table: string) {",
        "    return {",
        "      values: (data: Record<string, unknown>) => {",
        "        const keys = Object.keys(data)",
        "        const vals = Object.values(data)",
        '        const placeholders = keys.map(() => "?").join(", ")',
        "        const stmt = sqlite.prepare(`INSERT INTO ${" + "table" + "} (${" + "keys.join(', ')" + "}) VALUES (${" + "placeholders" + "}`)",
        "        return stmt.run(...vals)",
        "      },",
        "    }",
        "  },",
        "",
        "  update(table: string) {",
        "    return {",
        "      set: (data: Record<string, unknown>) => ({",
        "        where: (conditions: Record<string, unknown>) => {",
        "          const setKeys = Object.keys(data)",
        "          const setVals = Object.values(data)",
        "          const whereKeys = Object.keys(conditions)",
        "          const whereVals = Object.values(conditions)",
        '          const setClause = setKeys.map(k => k + " = ?").join(", ")',
        '          const whereClause = whereKeys.map(k => k + " = ?").join(" AND ")',
        "          const stmt = sqlite.prepare(`UPDATE ${" + "table" + "} SET ${" + "setClause" + "} WHERE ${" + "whereClause" + "}`)",
        "          return stmt.run(...setVals, ...whereVals)",
        "        },",
        "      }),",
        "    }",
        "  },",
        "",
        "  delete(table: string) {",
        "    return {",
        "      where: (conditions: Record<string, unknown>) => {",
        "        const keys = Object.keys(conditions)",
        "        const vals = Object.values(conditions)",
        '        const placeholders = keys.map(k => k + " = ?").join(" AND ")',
        "        const stmt = sqlite.prepare(`DELETE FROM ${" + "table" + "} WHERE ${" + "placeholders" + "}`)",
        "        return { changes: stmt.run(...vals).changes }",
        "      },",
        "    }",
        "  },",
        "}",
        "",
        "}",
      ]
      files.push({
        path: "src/server/database.ts",
        description: "SQLite database connection",
        content: dbLines.join("\n"),
      })
    }
  }
}

function generateTests(
  _graph: KnowledgeGraph,
  entities: EntityNode[],
  _endpoints: EndpointNode[],
  files: GeneratedFile[],
  dirs: Set<string>,
  _stack: TechStack,
): void {
  dirs.add("tests")

  for (const entity of entities) {
    const name = entity.name
    const nameLower = name.toLowerCase()
    const namePlural = `${nameLower}s`

    files.push({
      path: `tests/${nameLower}.test.ts`,
      description: `${name} API tests`,
      content: `import { describe, test, expect, beforeAll, afterAll } from "bun:test"

const API = "http://localhost:3000/api"

describe("${name} API", () => {
  let createdId: string

  test("POST /${namePlural} - creates ${nameLower}", async () => {
    const res = await fetch(\`\${API}/${namePlural}\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.id).toBeDefined()
    createdId = data.id
  })

  test("GET /${namePlural} - lists ${namePlural}", async () => {
    const res = await fetch(\`\${API}/${namePlural}\`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data)).toBe(true)
  })

  test("GET /${namePlural}/:id - gets ${nameLower}", async () => {
    const res = await fetch(\`\${API}/${namePlural}/\${createdId}\`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.id).toBe(createdId)
  })

  test("PUT /${namePlural}/:id - updates ${nameLower}", async () => {
    const res = await fetch(\`\${API}/${namePlural}/\${createdId}\`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
  })

  test("DELETE /${namePlural}/:id - deletes ${nameLower}", async () => {
    const res = await fetch(\`\${API}/${namePlural}/\${createdId}\`, {
      method: "DELETE",
    })
    expect(res.status).toBe(204)
  })

  test("GET /${namePlural}/:id - returns 404 for deleted", async () => {
    const res = await fetch(\`\${API}/${namePlural}/\${createdId}\`)
    expect(res.status).toBe(404)
  })
})
`,
    })
  }
}

function generateSharedTypes(
  _graph: KnowledgeGraph,
  entities: EntityNode[],
  files: GeneratedFile[],
  dirs: Set<string>,
  _stack: TechStack,
): void {
  dirs.add("src/shared")

  const typeDefs = entities.map(entity => {
    const fields = entity.metadata.fields || []
    const fieldDefs = fields.map(f => `  ${f.name}: ${mapToTsType(f.type)}`).join("\n")
    return `export interface ${entity.name} {
  id: string
${fieldDefs}
  created_at: string
  updated_at: string
}`
  })

  files.push({
    path: "src/shared/types.ts",
    description: "Shared type definitions",
    content: typeDefs.join("\n\n") + "\n",
  })
}

function mapToTsType(fieldType: string): string {
  const lower = fieldType.toLowerCase()
  if (lower === "string" || lower === "text" || lower === "varchar") return "string"
  if (lower === "number" || lower === "integer" || lower === "int" || lower === "float" || lower === "decimal") return "number"
  if (lower === "boolean" || lower === "bool") return "boolean"
  if (lower === "date" || lower === "timestamp" || lower === "datetime") return "string"
  if (lower === "json" || lower === "object") return "Record<string, unknown>"
  if (lower === "uuid") return "string"
  return "string"
}

function mapToSqlType(fieldType: string): string {
  const lower = fieldType.toLowerCase()
  if (lower === "string" || lower === "text" || lower === "varchar") return "TEXT"
  if (lower === "number" || lower === "integer" || lower === "int") return "INTEGER"
  if (lower === "float" || lower === "decimal") return "REAL"
  if (lower === "boolean" || lower === "bool") return "INTEGER"
  if (lower === "date" || lower === "timestamp" || lower === "datetime") return "TEXT"
  if (lower === "json" || lower === "object") return "TEXT"
  if (lower === "uuid") return "TEXT"
  return "TEXT"
}

function buildGenerationSummary(
  graph: KnowledgeGraph,
  entities: EntityNode[],
  features: FeatureNode[],
  files: GeneratedFile[],
  stack: TechStack,
): string {
  const lines = [
    "## Code Generation Summary",
    "",
    `**Project:** ${graph.project_id}`,
    `**Stack:** ${stack.language} | ${stack.frontend} | ${stack.backend} | ${stack.database}`,
    "",
    "### Generated",
    `- ${files.length} files`,
    `- ${entities.length} entities`,
    `- ${features.length} features`,
    "",
    "### Files",
  ]

  for (const f of files) {
    lines.push(`- \`${f.path}\` — ${f.description}`)
  }

  return lines.join("\n")
}

export interface GeneratedWriteOptions {
  /** Existing files are never replaced unless the approved caller opts in. */
  overwrite?: boolean
  /** Save a recoverable copy before an approved replacement. */
  backup?: boolean
}

export interface GeneratedWriteResult {
  written: number
  created: number
  unchanged: number
  conflicts: string[]
  backups: string[]
  errors: string[]
}

/**
 * Materialize a plan without silently destroying brownfield code.  The caller
 * receives all conflicts and must explicitly request overwrite after review.
 */
export function writeGeneratedFiles(
  projectDir: string,
  plan: GenerationPlan,
  options: GeneratedWriteOptions = {},
): GeneratedWriteResult {
  let written = 0
  let created = 0
  let unchanged = 0
  const conflicts: string[] = []
  const backups: string[] = []
  const errors: string[] = []

  for (const dir of plan.directories) {
    const fullPath = resolve(projectDir, dir)
    if (relative(projectDir, fullPath).startsWith("..")) {
      errors.push(`Refusing to create directory outside target: ${dir}`)
      continue
    }
    if (!existsSync(fullPath)) {
      try {
        mkdirSync(fullPath, { recursive: true })
      } catch (e) {
        errors.push(`Failed to create directory ${dir}: ${e}`)
      }
    }
  }

  for (const file of plan.files) {
    const fullPath = resolve(projectDir, file.path)
    try {
      if (relative(projectDir, fullPath).startsWith("..")) {
        errors.push(`Refusing to write outside target: ${file.path}`)
        continue
      }
      const dir = dirname(fullPath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      if (existsSync(fullPath)) {
        const current = require("fs").readFileSync(fullPath, "utf-8")
        if (current === file.content) {
          unchanged++
          continue
        }
        if (!options.overwrite) {
          conflicts.push(file.path)
          continue
        }
        if (options.backup !== false) {
          const backupPath = `${fullPath}.opencode-telos-backup-${Date.now()}`
          writeFileSync(backupPath, current, "utf-8")
          backups.push(backupPath)
        }
      } else {
        created++
      }
      writeFileSync(fullPath, file.content, "utf-8")
      written++
    } catch (e) {
      errors.push(`Failed to write ${file.path}: ${e}`)
    }
  }

  return { written, created, unchanged, conflicts, backups, errors }
}
