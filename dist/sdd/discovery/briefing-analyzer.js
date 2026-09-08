// ─── Extracted Elements ────────────────────────────────────────────
// ─── Feature Extraction ────────────────────────────────────────────
const FEATURE_KEYWORDS = [
    // Portuguese
    /(?:sistema de|motor de|módulo de|módulo para|funcionalidade de|recurso de|feature de)\s+(.+)/gi,
    /(?:gerenci[ae]|administ[ra]|controla?r?|criar?|configura?r?|manipula?r?|processa?r?|executa?r?|valida?r?|autentica?r?|autori[zs]a?r?|notifica?r?|monitora?r?|deploy|build|compila?r?|instala?r?|publica?r?|busca?r?|pesquisa?r?|filtra?r?|ordena?r?|importa?r?|exporta?r?|upload|download|sync|backup|restore|migra?r?|rollback)\s+(.+?)(?:\.|,|$)/gi,
    // English
    /(?:system for|engine for|module for|feature for|handle|manage|support|provide|implement)\s+(.+)/gi,
];
function extractFeatures(text) {
    const features = [];
    const seen = new Set();
    // Extract from numbered sections (e.g., "# 27. CI/CD")
    const sectionPattern = /(?:^|\n)#+\s*(\d+)\.\s*(.+?)(?:\n|$)/gm;
    let match;
    while ((match = sectionPattern.exec(text)) !== null) {
        const name = match[2].trim();
        if (name && !seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase());
            features.push({
                name,
                description: extractSectionDescription(text, match.index),
                priority: inferPriority(text, match.index),
            });
        }
    }
    // Extract from keyword patterns
    for (const pattern of FEATURE_KEYWORDS) {
        pattern.lastIndex = 0;
        while ((match = pattern.exec(text)) !== null) {
            const raw = match[1]?.trim();
            if (!raw || raw.length < 3 || raw.length > 80)
                continue;
            const name = cleanFeatureName(raw);
            if (!name || seen.has(name.toLowerCase()))
                continue;
            seen.add(name.toLowerCase());
            features.push({
                name,
                description: raw,
                priority: "medium",
            });
        }
    }
    return features.slice(0, 50); // cap at 50
}
function cleanFeatureName(raw) {
    return raw
        .replace(/[.:;,]+$/, "")
        .replace(/^[\s\-•*]+/, "")
        .trim()
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .slice(0, 6)
        .join(" ");
}
function extractSectionDescription(text, index) {
    const after = text.slice(index, index + 500);
    const lines = after.split("\n").slice(1, 5);
    return lines
        .filter((l) => l.trim() && !l.startsWith("#"))
        .slice(0, 2)
        .join(" ")
        .trim()
        .slice(0, 200);
}
function inferPriority(text, index) {
    const context = text.slice(Math.max(0, index - 100), index + 200).toLowerCase();
    if (/\b(critical|essencial|obrigat|must|security|seguran|auth)\b/.test(context))
        return "critical";
    if (/\b(high|importante|important|core|principal)\b/.test(context))
        return "high";
    if (/\b(low|optional|opcion|nice.to.have)\b/.test(context))
        return "low";
    return "medium";
}
// ─── Entity Extraction ─────────────────────────────────────────────
const ENTITY_PATTERNS = [
    {
        pattern: /\b(user|usu[aá]rio)s?\b/i,
        name: "User",
        fields: [
            { name: "id", type: "uuid", required: true },
            { name: "email", type: "string", required: true },
            { name: "name", type: "string", required: true },
            { name: "password_hash", type: "string", required: true },
            { name: "role", type: "string" },
            { name: "created_at", type: "timestamp" },
            { name: "updated_at", type: "timestamp" },
        ],
    },
    {
        pattern: /\b(tenant|organiza[çc][ãa]o|company|empresa)s?\b/i,
        name: "Tenant",
        fields: [
            { name: "id", type: "uuid", required: true },
            { name: "name", type: "string", required: true },
            { name: "slug", type: "string", required: true },
            { name: "plan", type: "string" },
            { name: "created_at", type: "timestamp" },
        ],
    },
    {
        pattern: /\b(content|conte[uú]do|post|artigo|article|page|p[aá]gina)s?\b/i,
        name: "Content",
        fields: [
            { name: "id", type: "uuid", required: true },
            { name: "title", type: "string", required: true },
            { name: "slug", type: "string", required: true },
            { name: "body", type: "text" },
            { name: "status", type: "string" },
            { name: "author_id", type: "uuid" },
            { name: "created_at", type: "timestamp" },
            { name: "updated_at", type: "timestamp" },
        ],
    },
    {
        pattern: /\b(media|arquivo|file|image|imagem|upload)s?\b/i,
        name: "Media",
        fields: [
            { name: "id", type: "uuid", required: true },
            { name: "filename", type: "string", required: true },
            { name: "mime_type", type: "string" },
            { name: "size", type: "integer" },
            { name: "url", type: "string" },
            { name: "created_at", type: "timestamp" },
        ],
    },
    {
        pattern: /\b(plugin|extens[ãa]o|addon)s?\b/i,
        name: "Plugin",
        fields: [
            { name: "id", type: "uuid", required: true },
            { name: "name", type: "string", required: true },
            { name: "version", type: "string" },
            { name: "manifest", type: "json" },
            { name: "status", type: "string" },
            { name: "installed_at", type: "timestamp" },
        ],
    },
    {
        pattern: /\b(theme|tema)s?\b/i,
        name: "Theme",
        fields: [
            { name: "id", type: "uuid", required: true },
            { name: "name", type: "string", required: true },
            { name: "version", type: "string" },
            { name: "config", type: "json" },
            { name: "active", type: "boolean" },
            { name: "installed_at", type: "timestamp" },
        ],
    },
    {
        pattern: /\b(deployment|deploy|implanta[çc][ãa]o)s?\b/i,
        name: "Deployment",
        fields: [
            { name: "id", type: "uuid", required: true },
            { name: "version", type: "string", required: true },
            { name: "status", type: "string" },
            { name: "environment", type: "string" },
            { name: "created_at", type: "timestamp" },
            { name: "deployed_at", type: "timestamp" },
        ],
    },
    {
        pattern: /\b(category|categor[iia])s?\b/i,
        name: "Category",
        fields: [
            { name: "id", type: "uuid", required: true },
            { name: "name", type: "string", required: true },
            { name: "slug", type: "string", required: true },
            { name: "parent_id", type: "uuid" },
        ],
    },
    {
        pattern: /\b(tag|etiqueta|label)s?\b/i,
        name: "Tag",
        fields: [
            { name: "id", type: "uuid", required: true },
            { name: "name", type: "string", required: true },
            { name: "slug", type: "string", required: true },
        ],
    },
    {
        pattern: /\b(menu|navega[çc][ãa]o|navigation)s?\b/i,
        name: "Menu",
        fields: [
            { name: "id", type: "uuid", required: true },
            { name: "name", type: "string", required: true },
            { name: "items", type: "json" },
            { name: "location", type: "string" },
        ],
    },
    {
        pattern: /\b(setting|configura[çc][ãa]o|preference)s?\b/i,
        name: "Setting",
        fields: [
            { name: "id", type: "uuid", required: true },
            { name: "key", type: "string", required: true },
            { name: "value", type: "text" },
            { name: "group", type: "string" },
        ],
    },
    {
        pattern: /\b(webhook)s?\b/i,
        name: "Webhook",
        fields: [
            { name: "id", type: "uuid", required: true },
            { name: "url", type: "string", required: true },
            { name: "events", type: "json" },
            { name: "secret", type: "string" },
            { name: "active", type: "boolean" },
        ],
    },
    {
        pattern: /\b(audit.?log|log.?de.?auditoria|activity.?log)s?\b/i,
        name: "AuditLog",
        fields: [
            { name: "id", type: "uuid", required: true },
            { name: "user_id", type: "uuid" },
            { name: "action", type: "string", required: true },
            { name: "resource_type", type: "string" },
            { name: "resource_id", type: "string" },
            { name: "details", type: "json" },
            { name: "created_at", type: "timestamp" },
        ],
    },
    {
        pattern: /\b(permission|permiss[aä]o|role|papel)s?\b/i,
        name: "Permission",
        fields: [
            { name: "id", type: "uuid", required: true },
            { name: "name", type: "string", required: true },
            { name: "resource", type: "string" },
            { name: "action", type: "string" },
        ],
    },
];
function extractEntities(text) {
    const entities = [];
    const seen = new Set();
    for (const { pattern, name, fields } of ENTITY_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(text) && !seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase());
            entities.push({ name, description: `${name} entity`, fields: [...fields] });
        }
    }
    // Also detect custom entities from text patterns
    const customPattern = /(?:entidade|entity|modelo|model|tabela|table)\s+(?:de\s+|do\s+|da\s+|called?\s+)?["']?([A-Z][a-záàãâéêíóôõú]+)["']?/gi;
    let match;
    while ((match = customPattern.exec(text)) !== null) {
        const name = match[1]?.trim();
        if (name && !seen.has(name.toLowerCase()) && name.length > 2 && name.length < 30) {
            seen.add(name.toLowerCase());
            entities.push({
                name,
                description: `${name} entity`,
                fields: [
                    { name: "id", type: "uuid", required: true },
                    { name: "created_at", type: "timestamp" },
                    { name: "updated_at", type: "timestamp" },
                ],
            });
        }
    }
    return entities.slice(0, 30);
}
// ─── Endpoint Extraction ───────────────────────────────────────────
function extractEndpoints(text) {
    const endpoints = [];
    const seen = new Set();
    // Pattern: method + path (e.g., "GET /api/users", "POST /api/content")
    const restPattern = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[\w\-\/{}.:*]+)/gi;
    let match;
    while ((match = restPattern.exec(text)) !== null) {
        const method = match[1].toUpperCase();
        const path = match[2];
        const key = `${method}:${path}`;
        if (!seen.has(key)) {
            seen.add(key);
            endpoints.push({ method, path, description: `Auto-detected endpoint` });
        }
    }
    // Pattern: "endpoint", "route", "rota" descriptions
    const routePattern = /(?:endpoint|route|rota|api)\s*[:\-–]\s*(GET|POST|PUT|PATCH|DELETE)?\s*[:\-–]?\s*(\/[\w\-\/{}.]+)/gi;
    while ((match = routePattern.exec(text)) !== null) {
        const method = (match[1] || "GET").toUpperCase();
        const path = match[2];
        const key = `${method}:${path}`;
        if (!seen.has(key)) {
            seen.add(key);
            endpoints.push({ method, path, description: `Auto-detected endpoint` });
        }
    }
    // Infer CRUD endpoints from entities
    const entityMentionPattern = /\b(user|content|media|plugin|theme|deployment|category|tag|menu|setting|webhook|permission)s?\b/gi;
    const crudPaths = {
        user: "/api/v1/users",
        content: "/api/v1/content",
        media: "/api/v1/media",
        plugin: "/api/v1/plugins",
        theme: "/api/v1/themes",
        deployment: "/api/v1/deployments",
        category: "/api/v1/categories",
        tag: "/api/v1/tags",
        menu: "/api/v1/menus",
        setting: "/api/v1/settings",
        webhook: "/api/v1/webhooks",
        permission: "/api/v1/permissions",
    };
    while ((match = entityMentionPattern.exec(text)) !== null) {
        const entity = match[1].toLowerCase();
        const basePath = crudPaths[entity];
        if (basePath && !seen.has(`GET:${basePath}`)) {
            seen.add(`GET:${basePath}`);
            seen.add(`GET:${basePath}/:id`);
            seen.add(`POST:${basePath}`);
            seen.add(`PUT:${basePath}/:id`);
            seen.add(`DELETE:${basePath}/:id`);
            endpoints.push({ method: "GET", path: basePath, description: `List ${entity}s`, relatedEntity: entity }, { method: "GET", path: `${basePath}/:id`, description: `Get ${entity} by ID`, relatedEntity: entity }, { method: "POST", path: basePath, description: `Create ${entity}`, relatedEntity: entity }, { method: "PUT", path: `${basePath}/:id`, description: `Update ${entity}`, relatedEntity: entity }, { method: "DELETE", path: `${basePath}/:id`, description: `Delete ${entity}`, relatedEntity: entity });
        }
    }
    return endpoints.slice(0, 80);
}
// ─── Business Rule Extraction ──────────────────────────────────────
function extractBusinessRules(text) {
    const rules = [];
    const seen = new Set();
    // Pattern: "deve", "must", "não pode", "cannot", "deve ser", "must be"
    const rulePatterns = [
        /(?:deve|must|shall|required|obrigat[óo]ri[oa])\s+(.{10,120})/gi,
        /(?:n[aã]o pode|cannot|never|jamais|proibido|forbidden)\s+(.{10,120})/gi,
        /(?:sempre|always)\s+(.{10,120})/gi,
        /(?:valida[çc][ãa]o|validation|verifica[çc][ãa]o|check)\s*[:\-–]\s*(.{10,120})/gi,
        /(?:regra|rule|pol[ií]tica|policy)\s*[:\-–]\s*(.{10,120})/gi,
        /(?:deve ser|must be|should be|precisa ser)\s+(.{10,120})/gi,
    ];
    for (const pattern of rulePatterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const desc = match[1]?.trim().replace(/[.:;,]+$/, "");
            if (!desc || desc.length < 10)
                continue;
            const name = desc
                .split(" ")
                .slice(0, 6)
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                .join(" ");
            if (!seen.has(name.toLowerCase())) {
                seen.add(name.toLowerCase());
                rules.push({ name, description: desc });
            }
        }
    }
    // Extract from bullet points with rule-like content
    const bulletPattern = /(?:^|\n)\s*[-•*]\s+(.{15,150})/gm;
    let match;
    while ((match = bulletPattern.exec(text)) !== null) {
        const line = match[1];
        if (/\b(deve|must|não pode|cannot|sempre|always|required|valida|regra|rule|proibido|forbidden|obrigat)\b/i.test(line)) {
            const desc = line.replace(/[.:;,]+$/, "").trim();
            const name = desc
                .split(" ")
                .slice(0, 6)
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                .join(" ");
            if (!seen.has(name.toLowerCase())) {
                seen.add(name.toLowerCase());
                rules.push({ name, description: desc });
            }
        }
    }
    return rules.slice(0, 40);
}
// ─── Architecture Component Extraction ─────────────────────────────
function extractArchitectureComponents(text) {
    const components = [];
    const seen = new Set();
    const archPatterns = [
        { pattern: /\b(astro)\b/i, name: "Astro", layer: "frontend", technology: "Astro" },
        { pattern: /\b(solid\.?js|solidjs)\b/i, name: "SolidJS", layer: "frontend", technology: "SolidJS" },
        { pattern: /\b(react)\b/i, name: "React", layer: "frontend", technology: "React" },
        { pattern: /\b(vue\.?js|vue)\b/i, name: "Vue.js", layer: "frontend", technology: "Vue.js" },
        { pattern: /\b(svelte)\b/i, name: "Svelte", layer: "frontend", technology: "Svelte" },
        { pattern: /\b(next\.?js|nextjs)\b/i, name: "Next.js", layer: "frontend", technology: "Next.js" },
        { pattern: /\b(express)\b/i, name: "Express", layer: "backend", technology: "Express" },
        { pattern: /\b(fastify)\b/i, name: "Fastify", layer: "backend", technology: "Fastify" },
        { pattern: /\b(nest\.?js|nestjs)\b/i, name: "NestJS", layer: "backend", technology: "NestJS" },
        { pattern: /\b(hono)\b/i, name: "Hono", layer: "backend", technology: "Hono" },
        { pattern: /\b(django)\b/i, name: "Django", layer: "backend", technology: "Django" },
        { pattern: /\b(fastapi)\b/i, name: "FastAPI", layer: "backend", technology: "FastAPI" },
        { pattern: /\b(postgres(ql)?)\b/i, name: "PostgreSQL", layer: "database", technology: "PostgreSQL" },
        { pattern: /\b(mysql)\b/i, name: "MySQL", layer: "database", technology: "MySQL" },
        { pattern: /\b(sqlite)\b/i, name: "SQLite", layer: "database", technology: "SQLite" },
        { pattern: /\b(mongodb?|mongo)\b/i, name: "MongoDB", layer: "database", technology: "MongoDB" },
        { pattern: /\b(redis)\b/i, name: "Redis", layer: "database", technology: "Redis" },
        { pattern: /\b(docker)\b/i, name: "Docker", layer: "infrastructure", technology: "Docker" },
        { pattern: /\b(kubernetes|k8s)\b/i, name: "Kubernetes", layer: "infrastructure", technology: "Kubernetes" },
        { pattern: /\b(prisma)\b/i, name: "Prisma", layer: "database", technology: "Prisma" },
        { pattern: /\b(turborepo)\b/i, name: "Turborepo", layer: "infrastructure", technology: "Turborepo" },
        { pattern: /\b(bullmq|bull)\b/i, name: "BullMQ", layer: "infrastructure", technology: "BullMQ" },
        { pattern: /\b(vitest)\b/i, name: "Vitest", layer: "infrastructure", technology: "Vitest" },
        { pattern: /\b(playwright)\b/i, name: "Playwright", layer: "infrastructure", technology: "Playwright" },
    ];
    for (const { pattern, name, layer, technology } of archPatterns) {
        pattern.lastIndex = 0;
        if (pattern.test(text) && !seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase());
            components.push({ name, layer, technology, description: `${name} component` });
        }
    }
    // Infer from section headings
    const sectionPattern = /(?:^|\n)#+\s*(\d+)\.\s*(.+?)(?:\n|$)/gm;
    let match;
    while ((match = sectionPattern.exec(text)) !== null) {
        const sectionName = match[2].trim().toLowerCase();
        if (/(?:ci\/cd|pipeline|build|docker|deploy|worker|queue|registry|observab|monitor|security|sandbox)/i.test(sectionName)) {
            const name = match[2].trim();
            if (!seen.has(name.toLowerCase())) {
                seen.add(name.toLowerCase());
                components.push({
                    name,
                    layer: "infrastructure",
                    technology: name,
                    description: `Infrastructure component: ${name}`,
                });
            }
        }
        if (/(?:api|rest|graphql|sdk|plugin|theme|cli|admin|dashboard)/i.test(sectionName)) {
            const name = match[2].trim();
            if (!seen.has(name.toLowerCase())) {
                seen.add(name.toLowerCase());
                components.push({
                    name,
                    layer: sectionName.includes("theme") || sectionName.includes("admin") ? "frontend" : "backend",
                    technology: name,
                    description: `Application component: ${name}`,
                });
            }
        }
    }
    return components.slice(0, 30);
}
// ─── Decision Extraction ───────────────────────────────────────────
function extractDecisions(text) {
    const decisions = [];
    const seen = new Set();
    // Pattern: "Astro vs Next.js", "PostgreSQL vs SQLite"
    const vsPattern = /([A-Z][\w.]+(?:\.?js)?)\s+vs(?:\.|dot)?\s+([A-Z][\w.]+(?:\.?js)?)/gi;
    let match;
    while ((match = vsPattern.exec(text)) !== null) {
        const optionA = match[1].trim();
        const optionB = match[2].trim();
        const title = `${optionA} vs ${optionB}`;
        if (!seen.has(title.toLowerCase())) {
            seen.add(title.toLowerCase());
            decisions.push({
                title,
                context: `Technology choice between ${optionA} and ${optionB}`,
                decision: `To be decided`,
                consequences: `Selection will impact the project architecture`,
            });
        }
    }
    // Pattern: "REST vs GraphQL", "monorepo vs multirepo"
    const monoPattern = /(REST|GraphQL|monorepo|multirepo|SQLite|PostgreSQL|MySQL|WASM|container|Docker)\s+vs\s+(REST|GraphQL|monorepo|multirepo|SQLite|PostgreSQL|MySQL|WASM|container|Docker)/gi;
    while ((match = monoPattern.exec(text)) !== null) {
        const title = `${match[1]} vs ${match[2]}`;
        if (!seen.has(title.toLowerCase())) {
            seen.add(title.toLowerCase());
            decisions.push({
                title,
                context: `Architecture decision`,
                decision: "To be decided",
                consequences: "Impact on project architecture",
            });
        }
    }
    // Pattern: ADR sections
    const adrPattern = /(?:ADR|Decision Record|decis[aã]o arquitetural|architecture decision)\s*[:\-–]?\s*(.{10,100})/gi;
    while ((match = adrPattern.exec(text)) !== null) {
        const title = match[1]?.trim();
        if (title && !seen.has(title.toLowerCase())) {
            seen.add(title.toLowerCase());
            decisions.push({
                title,
                context: "Architecture decision",
                decision: "To be decided",
                consequences: "Impact on project architecture",
            });
        }
    }
    return decisions.slice(0, 20);
}
// ─── Requirement Extraction ────────────────────────────────────────
function extractRequirements(text) {
    const requirements = [];
    const seen = new Set();
    // Extract from numbered sections that look like requirements
    const reqPattern = /(?:^|\n)#+\s*(\d+)\.\s*(.+?)(?:\n|$)/gm;
    let match;
    while ((match = reqPattern.exec(text)) !== null) {
        const name = match[2].trim();
        if (name && !seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase());
            // Check if it has acceptance criteria (Given/When/Then)
            const sectionText = text.slice(match.index, match.index + 1000);
            const acPattern = /(?:Given|Quando|When)[:\s]+(.+?)(?:\n|$)/gi;
            const acceptanceCriteria = [];
            let acMatch;
            while ((acMatch = acPattern.exec(sectionText)) !== null) {
                acceptanceCriteria.push(acMatch[1].trim());
            }
            const isNonFunctional = /\b(performance|escala|disponib|seguran|observab|manuten|extensi|lat[êe]ncia|throughput|uptime|backup|recovery|monitor)\b/i.test(name);
            requirements.push({
                name,
                description: extractSectionDescription(text, match.index) || name,
                type: isNonFunctional ? "non_functional" : "functional",
                priority: inferPriority(text, match.index),
                acceptanceCriteria: acceptanceCriteria.slice(0, 10),
            });
        }
    }
    return requirements.slice(0, 50);
}
// ─── Main Analysis ─────────────────────────────────────────────────
export function analyzeBriefingDeep(text) {
    const features = extractFeatures(text);
    const entities = extractEntities(text);
    const endpoints = extractEndpoints(text);
    const businessRules = extractBusinessRules(text);
    const architectureComponents = extractArchitectureComponents(text);
    const decisions = extractDecisions(text);
    const requirements = extractRequirements(text);
    // Build relationships between extracted elements
    const relationships = [];
    // Connect entities to architecture components
    for (const entity of entities) {
        for (const comp of architectureComponents) {
            if (comp.layer === "database") {
                relationships.push({
                    from: `entity-${entity.name}`,
                    to: `arch-${comp.name}`,
                    type: "persists_to",
                });
            }
        }
    }
    // Connect endpoints to entities
    for (const ep of endpoints) {
        if (ep.relatedEntity) {
            relationships.push({
                from: `endpoint-${ep.method}-${ep.path}`,
                to: `entity-${ep.relatedEntity}`,
                type: "exposes",
            });
        }
    }
    // Connect features to requirements
    for (const req of requirements) {
        const matchingFeature = features.find((f) => f.name.toLowerCase().includes(req.name.toLowerCase().split(" ")[0]) ||
            req.name.toLowerCase().includes(f.name.toLowerCase().split(" ")[0]));
        if (matchingFeature) {
            relationships.push({
                from: `feature-${matchingFeature.name}`,
                to: `requirement-${req.name}`,
                type: "satisfied_by",
            });
        }
    }
    // Connect business rules to features
    for (const rule of businessRules) {
        const matchingFeature = features.find((f) => f.name.toLowerCase().includes(rule.name.toLowerCase().split(" ")[0]) ||
            rule.name.toLowerCase().includes(f.name.toLowerCase().split(" ")[0]));
        if (matchingFeature) {
            relationships.push({
                from: `feature-${matchingFeature.name}`,
                to: `rule-${rule.name}`,
                type: "constrained_by",
            });
        }
    }
    // Detect tech stack
    const techStack = {};
    for (const comp of architectureComponents) {
        techStack[comp.layer] = comp.technology;
    }
    // Detect domains
    const domains = [];
    if (/\b(cms|blog|conte[uú]do|content|pagina|page)\b/i.test(text))
        domains.push("cms");
    if (/\b(e-commerce|ecommerce|loja|shop|cart|carrinho)\b/i.test(text))
        domains.push("ecommerce");
    if (/\b(saas|subscription|assinatura|billing)\b/i.test(text))
        domains.push("saas");
    if (/\b(multi-tenant|tenant)\b/i.test(text))
        domains.push("multi-tenancy");
    if (/\b(plugin|extens|addon)\b/i.test(text))
        domains.push("plugin-system");
    if (/\b(theme|tema)\b/i.test(text))
        domains.push("theme-system");
    if (/\b(docker|container|deploy)\b/i.test(text))
        domains.push("devops");
    if (/\b(security|seguran|auth|rbac|sandbox)\b/i.test(text))
        domains.push("security");
    return {
        features,
        entities,
        endpoints,
        businessRules,
        architectureComponents,
        decisions,
        requirements,
        relationships,
        domains,
        techStack,
    };
}
// ─── Summary Formatting ────────────────────────────────────────────
export function formatDeepAnalysis(analysis) {
    const lines = [
        "## Deep Briefing Analysis",
        "",
        `**Features:** ${analysis.features.length}`,
        `**Entities:** ${analysis.entities.length}`,
        `**Endpoints:** ${analysis.endpoints.length}`,
        `**Business Rules:** ${analysis.businessRules.length}`,
        `**Architecture Components:** ${analysis.architectureComponents.length}`,
        `**Decisions:** ${analysis.decisions.length}`,
        `**Requirements:** ${analysis.requirements.length}`,
        `**Relationships:** ${analysis.relationships.length}`,
        "",
    ];
    if (analysis.features.length > 0) {
        lines.push("### Features");
        for (const f of analysis.features.slice(0, 15)) {
            lines.push(`- **${f.name}** [${f.priority}]: ${f.description.slice(0, 80)}`);
        }
        lines.push("");
    }
    if (analysis.entities.length > 0) {
        lines.push("### Entities");
        for (const e of analysis.entities.slice(0, 15)) {
            lines.push(`- **${e.name}**: ${e.fields.map((f) => f.name).join(", ")}`);
        }
        lines.push("");
    }
    if (analysis.endpoints.length > 0) {
        lines.push("### Endpoints (first 20)");
        for (const ep of analysis.endpoints.slice(0, 20)) {
            lines.push(`- \`${ep.method} ${ep.path}\` — ${ep.description}`);
        }
        lines.push("");
    }
    if (analysis.architectureComponents.length > 0) {
        lines.push("### Architecture");
        for (const c of analysis.architectureComponents.slice(0, 15)) {
            lines.push(`- **${c.name}** (${c.layer}): ${c.technology}`);
        }
        lines.push("");
    }
    if (analysis.decisions.length > 0) {
        lines.push("### Decisions to Make");
        for (const d of analysis.decisions.slice(0, 10)) {
            lines.push(`- **${d.title}**: ${d.decision}`);
        }
        lines.push("");
    }
    return lines.join("\n");
}
