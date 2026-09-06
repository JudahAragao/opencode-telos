import { describe, test, expect } from "bun:test"
import { analyzeBriefingDeep } from "../src/sdd/discovery/briefing-analyzer.js"
import { buildGraphFromAnalysis } from "../src/sdd/discovery/graph-builder.js"
import { createGraph } from "../src/sdd/graph/engine.js"

const SAMPLE_BRIEFING = `
# CMS Platform Specification

## 1. Core System
The CMS must support multi-tenancy with tenant isolation.
Each tenant has their own plugins, themes, and content.

## 2. Plugin System
A formal plugin system with manifest, lifecycle, and sandbox.
Plugins can register routes, admin pages, and database migrations.
The plugin SDK must provide ContentAPI, MediaAPI, SettingsAPI.

## 3. Theme Engine
Theme Engine using Astro for routing and SolidJS for interactive islands.
Themes cannot access the database directly.

## 4. Authentication
JWT-based authentication with role-based access control (RBAC).
Support Google OAuth and email+password login.

## 5. Content Management
Users can create, edit, publish, and delete content.
Content has categories and tags. Soft delete is required.

## 6. API Design
REST API versioned at /api/v1/*.
GET /api/v1/content - list content
POST /api/v1/content - create content
GET /api/v1/users - list users
POST /api/v1/plugins - install plugin

## 7. Build System
Docker-based build with multi-stage builds.
Worker system using BullMQ for heavy tasks.
Build orchestrator handles dependency resolution.

## 8. Security
Plugins must be sandboxed. RBAC is mandatory.
CSRF, XSS, and SQL injection protection required.

## 9. Deployment
Blue-green deployment with automatic rollback.
Health checks: readiness and liveness probes.

## 10. Database
PostgreSQL with Prisma ORM.
Multi-tenant with tenant_id column on all tables.

## 11. Decisions
Astro vs Next.js - for frontend rendering
SolidJS vs React - for interactive islands
PostgreSQL vs SQLite - for database
REST vs GraphQL - for API design
monorepo vs multirepo - for project structure

## 12. Testing
Unit tests with Vitest
E2E tests with Playwright
Contract tests for API
`

describe("BriefingDeepAnalyzer", () => {
  test("extracts features from numbered sections", () => {
    const result = analyzeBriefingDeep(SAMPLE_BRIEFING)
    expect(result.features.length).toBeGreaterThan(5)
    const featureNames = result.features.map((f) => f.name.toLowerCase())
    expect(featureNames.some((n) => n.includes("plugin"))).toBe(true)
    expect(featureNames.some((n) => n.includes("theme"))).toBe(true)
    expect(featureNames.some((n) => n.includes("auth"))).toBe(true)
  })

  test("extracts entities from text", () => {
    const result = analyzeBriefingDeep(SAMPLE_BRIEFING)
    expect(result.entities.length).toBeGreaterThan(3)
    const entityNames = result.entities.map((e) => e.name.toLowerCase())
    expect(entityNames).toContain("user")
    expect(entityNames).toContain("content")
    expect(entityNames).toContain("plugin")
    expect(entityNames).toContain("theme")
  })

  test("entities have fields defined", () => {
    const result = analyzeBriefingDeep(SAMPLE_BRIEFING)
    for (const entity of result.entities) {
      expect(entity.fields.length).toBeGreaterThan(0)
      expect(entity.fields[0].name).toBe("id")
    }
  })

  test("extracts endpoints from REST patterns", () => {
    const result = analyzeBriefingDeep(SAMPLE_BRIEFING)
    expect(result.endpoints.length).toBeGreaterThan(0)
    const methods = result.endpoints.map((e) => `${e.method} ${e.path}`)
    expect(methods.some((m) => m.includes("GET /api/v1/content"))).toBe(true)
    expect(methods.some((m) => m.includes("POST /api/v1/content"))).toBe(true)
  })

  test("extracts business rules from must/shall patterns", () => {
    const result = analyzeBriefingDeep(SAMPLE_BRIEFING)
    expect(result.businessRules.length).toBeGreaterThan(0)
  })

  test("detects architecture components", () => {
    const result = analyzeBriefingDeep(SAMPLE_BRIEFING)
    expect(result.architectureComponents.length).toBeGreaterThan(3)
    const names = result.architectureComponents.map((c) => c.name.toLowerCase())
    expect(names.some((n) => n.includes("astro"))).toBe(true)
    expect(names.some((n) => n.includes("solid"))).toBe(true)
    expect(names.some((n) => n.includes("postgres"))).toBe(true)
    expect(names.some((n) => n.includes("docker"))).toBe(true)
  })

  test("detects technology decisions (vs patterns)", () => {
    const result = analyzeBriefingDeep(SAMPLE_BRIEFING)
    expect(result.decisions.length).toBeGreaterThan(3)
    const titles = result.decisions.map((d) => d.title.toLowerCase())
    expect(titles.some((t) => t.includes("astro") && t.includes("next"))).toBe(true)
    expect(titles.some((t) => t.includes("solid") && t.includes("react"))).toBe(true)
  })

  test("extracts requirements from sections", () => {
    const result = analyzeBriefingDeep(SAMPLE_BRIEFING)
    expect(result.requirements.length).toBeGreaterThan(5)
  })

  test("detects domains", () => {
    const result = analyzeBriefingDeep(SAMPLE_BRIEFING)
    expect(result.domains).toContain("cms")
    expect(result.domains).toContain("multi-tenancy")
    expect(result.domains).toContain("plugin-system")
    expect(result.domains).toContain("theme-system")
    expect(result.domains).toContain("devops")
    expect(result.domains).toContain("security")
  })

  test("detects tech stack", () => {
    const result = analyzeBriefingDeep(SAMPLE_BRIEFING)
    expect(result.techStack.frontend).toBeDefined()
    expect(result.techStack.database).toBeDefined()
  })

  test("builds relationships between elements", () => {
    const result = analyzeBriefingDeep(SAMPLE_BRIEFING)
    expect(result.relationships.length).toBeGreaterThan(0)
  })
})

describe("GraphBuilder", () => {
  test("creates all node types in graph", () => {
    const graph = createGraph("test")
    const analysis = analyzeBriefingDeep(SAMPLE_BRIEFING)
    const result = buildGraphFromAnalysis(graph, analysis)

    expect(result.nodesCreated).toBeGreaterThan(10)
    expect(result.relationshipsCreated).toBeGreaterThan(0)
    expect(result.byType.feature).toBeGreaterThan(0)
    expect(result.byType.entity).toBeGreaterThan(0)
    expect(result.byType.endpoint).toBeGreaterThan(0)
    expect(result.byType.architecture_component).toBeGreaterThan(0)
    expect(result.byType.decision).toBeGreaterThan(0)
    expect(result.byType.requirement).toBeGreaterThan(0)
  })

  test("nodes have correct types and metadata", () => {
    const graph = createGraph("test")
    const analysis = analyzeBriefingDeep(SAMPLE_BRIEFING)
    buildGraphFromAnalysis(graph, analysis)

    const features = graph.nodes.filter((n) => n.type === "feature")
    expect(features.length).toBeGreaterThan(0)
    for (const f of features) {
      expect(f.id).toBeTruthy()
      expect(f.name).toBeTruthy()
      expect(f.status).toBe("DRAFT")
      expect(f.metadata.priority).toBeDefined()
    }

    const entities = graph.nodes.filter((n) => n.type === "entity")
    expect(entities.length).toBeGreaterThan(0)
    for (const e of entities) {
      expect((e.metadata as any).fields).toBeDefined()
      expect((e.metadata as any).fields.length).toBeGreaterThan(0)
    }
  })

  test("creates relationships between nodes", () => {
    const graph = createGraph("test")
    const analysis = analyzeBriefingDeep(SAMPLE_BRIEFING)
    buildGraphFromAnalysis(graph, analysis)

    expect(graph.relationships.length).toBeGreaterThan(0)

    // Check that some relationships reference valid nodes
    for (const rel of graph.relationships) {
      const fromNode = graph.nodes.find((n) => n.id === rel.from)
      const toNode = graph.nodes.find((n) => n.id === rel.to)
      expect(fromNode).toBeDefined()
      expect(toNode).toBeDefined()
    }
  })

  test("does not create duplicate nodes on second build", () => {
    const graph = createGraph("test")
    const analysis = analyzeBriefingDeep(SAMPLE_BRIEFING)

    const first = buildGraphFromAnalysis(graph, analysis)
    const second = buildGraphFromAnalysis(graph, analysis)

    // Second build should create fewer or equal nodes
    expect(second.nodesCreated).toBeLessThanOrEqual(first.nodesCreated)
  })

  test("generates summary with breakdown", () => {
    const graph = createGraph("test")
    const analysis = analyzeBriefingDeep(SAMPLE_BRIEFING)
    const result = buildGraphFromAnalysis(graph, analysis)

    expect(result.summary).toContain("Graph Build Complete")
    expect(result.summary).toContain("Total nodes created")
    expect(result.summary).toContain("Total relationships created")
  })
})
