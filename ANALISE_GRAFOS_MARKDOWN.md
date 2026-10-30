# Análise de Viabilidade: Arquitetura Híbrida Grafos + Markdown

## Resumo Executivo

**A abordagem é VIÁVEL e RECOMENDADA** para melhorar a precisão e riqueza dos detalhes dos nodes. O sistema atual já possui a infraestrutura necessária (persistência YAML/SQLite, schema de nodes, relacionamentos, validação) e a mudança seria evolutiva, não disruptiva.

---

## 1. Estado Atual (Baseline)

### Armazenamento Atual
| Aspecto | YAML (atual) | SQLite (migração automática ≥1000 nodes) |
|---------|--------------|------------------------------------------|
| **Estrutura** | Arquivo único `graph.yaml` | Banco `graph.db` com tabelas `nodes`, `relationships`, `graph_metadata` |
| **Campos do Node** | `id`, `type`, `name`, `description`, `status`, `version`, `metadata` (JSON), timestamps | Mesmos campos, normalizados em colunas + `metadata_json` TEXT |
| **Limitação** | `description` é string curta; `metadata` é JSON opaco sem busca semântica | Mesmo problema: campos estruturados limitados |

### Problemas Identificados
1. **`description` limitado** — Campo único, sem formatação rica, sem seções
2. **`metadata` opaco** — JSON blob não consultável semanticamente, sem versionamento próprio
3. **Sem histórico de conteúdo** — Mudanças no `description`/`metadata` sobrescrevem; só versiona o node inteiro
4. **LLM não consegue detalhar** — Prompt atual gera nodes com `description` curto; não há espaço para especificação completa
5. **Busca semântica fraca** — `searchNodes` usa `LIKE` em `metadata_json` (lento, impreciso)

---

## 2. Arquitetura Proposta: Grafos como Indexadores + Markdown como Detalhamento

### Conceito Central
```
┌─────────────────────────────────────────────────────────────────┐
│                    KNOWLEDGE GRAPH (Indexador)                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ Node: FEAT- │  │ Node: REQ-  │  │ Node: ENT-  │   ...        │
│  │ 001         │  │ 001         │  │ 001         │              │
│  │ type:feature│  │ type:require│  │ type:entity │              │
│  │ name:"Auth" │  │ name:"Login"│  │ name:"User" │              │
│  │ status:DRAFT│  │ status:APPR │  │ status:IMPL │              │
│  │ md_path:    │  │ md_path:    │  │ md_path:    │              │
│  │ ".sdd/docs/ │  │ ".sdd/docs/ │  │ ".sdd/docs/ │              │
│  │  FEAT-001.  │  │  REQ-001.   │  │  ENT-001.   │              │
│  │  md"        │  │  md"        │  │  md"        │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         │                │                │                      │
│         ▼                ▼                ▼                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │           MARKDOWN FILES (.sdd/docs/)                    │    │
│  │  FEAT-001.md  │  REQ-001.md  │  ENT-001.md  │  ...       │    │
│  │  (detalhado)  │  (detalhado)  │  (detalhado)  │           │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Estrutura de Arquivos Markdown
```
.sdd/
├── graph.yaml          # Grafo: nodes + relationships (indexador)
├── graph.db            # SQLite (quando migrado)
├── docs/               # NOVO: Markdown files por node
│   ├── FEAT-001.md
│   ├── REQ-001.md
│   ├── ENT-001.md
│   ├── CHG-001.md
│   └── ...
├── nodes/              # Existente (pode ser depreciado ou mantido para cache)
├── relationships/
└── ...
```

### Formato do Markdown por Node (Template)

```markdown
---
# Front-matter (metadados estruturados para sync bidirecional)
id: "FEAT-001"
type: "feature"
name: "Autenticação de Usuários"
status: "DRAFT"
version: 3
created_at: "2026-09-15T16:01:10.169Z"
updated_at: "2026-10-30T14:22:00.000Z"
graph_version: 1
---

# Feature: Autenticação de Usuários

## Visão Geral
Sistema de autenticação baseado em JWT com suporte a OAuth2 (Google, GitHub) e email/senha.
Inclui refresh tokens, revogação e MFA opcional.

## Requisitos Funcionais
- [ ] RF-001: Login com email/senha
- [ ] RF-002: Login com OAuth2 (Google, GitHub)
- [ ] RF-003: Registro de novo usuário
- [ ] RF-004: Recuperação de senha
- [ ] RF-005: MFA (TOTP)
- [ ] RF-006: Refresh token rotation
- [ ] RF-007: Logout e revogação de tokens

## Regras de Negócio
- **RN-001**: Senha deve ter mínimo 8 chars, 1 maiúscula, 1 número, 1 especial
- **RN-002**: Tokens expiram em 15min (access) / 7dias (refresh)
- **RN-003**: Máximo 5 tentativas de login falhas antes de lockout temporário

## Entidades Envolvidas
- `User` (ENT-001)
- `Session` (ENT-002)
- `AuthProvider` (ENT-003)

## Endpoints da API
- `POST /api/auth/login` (END-001)
- `POST /api/auth/register` (END-002)
- `POST /api/auth/refresh` (END-003)
- `POST /api/auth/logout` (END-004)
- `POST /api/auth/forgot-password` (END-005)

## Decisões de Arquitetura (ADRs)
- [ADR-001](DEC-001.md): Uso de JWT stateless vs session store
- [ADR-002](DEC-002.md): Bcrypt vs Argon2 para hash de senha

## Critérios de Aceite
- [AC-001](ACC-001.md): Login bem-sucedido retorna access + refresh token
- [AC-002](ACC-002.md): Token expirado retorna 401 com código específico

## Testes
- `tests/auth/login.test.ts` (TEST-001)
- `tests/auth/register.test.ts` (TEST-002)
- `tests/auth/refresh.test.ts` (TEST-003)

## Arquivos de Implementação
- `src/server/auth/controller.ts` (FILE-001)
- `src/server/auth/service.ts` (FILE-002)
- `src/server/auth/repository.ts` (FILE-003)
- `src/shared/types/auth.ts` (FILE-004)

## Histórico de Mudanças
| Versão | Data | Autor | Mudança |
|--------|------|-------|---------|
| 1 | 2026-09-15 | System | Criação inicial |
| 2 | 2026-09-20 | LLM | Adicionado OAuth2 |
| 3 | 2026-10-30 | LLM | Adicionado MFA e refresh rotation |
```

---

## 3. Análise de Viabilidade Técnica

### ✅ Pontos Fortes (Facilitam a Implementação)

| Fator | Status Atual | Esforço Estimado |
|-------|--------------|------------------|
| **Persistência dual (YAML/SQLite)** | ✅ Implementada | Baixo - estender repositórios |
| **Schema de nodes tipado** | ✅ 86 tipos definidos | Baixo - adicionar campo `md_path` |
| **Validação de relacionamentos** | ✅ `node-schema.ts` | Baixo - manter igual |
| **Cache e índices** | ✅ `GraphIndices` | Médio - incluir `md_path` no índice |
| **Codegen existente** | ✅ `generator.ts` | Médio - ler/escrever .md em vez de só graph |
| **Ferramentas de query** | ✅ `sdd.query_graph` | Baixo - adicionar leitura de .md |
| **Transações/Integridade** | ✅ `transactions/manager.ts` | Médio - estender para .md |
| **Snapshot/Rollback** | ✅ `sdd.snapshot` | Médio - incluir .md nos snapshots |

### ⚠️ Pontos de Atenção (Requerem Design)

| Desafio | Solução Proposta |
|---------|------------------|
| **Sync bidirecional Graph ↔ Markdown** | Front-matter YAML no .md + validação na carga/salvamento |
| **Concorrência (multi-processo)** | Lock único no repositório (já existe) + escrita atômica .md |
| **Migração de dados existentes** | Script one-time: para cada node, criar .md com `description` + `metadata` |
| **Busca semântica no .md** | Índice invertido separado (opcional, fase 2) ou `grep`/`ripgrep` |
| **Nodes sem .md (legacy)** | `md_path` opcional; fallback para `description`/`metadata` do graph |
| **Renomeação/movimentação de .md** | `md_path` é autoritativo; renomear node atualiza o caminho |

### 🔴 Riscos (Mitigação Necessária)

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| **Dessincronização Graph ↔ .md** | Média | Alto | Validação obrigatória no `saveGraph`; checksum no front-matter |
| **Perda de .md acidental** | Baixa | Alto | `.md` versionado no git; backup automático no `writeGeneratedFiles` |
| **Performance com muitos .md** | Baixa (≤10k nodes) | Médio | Lazy loading; cache de .md lidos; SQLite já escala bem |
| **Complexidade de ferramentas** | Média | Médio | Isolar lógica em `MarkdownRepository` separado |

---

## 4. Plano de Implementação Detalhado

### Fase 1: Fundação (Semana 1-2) — **Não Quebrar Nada**

#### 1.1 Estender Schema do Node
```typescript
// src/sdd/domain/types.ts - Adicionar ao Node base
export interface Node {
  // ... campos existentes
  md_path?: string;  // NOVO: caminho relativo para .sdd/docs/{id}.md
}
```

#### 1.2 Criar `MarkdownRepository` (Novo Arquivo)
```typescript
// src/sdd/persistence/markdown.ts
export class MarkdownRepository {
  constructor(private projectDir: string) {}
  
  getDocPath(nodeId: string): string {
    return join(this.projectDir, ".sdd", "docs", `${nodeId}.md`);
  }
  
  read(nodeId: string): MarkdownNode | null { ... }
  write(node: AnyNode, content: string): void { ... }
  delete(nodeId: string): void { ... }
  exists(nodeId: string): boolean { ... }
  listAll(): string[] { ... }
  
  // Parse front-matter + body
  parse(content: string): { frontMatter: NodeFrontMatter; body: string } { ... }
  serialize(node: AnyNode, body: string): string { ... }
}
```

#### 1.3 Estender Repositórios (YAML + SQLite)
```typescript
// Em YamlGraphRepository.saveGraph() e SqliteGraphRepository.saveGraph():
// 1. Salvar graph normalmente
// 2. Para cada node com md_path ou que precise de .md:
//    - Gerar/atualizar .md com front-matter sincronizado
//    - Validar consistência (id, type, name, status, version)
```

#### 1.4 Validação de Consistência
```typescript
// src/sdd/validation/markdown-sync.ts
export function validateMarkdownSync(graph: KnowledgeGraph, mdRepo: MarkdownRepository): SyncReport {
  // Verificar: todo node com md_path tem .md correspondente
  // Verificar: front-matter.id === node.id
  // Verificar: front-matter.version === node.version
  // Reportar: nodes órfãos (.md sem node), nodes sem .md, divergências
}
```

### Fase 2: Geração de Conteúdo Rico pela LLM (Semana 2-3)

#### 2.1 Novo Tool: `sdd.generate_node_doc`
```typescript
"sdd.generate_node_doc": tool({
  description: "Generate detailed markdown documentation for a graph node using LLM",
  args: {
    node_id: tool.schema.string(),
    template: tool.schema.enum(["feature", "requirement", "entity", "endpoint", "change", "auto"]).optional(),
    force_regenerate: tool.schema.boolean().optional(),
  },
  async execute(args, ctx) {
    const repo = getRepo(ctx.directory);
    const graph = repo.loadGraph();
    const node = graph.nodes.find(n => n.id === args.node_id);
    if (!node) return `Node ${args.node_id} not found`;
    
    // Build context from graph relationships
    const context = buildNodeContext(graph, node);
    
    // Generate markdown using LLM (via system prompt)
    const markdown = await generateMarkdownForNode(node, context, args.template);
    
    // Write .md file
    const mdRepo = new MarkdownRepository(ctx.directory);
    mdRepo.write(node, markdown);
    
    // Update node.md_path if not set
    if (!node.md_path) {
      node.md_path = `.sdd/docs/${node.id}.md`;
      repo.saveGraph(graph);
    }
    
    return `Generated ${mdRepo.getDocPath(node.id)}`;
  }
})
```

#### 2.2 Templates por Tipo de Node
Cada tipo tem template específico (ex: `feature` tem "Requisitos Funcionais", `entity` tem "Campos", `endpoint` tem "Request/Response").

#### 2.3 Integração com Codegen
```typescript
// Em generateProject(): após gerar código, chamar generateNodeDoc para nodes afetados
// Ou: codegen lê .md existente para enriquecer templates
```

### Fase 3: Ferramentas de Consulta e Navegação (Semana 3-4)

#### 3.1 Estender `sdd.query_graph`
```typescript
// Quando node encontrado, se tem md_path, ler e mostrar preview do .md
// Opção `--full` para mostrar markdown completo
```

#### 3.2 Novo Tool: `sdd.read_node_doc`
```typescript
"sdd.read_node_doc": tool({
  description: "Read the full markdown documentation for a node",
  args: { node_id: tool.schema.string() },
  async execute(args, ctx) {
    const mdRepo = new MarkdownRepository(ctx.directory);
    const doc = mdRepo.read(args.node_id);
    return doc ? doc.body : "No documentation found";
  }
})
```

#### 3.3 Busca Semântica (Opcional, Fase 3+)
- Integrar `ripgrep` para busca full-text nos `.md`
- Ou: índice invertido simples (JSON) atualizado no `saveGraph`

### Fase 4: Migração e Validação (Semana 4-5)

#### 4.1 Script de Migração One-Time
```typescript
// src/sdd/migrations/migrate-to-markdown.ts
export function migrateToMarkdown(projectDir: string): MigrationReport {
  const repo = createRepository(projectDir);
  const graph = repo.loadGraph();
  const mdRepo = new MarkdownRepository(projectDir);
  
  let created = 0, updated = 0, skipped = 0;
  
  for (const node of graph.nodes) {
    if (mdRepo.exists(node.id)) {
      // Atualizar front-matter se versão mudou
      const existing = mdRepo.read(node.id);
      if (existing.frontMatter.version !== node.version) {
        mdRepo.write(node, existing.body); // preserva corpo, atualiza front-matter
        updated++;
      } else {
        skipped++;
      }
    } else {
      // Criar .md inicial com description + metadata
      const initialBody = buildInitialMarkdown(node);
      mdRepo.write(node, initialBody);
      // Atualizar node.md_path
      node.md_path = `.sdd/docs/${node.id}.md`;
      created++;
    }
  }
  
  if (created > 0 || updated > 0) repo.saveGraph(graph);
  return { created, updated, skipped };
}
```

#### 4.2 Validação Contínua
- Hook no `saveGraph`: validar sync
- Tool `sdd.validate_markdown_sync` para auditoria manual
- CI/CD: step obrigatório validando sync

### Fase 5: Recursos Avançados (Pós-MVP)

| Recurso | Descrição |
|---------|-----------|
| **Versionamento de .md** | Git history + front-matter `version` + changelog section no .md |
| **Links bidirecionais no .md** | `[[NODE-ID]]` style links renderizados no dashboard |
| **Dashboard 3D com preview .md** | Clicar no node abre painel lateral com .md renderizado |
| **LLM Context Pack** | `sdd.get_context` inclui .md dos nodes relacionados |
| **Diff semântico** | Comparar .md entre snapshots/versões |

---

## 5. Impacto no Código Existente

### Arquivos a Modificar (Estimativa)

| Arquivo | Mudança | Complexidade |
|---------|---------|--------------|
| `src/sdd/domain/types.ts` | + `md_path` no `Node` | Baixa |
| `src/sdd/persistence/repository.ts` | Interface `GraphRepository` + `md_path` | Baixa |
| `src/sdd/persistence/yaml.ts` | `saveGraph` → sync .md | Média |
| `src/sdd/persistence/sqlite.ts` | `saveGraph` → sync .md | Média |
| `src/sdd/persistence/markdown.ts` | **NOVO** | Média |
| `src/sdd/graph/engine.ts` | `addNodeSafe` → criar .md inicial | Baixa |
| `src/sdd/validation/validator.ts` | + `validateMarkdownSync` | Baixa |
| `src/sdd/codegen/generator.ts` | Ler .md para enriquecer templates | Média |
| `src/opencode/tools.ts` | + tools `generate_node_doc`, `read_node_doc` | Baixa |
| `src/sdd/migrations/*.ts` | Script de migração | Baixa |

### Arquivos NOVOS
1. `src/sdd/persistence/markdown.ts` — Repositório de markdown
2. `src/sdd/validation/markdown-sync.ts` — Validação de sync
3. `src/sdd/migrations/migrate-to-markdown.ts` — Migração one-time
4. `src/sdd/templates/node-templates/` — Templates .md por tipo (dir com .md templates)

---

## 6. Estratégia de Migração Segura

### Princípio: **Zero Downtime, Backward Compatible**

1. **Feature Flag** — `config.graph.markdown_enabled: false` (default)
2. **Fase 1** — Implementar infraestrutura com flag OFF
3. **Fase 2** — Testes unitários/integração com flag ON em ambiente isolado
4. **Fase 3** — Migração one-time em projeto real (backup automático)
5. **Fase 4** — Flag ON por default para novos projetos
6. **Fase 5** — Deprecar `description`/`metadata` como fonte primária de detalhes

### Compatibilidade
- Nodes **sem** `md_path` → funcionam como hoje (fallback para `description`/`metadata`)
- Tools atuais (`query_graph`, `analyze_impact`, etc.) → funcionam sem mudança
- Codegen → lê .md se disponível, senão usa graph

---

## 7. Benefícios Esperados

### Para a LLM (Agente)
| Antes | Depois |
|-------|--------|
| `description`: "Auth feature" | .md com 200+ linhas: requisitos, regras, endpoints, testes, arquivos |
| `metadata`: JSON opaco | Front-matter estruturado + corpo rico em markdown |
| Contexto limitado | `sdd.get_context` carrega .md completos dos nodes relacionados |
| Geração de código genérica | Codegen usa .md como spec detalhada |

### Para Humanos
- **Documentação viva** — .md é a fonte da verdade, sempre sincronizada
- **Versionamento real** — Git diff mostra evolução da spec
- **Revisão em PR** — Diff de .md no GitHub/GitLab revisável
- **Busca** — `grep -r "MFA" .sdd/docs/` encontra tudo

### Para o Sistema
- **Traceabilidade completa** — Graph navega relacionamentos; .md dá detalhes
- **Validação** — Sync check garante consistência
- **Escalabilidade** — Graph leve (indexador); .md carrega sob demanda

---

## 8. Estimativa de Esforço

| Fase | Atividades | Dias Úteis |
|------|------------|------------|
| 1. Fundação | Schema, MarkdownRepository, sync nos repositórios | 5-7 |
| 2. Geração LLM | Tool `generate_node_doc`, templates por tipo | 3-5 |
| 3. Consulta | Tools `read_node_doc`, extensão `query_graph` | 2-3 |
| 4. Migração | Script one-time, validação, testes integração | 3-4 |
| 5. Polimento | Docs, exemplos, CI integration, dashboard preview | 2-3 |
| **Total** | | **15-22 dias** |

---

## 9. Decisões de Design Pendentes (Para Alinhamento)

> **Ação necessária**: Confirmar antes de iniciar implementação

1. **Localização dos .md**: `.sdd/docs/` (recomendado) vs `.sdd/nodes/` vs raiz do projeto?
2. **Naming convention**: `{NODE-ID}.md` (ex: `FEAT-001.md`) vs `{type}-{id}.md` (ex: `feature-FEAT-001.md`)?
3. **Front-matter obrigatório**: Sim (para sync) vs Opcional (flexibilidade)?
4. **Template engine**: Handlebars? Nunjucks? String templates simples (recomendado para começar)?
5. **Busca full-text**: Integrar `ripgrep` nativo vs índice invertido customizado vs delegar para IDE?
6. **Dashboard**: Estender dashboard 3D existente para renderizar .md no painel lateral?
7. **Migração automática**: Rodar na primeira inicialização pós-upgrade vs tool manual `sdd.migrate_markdown`?

---

## 10. Conclusão e Recomendação

### ✅ **RECOMENDAÇÃO: PROSSEGUIR**

A arquitetura **Grafos (indexador) + Markdown (detalhamento)** é:
- **Tecnicamente viável** — Infraestrutura 80% pronta
- **Baixo risco** — Mudança evolutiva, backward compatible
- **Alto valor** — Resolve o gargalo principal: "nodes não comportam detalhes suficientes"
- **Alinhada com SDD** — Specs vivas, versionadas, revisáveis, rastreáveis

### Próximos Passos Imediatos
1. **Confirmar decisões de design** (Seção 9)
2. **Criar branch de feature** `feat/graph-markdown-hybrid`
3. **Implementar Fase 1** (Fundação) com feature flag OFF
4. **Validar com projeto real** (este mesmo repositório `opencode-telos`)

---

*Documento gerado em 2026-10-30 — Análise de arquitetura para opencode-telos SDD*

---

## 11. Status da Implementação (Validação)

### ✅ Fase 1: Fundação — **CONCLUÍDA E VALIDADA**

| Item | Status | Arquivo |
|------|--------|---------|
| Campo `md_path` no Node | ✅ Implementado | `src/sdd/domain/types.ts` |
| Interface `GraphRepository` extendida | ✅ Implementado | `src/sdd/persistence/repository.ts` |
| `MarkdownRepository` | ✅ Implementado | `src/sdd/persistence/markdown.ts` |
| Sync no `YamlGraphRepository.saveGraph()` | ✅ Implementado | `src/sdd/persistence/yaml.ts` |
| Sync no `SqliteGraphRepository.saveGraph()` | ✅ Implementado | `src/sdd/persistence/sqlite.ts` |
| `addNodeSafe` define `md_path` automaticamente | ✅ Implementado | `src/sdd/graph/engine.ts` |
| `updateNode` preserva `md_path` | ✅ Implementado | `src/sdd/graph/engine.ts` |
| Validação `validateMarkdownSync` | ✅ Implementado | `src/sdd/validation/markdown-sync.ts` |
| Codegen lê markdown para enriquecer templates | ✅ Implementado | `src/sdd/codegen/generator.ts` |

**Validação TypeScript**: ✅ `npx tsc --noEmit` — **0 erros**

### ✅ Fase 2: Geração de Conteúdo Rico — **CONCLUÍDA**

| Item | Status | Arquivo |
|------|--------|---------|
| Tool `sdd.generate_node_doc` | ✅ Implementado | `src/opencode/tools.ts` |
| Tool `sdd.read_node_doc` | ✅ Implementado | `src/opencode/tools.ts` |
| Tool `sdd.sync_markdown` | ✅ Implementado | `src/opencode/tools.ts` |
| Tool `sdd.validate_markdown_sync` | ✅ Implementado | `src/opencode/tools.ts` |
| Tool `sdd.fix_markdown_sync` | ✅ Implementado | `src/opencode/tools.ts` |
| Templates por tipo (feature, requirement, entity, endpoint, change, default) | ✅ Criados | `src/sdd/templates/node-templates/*.md` |

### ✅ Fase 3: Migração — **CONCLUÍDA**

| Item | Status | Arquivo |
|------|--------|---------|
| Script `migrateToMarkdown` | ✅ Implementado | `src/sdd/migrations/migrate-to-markdown.ts` |

### 📋 Decisões de Design Adotadas (Seção 9)

| Decisão | Escolha |
|---------|---------|
| Localização dos .md | `.sdd/docs/` |
| Naming convention | `{NODE-ID}.md` (ex: `FEAT-001.md`) |
| Front-matter | Obrigatório (para sync automático) |
| Template engine | String templates simples |
| Busca full-text | Delegar para `ripgrep`/IDE (fase futura) |
| Dashboard preview | Não implementado nesta fase |
| Migração automática | Tool manual `sdd.migrate_markdown` (via `sdd.sync_markdown`) |

### 📦 Próximos Passos para Publicação

1. **Commit das mudanças** com mensagem convencional
2. **Bump de versão** (patch: 1.1.17 → 1.1.18)
3. **Publicar no npm** manualmente