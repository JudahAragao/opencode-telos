import type { KnowledgeGraph, GapClassification } from "../domain/types.js"
import { addNode } from "../graph/engine.js"

export interface BriefingAnalysis {
  known_facts: Record<string, string>
  missing_information: MissingInfo[]
  ambiguities: string[]
  contradictions: string[]
  inferred_entities: string[]
  inferred_architecture: string[]
  inferred_auth: string | null
  domain_detected: string | null
  tech_stack: DetectedTechStack
  file_references: FileReference[]
}

/**
 * Options for controlling briefing analysis scope.
 */
export interface BriefingAnalysisOptions {
  /** Only run these detection categories (e.g., ["tech", "domain", "entity"]). */
  focusCategories?: string[]
  /** Skip these detection categories. */
  excludeCategories?: string[]
  /** Skip these specific entity patterns. */
  excludeEntities?: string[]
  /** Skip these specific domain patterns. */
  excludeDomains?: string[]
  /** Additional entity patterns to detect. */
  customEntities?: Array<{ pattern: string; name: string }>
  /** Additional domain patterns to detect. */
  customDomains?: Array<{ name: string; pattern: string }>
  /** Cache for analysis results (briefing_hash → result). */
  analysisCache?: Map<string, { result: BriefingAnalysis; timestamp: number }>
  /** Hash of the briefing text to check cache validity. */
  briefingHash?: string
}

export interface DetectedTechStack {
  frontend: string | null
  backend: string | null
  database: string | null
  auth: string | null
  language: string | null
  testing: string | null
  other: string[]
}

export interface FileReference {
  path: string
  context: string
}

export interface MissingInfo {
  category: string
  description: string
  classification: GapClassification
  already_answered: boolean
  question_for_user: QuestionForUser | null
}

export interface QuestionForUser {
  question: string
  header: string
  options: Array<{ label: string; description: string }>
  multiple?: boolean
}

export interface DiscoveryResult {
  analysis: BriefingAnalysis
  questions_for_agent: QuestionForUser[]
  sufficient: boolean
  summary: string
  update_commands: UpdateCommand[]
}

export interface UpdateCommand {
  type: "add_node" | "add_relationship" | "update_node"
  node_type?: string
  node_name?: string
  metadata?: Record<string, unknown>
  from?: string
  to?: string
  relationship_type?: string
}

export function analyzeBriefing(
  briefing: string,
  options?: BriefingAnalysisOptions,
): BriefingAnalysis {
  // Check cache first
  if (options?.analysisCache && options.briefingHash) {
    const cached = options.analysisCache.get(options.briefingHash)
    if (cached && (Date.now() - cached.timestamp) < 300000) { // 5 min cache
      return cached.result
    }
  }

  const analysis: BriefingAnalysis = {
    known_facts: {},
    missing_information: [],
    ambiguities: [],
    contradictions: [],
    inferred_entities: [],
    inferred_architecture: [],
    inferred_auth: null,
    domain_detected: null,
    tech_stack: { frontend: null, backend: null, database: null, auth: null, language: null, testing: null, other: [] },
    file_references: [],
  }

  const shouldDetect = (category: string) => {
    if (options?.excludeCategories?.includes(category)) return false
    if (options?.focusCategories?.length && !options.focusCategories.includes(category)) return false
    return true
  }

  // Extract @ file references
  const fileRefPattern = /@([\w\-\.\/]+\.\w+)/g
  let match: RegExpExecArray | null
  while ((match = fileRefPattern.exec(briefing)) !== null) {
    analysis.file_references.push({ path: match[1], context: extractContextAround(briefing, match.index) })
  }

  // Detect tech stack - comprehensive patterns
  const techDetections: Array<{ key: string; patterns: RegExp[]; category: keyof DetectedTechStack }> = [
    // Frontend
    { key: "React", patterns: [/react/i], category: "frontend" },
    { key: "Vue", patterns: [/vue(\.js|js)/i], category: "frontend" },
    { key: "Angular", patterns: [/angular/i], category: "frontend" },
    { key: "Svelte", patterns: [/svelte/i], category: "frontend" },
    { key: "Next.js", patterns: [/next\.?js/i], category: "frontend" },
    { key: "Nuxt", patterns: [/nuxt/i], category: "frontend" },
    { key: "HTML/CSS/JS", patterns: [/html.*css|vanilla.*js|puro.*js|plain.*js/i], category: "frontend" },
    { key: "Tailwind", patterns: [/tailwind/i], category: "frontend" },
    { key: "Chakra UI", patterns: [/chakra/i], category: "frontend" },
    { key: "Material UI", patterns: [/material[\s-]?ui|mui/i], category: "frontend" },
    { key: "shadcn/ui", patterns: [/shadcn/i], category: "frontend" },

    // Backend
    { key: "Express", patterns: [/express/i], category: "backend" },
    { key: "Fastify", patterns: [/fastify/i], category: "backend" },
    { key: "NestJS", patterns: [/nestjs/i], category: "backend" },
    { key: "Koa", patterns: [/koa/i], category: "backend" },
    { key: "Hono", patterns: [/hono/i], category: "backend" },
    { key: "Django", patterns: [/django/i], category: "backend" },
    { key: "Flask", patterns: [/flask/i], category: "backend" },
    { key: "FastAPI", patterns: [/fastapi/i], category: "backend" },
    { key: "Rails", patterns: [/rails|ruby on rails/i], category: "backend" },
    { key: "Laravel", patterns: [/laravel/i], category: "backend" },
    { key: "Spring Boot", patterns: [/spring[\s-]?boot/i], category: "backend" },
    { key: "Go stdlib", patterns: [/go\s+stdlib|net\/http/i], category: "backend" },
    { key: "Gin", patterns: [/gin\b/i], category: "backend" },
    { key: "Fiber", patterns: [/fiber/i], category: "backend" },
    { key: "Rust Actix", patterns: [/actix/i], category: "backend" },
    { key: "Rust Axum", patterns: [/axum/i], category: "backend" },

    // Database
    { key: "PostgreSQL", patterns: [/postgres(ql)?/i], category: "database" },
    { key: "MySQL", patterns: [/mysql/i], category: "database" },
    { key: "SQLite", patterns: [/sqlite/i], category: "database" },
    { key: "MongoDB", patterns: [/mongo(db)?/i], category: "database" },
    { key: "Redis", patterns: [/redis/i], category: "database" },
    { key: "Supabase", patterns: [/supabase/i], category: "database" },
    { key: "Firebase", patterns: [/firebase/i], category: "database" },
    { key: "PlanetScale", patterns: [/planetscale/i], category: "database" },
    { key: "Turso", patterns: [/turso/i], category: "database" },
    { key: "DynamoDB", patterns: [/dynamo(db)?/i], category: "database" },

    // Auth
    { key: "JWT", patterns: [/jwt/i], category: "auth" },
    { key: "Google OAuth", patterns: [/google\s*oauth|google\s*auth/i], category: "auth" },
    { key: "GitHub OAuth", patterns: [/github\s*oauth|github\s*auth/i], category: "auth" },
    { key: "Session/Cookie", patterns: [/session|cookie/i], category: "auth" },
    { key: "Clerk", patterns: [/clerk/i], category: "auth" },
    { key: "Auth0", patterns: [/auth0/i], category: "auth" },
    { key: "NextAuth", patterns: [/nextauth|next[\s-]?auth/i], category: "auth" },
    { key: "Lucia", patterns: [/lucia/i], category: "auth" },

    // Language
    { key: "TypeScript", patterns: [/typescript|\.ts\b/i], category: "language" },
    { key: "JavaScript", patterns: [/javascript|\.js\b(?!on)/i], category: "language" },
    { key: "Python", patterns: [/python/i], category: "language" },
    { key: "Go", patterns: [/\bgo\b(?!lang)/i], category: "language" },
    { key: "Rust", patterns: [/rust/i], category: "language" },
    { key: "Java", patterns: [/java(?!script)/i], category: "language" },
    { key: "Ruby", patterns: [/ruby/i], category: "language" },

    // Testing
    { key: "Jest", patterns: [/jest/i], category: "testing" },
    { key: "Vitest", patterns: [/vitest/i], category: "testing" },
    { key: "Bun test", patterns: [/bun\s*test/i], category: "testing" },
    { key: "Cypress", patterns: [/cypress/i], category: "testing" },
    { key: "Playwright", patterns: [/playwright/i], category: "testing" },
    { key: "pytest", patterns: [/pytest/i], category: "testing" },
    { key: "RSpec", patterns: [/rspec/i], category: "testing" },
  ]

  for (const detection of techDetections) {
    for (const pattern of detection.patterns) {
      if (pattern.test(briefing)) {
        if (detection.category === "other") {
          analysis.tech_stack.other.push(detection.key)
        } else {
          const stack = analysis.tech_stack as unknown as Record<string, string | null>
          const current = stack[detection.category]
          if (!current) {
            stack[detection.category] = detection.key
          } else {
            analysis.tech_stack.other.push(detection.key)
          }
        }
        analysis.known_facts[`tech_${detection.category}`] = detection.key
        break
      }
    }
  }

  // Detect auth patterns (backward compat)
  if (analysis.tech_stack.auth) {
    analysis.inferred_auth = analysis.tech_stack.auth.toLowerCase()
  } else if (/login|auth|autenticação/i.test(briefing)) {
    analysis.known_facts["auth_mentioned"] = "true"
  }

  // Detect multi-tenancy
  if (/multi.?tenant/i.test(briefing)) {
    analysis.known_facts["multi_tenant"] = "true"
  }

  // Detect entities
  if (shouldDetect("entity")) {
    const entityPatterns: Array<{ pattern: RegExp; name: string }> = [
      { pattern: /(?:usuários?|users?)\b/i, name: "User" },
      { pattern: /(?:tarefas?|todos?|tasks?)\b/i, name: "Todo" },
      { pattern: /(?:produtos?|products?)\b/i, name: "Product" },
      { pattern: /(?:pedidos?|orders?)\b/i, name: "Order" },
      { pattern: /(?:clientes?|customers?)\b/i, name: "Customer" },
      { pattern: /(?:categorias?|categories?)\b/i, name: "Category" },
      { pattern: /(?:projetos?|projects?)\b/i, name: "Project" },
      { pattern: /(?:artigos?|posts?|articles?)\b/i, name: "Post" },
      { pattern: /(?:páginas?|pages?)\b/i, name: "Page" },
      { pattern: /(?:comentários?|comments?)\b/i, name: "Comment" },
      { pattern: /(?:roles?|papéis?)\b/i, name: "Role" },
      { pattern: /(?:planos?|plans?)\b/i, name: "Plan" },
      { pattern: /(?:pagamentos?|payments?)\b/i, name: "Payment" },
      { pattern: /(?:notificações?|notifications?)\b/i, name: "Notification" },
      { pattern: /(?:mensagens?|messages?)\b/i, name: "Message" },
      { pattern: /(?:chat|conversas?)\b/i, name: "Chat" },
      { pattern: /(?:arquivos?|files?)\b/i, name: "File" },
      { pattern: /(?:equipes?|teams?)\b/i, name: "Team" },
      { pattern: /(?:organizações?|organizations?)\b/i, name: "Organization" },
      // Custom entities from options
      ...(options?.customEntities?.map(c => ({ pattern: new RegExp(c.pattern, 'i'), name: c.name })) || []),
    ]

    const excludeEntitySet = new Set(options?.excludeEntities || [])
    for (const { pattern, name } of entityPatterns) {
      if (pattern.test(briefing) && !analysis.inferred_entities.includes(name) && !excludeEntitySet.has(name)) {
        analysis.inferred_entities.push(name)
      }
    }
  }

  // Detect domain
  if (shouldDetect("domain")) {
    const domainPatterns: [string, RegExp][] = [
      ["ecommerce", /compr|vend|loja|shop|cart|carrinho|order|pedido/i],
      ["cms", /cms|blog|conteúdo|content|pagina|page|post/i],
      ["saas", /saas|subscription|assinatura|billing|fatura/i],
      ["social", /social|feed|post|comentar|comment|follow|segui/i],
      ["crm", /crm|lead|contact|contato|deal|negócio/i],
      ["erp", /erp|estoque|inventory|fatur|invoice/i],
      ["task_management", /tarefa|todo|task|kanban|board/i],
      ["chat", /chat|mensagem|message|conversa|conversation/i],
      ["education", /curso|course|aula|lesson|student|aluno/i],
      ["healthcare", /médic|doctor|patient|paciente|health|saúde/i],
      // Custom domains from options
      ...(options?.customDomains?.map(c => [c.name, new RegExp(c.pattern, 'i')] as [string, RegExp]) || []),
    ]

    const excludeDomainSet = new Set(options?.excludeDomains || [])
    for (const [domain, pattern] of domainPatterns) {
      if (pattern.test(briefing) && !excludeDomainSet.has(domain)) {
        analysis.domain_detected = domain
        break
      }
    }
  }

  // Detect ambiguities
  const ambiguousPatterns = [
    { pattern: /compartilh[ando]+/i, desc: "Mecanismo de compartilhamento não especificado (link público, usuário, organização?)" },
    { pattern: /simples|básico|basic/i, desc: "Nível de complexidade ambíguo - quais funcionalidades estão incluídas/excluídas?" },
    { pattern: /etc|e assim por diante/i, desc: "Enumeração aberta detectada" },
    { pattern: /maybe|talvez|perhaps|pode ser/i, desc: "Funcionalidade mencionada com incerteza" },
  ]

  for (const { pattern, desc } of ambiguousPatterns) {
    if (pattern.test(briefing)) {
      analysis.ambiguities.push(desc)
    }
  }

  // Now determine what's MISSING (not already in the briefing)
  buildMissingInformation(analysis)

  // Store in cache if provided
  if (options?.analysisCache && options.briefingHash) {
    options.analysisCache.set(options.briefingHash, { result: analysis, timestamp: Date.now() })
  }

  return analysis
}

function extractContextAround(text: string, index: number): string {
  const start = Math.max(0, index - 50)
  const end = Math.min(text.length, index + 50)
  return text.slice(start, end).trim()
}

function buildMissingInformation(analysis: BriefingAnalysis): void {
  const missing = analysis.missing_information

  // Only add questions for things NOT detected in the briefing

  // Auth - only if not detected
  if (!analysis.tech_stack.auth && !analysis.known_facts["auth_mentioned"]) {
    missing.push({
      category: "auth",
      description: "Mecanismo de autenticação",
      classification: "CRITICAL",
      already_answered: false,
      question_for_user: {
        question: "Como os usuários farão login no sistema?",
        header: "Autenticação",
        options: [
          { label: "Email + Senha", description: "Cadastro e login com email e senha" },
          { label: "Google OAuth", description: "Login com conta Google" },
          { label: "GitHub OAuth", description: "Login com conta GitHub" },
          { label: "JWT", description: "Autenticação via JSON Web Tokens" },
          { label: "Sessão/ Cookie", description: "Sessão server-side com cookies HTTP-only" },
          { label: "Clerk", description: "Serviço de autenticação Clerk" },
          { label: "Auth0", description: "Serviço de autenticação Auth0" },
          { label: "Sem autenticação", description: "Sistema público, sem login" },
        ],
      },
    })
  }

  // Frontend - only if not detected
  if (!analysis.tech_stack.frontend) {
    missing.push({
      category: "frontend",
      description: "Framework/frontend",
      classification: "CRITICAL",
      already_answered: false,
      question_for_user: {
        question: "Qual tecnologia será usada no frontend?",
        header: "Frontend",
        options: [
          { label: "React", description: "Biblioteca JavaScript mais popular" },
          { label: "Vue.js", description: "Framework progressivo e flexível" },
          { label: "Angular", description: "Framework completo da Google" },
          { label: "Svelte", description: "Framework reativo compilado" },
          { label: "Next.js", description: "Framework React full-stack" },
          { label: "Nuxt", description: "Framework Vue full-stack" },
          { label: "HTML/CSS/JS puro", description: "Sem framework, código vanilla" },
          { label: "Não aplicável", description: "Backend apenas, sem frontend" },
        ],
      },
    })
  }

  // Backend - only if not detected
  if (!analysis.tech_stack.backend) {
    missing.push({
      category: "backend",
      description: "Framework/backend",
      classification: "CRITICAL",
      already_answered: false,
      question_for_user: {
        question: "Qual tecnologia será usada no backend?",
        header: "Backend",
        options: [
          { label: "Express", description: "Framework web minimalista para Node.js" },
          { label: "Fastify", description: "Framework web rápido para Node.js" },
          { label: "NestJS", description: "Framework Node.js com arquitetura modular" },
          { label: "Hono", description: "Framework web leve e rápido" },
          { label: "Django", description: "Framework Python full-featured" },
          { label: "FastAPI", description: "Framework Python rápido e assíncrono" },
          { label: "Flask", description: "Micro-framework Python" },
          { label: "Rails", description: "Framework Ruby full-stack" },
          { label: "Laravel", description: "Framework PHP elegante" },
          { label: "Spring Boot", description: "Framework Java corporativo" },
          { label: "Go stdlib", description: "Go padrão com net/http" },
          { label: "Gin", description: "Framework web rápido para Go" },
          { label: "Actix/Axum", description: "Frameworks web para Rust" },
        ],
      },
    })
  }

  // Database - only if not detected
  if (!analysis.tech_stack.database) {
    missing.push({
      category: "database",
      description: "Banco de dados",
      classification: "CRITICAL",
      already_answered: false,
      question_for_user: {
        question: "Qual banco de dados será utilizado?",
        header: "Banco de Dados",
        options: [
          { label: "SQLite", description: "Banco local, sem servidor, ideal para projetos pequenos" },
          { label: "PostgreSQL", description: "Banco relacional robusto e escalável" },
          { label: "MySQL", description: "Banco relacional popular e maduro" },
          { label: "MongoDB", description: "Banco NoSQL baseado em documentos" },
          { label: "Supabase", description: "BaaS com PostgreSQL + APIs automáticas" },
          { label: "Firebase", description: "BaaS da Google com Firestore/Realtime DB" },
          { label: "Redis", description: "Banco key-value para cache e sessões" },
          { label: "Turso", description: "SQLite distribuído na borda" },
          { label: "DynamoDB", description: "Banco NoSQL da AWS" },
          { label: "Sem banco", description: "Sistema sem persistência" },
        ],
      },
    })
  }

  // Delete behavior - always ask (it's a business decision)
  missing.push({
    category: "delete_behavior",
    description: "Comportamento de exclusão",
    classification: "IMPORTANT",
    already_answered: false,
    question_for_user: {
      question: "Como devem funcionar as exclusões no sistema?",
      header: "Exclusão",
      options: [
        { label: "Hard delete", description: "Registros são removidos permanentemente" },
        { label: "Soft delete", description: "Registros são marcados como deletados mas mantidos" },
      ],
    },
  })

  // Business rules - only if not enough context
  if (analysis.inferred_entities.length > 0) {
    missing.push({
      category: "business_rules",
      description: "Regras de negócio específicas",
      classification: "OPTIONAL",
      already_answered: false,
      question_for_user: {
        question: "Existem regras de negócio específicas para as entidades detectadas?",
        header: "Regras de Negócio",
        options: [
          { label: "Não por agora", description: "Prosseguir com regras padrão" },
          { label: "Sim, vou especificar", description: "Quero definir regras específicas" },
        ],
      },
    })
  }

  // Multi-tenancy - if not detected
  if (!analysis.tech_stack.frontend && !analysis.known_facts["multi_tenant"]) {
    const text = Object.values(analysis.known_facts).join(" ").toLowerCase()
    if (/tenant|multi.?tenant|organiza/i.test(text)) {
      missing.push({
        category: "multi_tenancy",
        description: "Estratégia de multi-tenancy",
        classification: "IMPORTANT",
        already_answered: false,
        question_for_user: {
          question: "O sistema precisa de multi-tenancy?",
          header: "Multi-Tenancy",
          options: [
            { label: "Não", description: "Sistema single-tenant" },
            { label: "Sim, por schema", description: "Isolamento por schema no banco" },
            { label: "Sim, por coluna", description: "Isolamento por tenant_id em cada tabela" },
            { label: "Sim, por banco", description: "Um banco de dados por tenant" },
          ],
        },
      })
    }
  }

  // Deployment - always ask
  missing.push({
    category: "deployment",
    description: "Estratégia de deploy",
    classification: "IMPORTANT",
    already_answered: false,
    question_for_user: {
      question: "Como o sistema será deployado?",
      header: "Deploy",
      options: [
        { label: "Docker", description: "Containerização com Docker" },
        { label: "Vercel/Netlify", description: "Deploy serverless" },
        { label: "VPS tradicional", description: "Servidor dedicado ou VPS" },
        { label: "Kubernetes", description: "Orquestração com K8s" },
        { label: "AWS/GCP/Azure", description: "Cloud provider" },
        { label: "Ainda não definido", description: "Decidir depois" },
      ],
    },
  })

  // API versioning - if API detected
  if (analysis.inferred_entities.length > 0) {
    missing.push({
      category: "api_versioning",
      description: "Versionamento da API",
      classification: "OPTIONAL",
      already_answered: false,
      question_for_user: {
        question: "Como a API será versionada?",
        header: "API Versioning",
        options: [
          { label: "URL path (/v1/)", description: "Versão no path da URL" },
          { label: "Header", description: "Versão no header Accept" },
          { label: "Query param", description: "Versão como query parameter" },
          { label: "Sem versionamento", description: "API sem controle de versão" },
        ],
      },
    })
  }

  // Testing strategy
  if (!analysis.tech_stack.testing) {
    missing.push({
      category: "testing",
      description: "Estratégia de testes",
      classification: "OPTIONAL",
      already_answered: false,
      question_for_user: {
        question: "Qual estratégia de testes será usada?",
        header: "Testes",
        options: [
          { label: "Unit tests", description: "Testes unitários com Jest/Vitest" },
          { label: "Integration tests", description: "Testes de integração + E2E" },
          { label: "TDD", description: "Desenvolvimento orientado a testes" },
          { label: "Sem testes por agora", description: "Adicionar testes depois" },
        ],
      },
    })
  }
}

/**
 * Options for controlling question generation scope.
 */
export interface QuestionGenerationOptions {
  /** Skip these categories (e.g., ["auth", "frontend"]). */
  excludeCategories?: string[]
  /** Only generate questions for these categories. */
  focusCategories?: string[]
  /** Questions already asked by the IA — skip these. */
  alreadyAsked?: string[]
  /** Maximum questions to generate. */
  maxQuestions?: number
  /** Only generate questions at these classifications. */
  focusClassifications?: Array<"CRITICAL" | "IMPORTANT" | "OPTIONAL" | "UNKNOWN">
}

export function generateDiscoveryQuestions(
  analysis: BriefingAnalysis,
  options?: QuestionGenerationOptions,
): QuestionForUser[] {
  const excludeSet = new Set(options?.excludeCategories || [])
  const focusSet = options?.focusCategories?.length ? new Set(options.focusCategories) : null
  const askedSet = new Set(options?.alreadyAsked?.map(q => q.toLowerCase()) || [])
  const focusClassSet = options?.focusClassifications?.length ? new Set(options.focusClassifications) : null

  const questions = analysis.missing_information
    .filter((m) => {
      if (m.already_answered) return false
      if (!m.question_for_user) return false
      if (excludeSet.has(m.category)) return false
      if (focusSet && !focusSet.has(m.category)) return false
      if (focusClassSet && !focusClassSet.has(m.classification)) return false
      // Skip if already asked
      const qLower = m.question_for_user.question.toLowerCase()
      if (askedSet.has(qLower)) return false
      return true
    })
    .map((m) => m.question_for_user!)

  if (options?.maxQuestions && questions.length > options.maxQuestions) {
    return questions.slice(0, options.maxQuestions)
  }

  return questions
}

export function updateGraphFromAnswers(
  graph: KnowledgeGraph,
  answers: Record<string, string>,
): void {
  const now = new Date().toISOString()

  for (const [question, answer] of Object.entries(answers)) {
    const lowerQ = question.toLowerCase()

    // Auth type
    if (lowerQ.includes("login") || lowerQ.includes("autenticação")) {
      let authType = answer
      addNode(graph, {
        id: `${graph.project_id}-AUTH`,
        type: "architecture_component",
        name: "Authentication",
        description: `Authentication mechanism: ${authType}`,
        status: "APPROVED",
        version: 1,
        metadata: { layer: "backend", technology: authType },
        created_at: now,
        updated_at: now,
      })
    }

    // Frontend
    if (lowerQ.includes("frontend")) {
      addNode(graph, {
        id: `${graph.project_id}-FE`,
        type: "architecture_component",
        name: "Frontend",
        description: `Frontend: ${answer}`,
        status: "APPROVED",
        version: 1,
        metadata: { layer: "frontend", technology: answer },
        created_at: now,
        updated_at: now,
      })
    }

    // Backend
    if (lowerQ.includes("backend")) {
      addNode(graph, {
        id: `${graph.project_id}-BE`,
        type: "architecture_component",
        name: "Backend",
        description: `Backend: ${answer}`,
        status: "APPROVED",
        version: 1,
        metadata: { layer: "backend", technology: answer },
        created_at: now,
        updated_at: now,
      })
    }

    // Database
    if (lowerQ.includes("banco") || lowerQ.includes("database")) {
      addNode(graph, {
        id: `${graph.project_id}-DB`,
        type: "database",
        name: "Database",
        description: `Database: ${answer}`,
        status: "APPROVED",
        version: 1,
        metadata: { engine: answer.toLowerCase() },
        created_at: now,
        updated_at: now,
      })
    }

    // Multi-tenancy
    if (lowerQ.includes("tenant")) {
      const isMultiTenant = /sim|yes|true/i.test(answer) || /multi/i.test(answer)
      if (isMultiTenant) {
        addNode(graph, {
          id: `${graph.project_id}-TENANT`,
          type: "entity",
          name: "Tenant",
          description: "Tenant entity for multi-tenancy",
          status: "APPROVED",
          version: 1,
          metadata: {
            fields: [
              { name: "id", type: "uuid", primary_key: true },
              { name: "name", type: "string", required: true },
              { name: "created_at", type: "timestamp" },
            ] as Array<{ name: string; type: string; primary_key?: boolean; required?: boolean }>,
          },
          created_at: now,
          updated_at: now,
        })
      }
    }

    // Delete behavior
    if (lowerQ.includes("exclusão") || lowerQ.includes("delete")) {
      const isSoftDelete = /soft|reversível|reversivel/i.test(answer)
      addNode(graph, {
        id: `${graph.project_id}-RULE-DELETE`,
        type: "business_rule",
        name: "Delete Behavior",
        description: isSoftDelete
          ? "Entities use soft delete (marked as deleted, not removed)"
          : "Entities use hard delete (permanently removed)",
        status: "APPROVED",
        version: 1,
        metadata: {
          rule_text: isSoftDelete
            ? "Soft delete: records are marked with deleted_at timestamp"
            : "Hard delete: records are permanently removed from database",
        },
        created_at: now,
        updated_at: now,
      })
    }
  }
}

export function isBriefingSufficient(analysis: BriefingAnalysis): boolean {
  const criticalMissing = analysis.missing_information.filter(
    (m) => m.classification === "CRITICAL" && !m.already_answered,
  )
  return criticalMissing.length === 0
}

export function formatDiscoverySummary(analysis: BriefingAnalysis): string {
  const lines: string[] = ["## Briefing Analysis\n"]

  // Tech stack detected
  const techs = Object.entries(analysis.tech_stack).filter(([, v]) => v !== null && v !== "")
  if (techs.length > 0) {
    lines.push("### Tech Stack Detectado")
    for (const [key, value] of techs) {
      if (key === "other") continue
      lines.push(`- **${key}:** ${value}`)
    }
    lines.push("")
  }

  if (Object.keys(analysis.known_facts).length > 0) {
    lines.push("### Informações Detectadas")
    for (const [key, value] of Object.entries(analysis.known_facts)) {
      if (key.startsWith("tech_")) continue
      lines.push(`- ${key}: ${value}`)
    }
    lines.push("")
  }

  if (analysis.inferred_entities.length > 0) {
    lines.push("### Entidades Detectadas")
    lines.push(`- ${analysis.inferred_entities.join(", ")}`)
    lines.push("")
  }

  if (analysis.file_references.length > 0) {
    lines.push("### Arquivos Referenciados (@)")
    for (const ref of analysis.file_references) {
      lines.push(`- \`${ref.path}\` — contexto: ${ref.context}`)
    }
    lines.push("")
  }

  if (analysis.domain_detected) {
    lines.push(`### Domínio Detectado: ${analysis.domain_detected}`)
    lines.push("")
  }

  if (analysis.ambiguities.length > 0) {
    lines.push("### Ambiguidades Detectadas")
    for (const a of analysis.ambiguities) {
      lines.push(`- ${a}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}
