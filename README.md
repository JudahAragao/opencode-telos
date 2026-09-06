# OPENCODE TELOS

Plugin de **Spec-Driven Development (SDD)** para o [OpenCode](https://github.com/anomalyco/opencode). Transforma o ambiente de desenvolvimento em um sistema conversacional baseado em Knowledge Graph, onde a especificação sempre vem antes do código.

## O que faz

- **Descoberta conversacional**: analisa seu briefing, detecta o que falta e faz perguntas com menus de seleção (via ferramenta `question` do OpenCode)
- **Knowledge Graph**: mantém um grafo semântico como fonte de verdade do projeto
- **Tech stack configurável**: detecta tecnologias mencionadas, usa conhecimento do AI para stacks não suportadas por templates
- **Referências @**: leitura de arquivos `.md` para extrair especificações de stack
- **Geração de código**: gera código para stacks suportadas (Express+React+SQLite) ou usa AI para stacks arbitrárias
- **Enforcement SDD-first**: bloqueia modificações no código que não passaram pela especificação
- **Change management**: toda mudança vira um Change node rastreável no grafo
- **Impact analysis**: traversa o grafo para mostrar o que será afetado
- **Drift detection**: detecta quando o código desviou da especificação
- **Dashboard web**: visualização 3D do grafo em tempo real com 3d-force-graph
- **Constitution**: define princípios obrigatórios, opcionais e desejados para o projeto
- **Promise tracking**: rastreia promessas de especificação e detecta violações
- **Quality scoring**: calcula score de qualidade (0-100%) com tendência
- **Anti-pattern detection**: identifica nós gods, dependências circulares, especulação
- **AST clone detection**: detecta código duplicado no projeto
- **Contradiction detection**: identifica requisitos e regras conflitantes
- **Test coverage tracking**: mede cobertura de testes por requisito
- **Config drift detection**: detecta inconsistências em configs
- **Session handoff**: gera pacote de estado para continuar trabalho
- **Workflow export**: exporta estado do SDD como relatório estruturado
- **Shell hooks**: instala hooks Git para integração SDD
- **Brownfield scanning**: analisa projetos existentes para integração
- **CI/CD Integration**: gera GitHub Actions, GitLab CI, Jenkins, Docker, CircleCI, Azure DevOps, AWS CodePipeline, Travis CI, NPM Publish, Docker Compose, Maven (Java), Python (pip), Go (GoReleaser) com validação SDD
- **Multi-developer Sync**: sincronização via Git com detecção e resolução de conflitos
- **Rollback**: 3 camadas de reversão (git → snapshot → backup)
- **Permissions**: controle de acesso por roles (admin, architect, developer, viewer) com autenticação GitHub/GitLab
- **Enterprise Workflows**: workflows automáticos para cenários enterprise:
  - **Bug Fixing**: workflow com aprovação automática
  - **Hotfix/Emergência**: bypass de enforcement + documentação retroativa
  - **Refactoring**: verificação de dependências + testes obrigatórios
  - **Deprecation**: plano de migração + notificações
  - **Data Migration**: scripts de migração + rollback
  - **A/B Testing**: experimentos com variantes
  - **Feature Flags**: controle de rollout
  - **Multi-tenancy**: isolamento de dados
  - **Onboarding**: guia para novos desenvolvedores
  - **Security Audit**: auditoria de segurança automatizada
  - **Scalability Analysis**: análise de escalabilidade
  - **Compliance**: validação regulatory (GDPR, HIPAA, SOC2)
  - **Monitoring**: configuração de métricas e alertas
  - **Incident Management**: gestão de incidentes
  - **SLA Tracking**: rastreamento de acordos de nível de serviço
  - **Cost Management**: estimativa de custos
  - **Documentation**: geração de documentação
  - **Knowledge Transfer**: transferência de conhecimento
  - **Disaster Recovery**: plano de recuperação de desastres

## Pré-requisitos

- [OpenCode](https://github.com/anomalyco/opencode) instalado
- [Bun](https://bun.sh) (runtime do plugin)

## Instalação

### Opção 1: Via OpenCode CLI (recomendado)

```bash
opencode plugin add opencode-telos
```

Isso instala o plugin automaticamente no seu OpenCode.

### Opção 2: Via npm

```bash
npm install -g opencode-telos
```

Depois adicione no `opencode.json`:

```json
{
  "plugin": ["opencode-telos"]
}
```

### Opção 3: Plugin local

Clone ou copie a pasta do plugin para um diretório acessível:

```bash
git clone https://github.com/JudahAragao/opencode-telos.git ~/.config/opencode/plugins/opencode-telos
```

Depois adicione no `opencode.json`:

```json
{
  "plugin": ["~/.config/opencode/plugins/opencode-telos"]
}
```

### Opção 4: Plugin no projeto

Copie a pasta `opencode-telos` para dentro do seu projeto:

```bash
cp -r /caminho/opencode-telos ./opencode-telos
```

Depois adicione no `opencode.json`:

```json
{
  "plugin": ["./opencode-telos"]
}
```

## Como funciona a interação

### Toggle SDD (liga/desliga)

O plugin pode ser ligado ou desligado a qualquer momento:

| Comando | Efeito |
|---|---|
| `/sdd on` | Ativa enforcement SDD (toda mudança precisa de spec) |
| `/sdd off` | Desativa enforcement (pode codar livremente) |
| `/sdd status` | Mostra estado atual |

Quando desativado:
- O system prompt SDD não é injetado
- Não há enforcement em writes/edits
- O agente pode modificar código diretamente

Quando ativado:
- Workflow SDD-first obrigatório
- Spec antes de código
- Change nodes para toda modificação

Também disponível via tool: `sdd.toggle(enabled: true|false)`

### Passo 1: Descreva o projeto

Abra o OpenCode na pasta do seu projeto e descreva o que quer criar:

```
Quero criar um sistema de gerenciamento de tarefas.
Cada usuário terá suas próprias tarefas com título, descrição e status.
```

O plugin automaticamente:

1. Detecta que não existe SDD inicializado
2. Roda `sdd.discover` analisando seu briefing
3. Detecta: entidades (usuário, tarefa), domínio (task_management)
4. Detecta tecnologias mencionadas (nenhuma ainda)
5. Retorna perguntas estruturadas para a ferramenta `question`

### Passo 2: Responda com menus de seleção

O OpenCode exibe um menu para cada pergunta faltante:

```
? Qual framework será usado no frontend?
  > React
    Vue.js
    Angular
    Svelte
    Next.js
    [Digite sua própria resposta]
```

```
? Qual framework será usado no backend?
  > Express
    Fastify
    NestJS
    Django
    FastAPI
    [Digite sua própria resposta]
```

```
? Qual banco de dados será utilizado?
  > SQLite
    PostgreSQL
    MySQL
    MongoDB
    [Digite sua própria resposta]
```

```
? Como os usuários farão login no sistema?
  > Email + Senha
    Google OAuth
    JWT
    Sem autenticação
    [Digite sua própria resposta]
```

```
? Como devem funcionar as exclusões no sistema?
  > Hard delete (permanente)
    Soft delete (reversível)
```

Você seleciona uma opção ou digita sua própria resposta. O plugin atualiza o Knowledge Graph automaticamente.

### Passo 3: Especifique a stack via arquivos .md (opcional)

Se preferir definir a stack em um arquivo, crie um `.md` e referencie com `@`:

```
Quero um sistema de tarefas. @tech.md
```

Onde `tech.md` contém:

```markdown
## Stack
- Frontend: Next.js + Tailwind
- Backend: FastAPI (Python)
- Database: PostgreSQL
- Auth: Clerk
```

O plugin lê o arquivo, detecta as tecnologias e **não pergunta** sobre elas.

### Passo 4: Gere o código

Depois que a especificação estiver suficiente:

```
Gere o código do projeto
```

O plugin:

- Se a stack tem templates built-in (Express+React+SQLite): gera os arquivos automaticamente
- Se a stack é diferente: retorna uma especificação detalhada e o AI gera o código usando seu conhecimento sobre as tecnologias escolhidas

### Passo 5: Modifique funcionalidades

```
Adicione um campo de prioridade nas tarefas com valores LOW, MEDIUM e HIGH
```

O plugin **força** o workflow SDD:

1. `sdd.enforce` → classifica como "add_functionality"
2. Cria um Change node (ex: CHG-001)
3. Analisa impacto: entidade Task, API, testes
4. Atualiza a especificação
5. Valida o SDD
6. Regenera o código afetado
7. Completa o Change

### Passo 6: Mudanças arquiteturais

```
Mude o banco de SQLite para PostgreSQL
```

O plugin **bloqueia** e pede aprovação explícita antes de prosseguir.

### Passo 7: Verifique drift

```
Verifique se há drift no projeto
```

O plugin compara o grafo com o código e reporta divergências.

### Completar especificação manualmente

Se achar que a IA não fez todas as perguntas, você pode:

**Validar o que falta:**
```
Valide o SDD e me diga o que está faltando na spec
```
O agente roda `sdd.validate` e lista erros/warnings (ex: entity sem campos, requirement sem task).

**Rodar discovery de novo:**
```
Analise o SDD atual e faça todas as perguntas que faltam
```
O agente inspeciona o grafo com `sdd.inspect`, identifica gaps, e faz perguntas via `question`.

**Verificar completude antes de gerar:**
```
Verifique se a spec está completa antes de gerar código
```

**Adicionar entidades/regras manualmente:**
```
Adicione uma entidade Tenant com campos id (uuid), name (string), created_at (timestamp)
```
O agente roda `sdd.add_node` direto.

**Adicionar relacionamento:**
```
Crie um relacionamento: Tenant contains User
```

**Consultar estado atual:**
```
Mostre o estado atual do SDD
```
O agente roda `sdd.inspect` mostrando stats, nós por tipo e distribuição de status.

## Ferramentas disponíveis

### Inicialização e Gestão do Grafo

| Ferramenta | Descrição |
|---|---|
| `sdd.initialize` | Inicializa o SDD para o projeto |
| `sdd.toggle_status` | Liga/desliga enforcement SDD |
| `sdd.list_snapshots` | Lista snapshots disponíveis para rollback |

### Navegação e Busca

| Ferramenta | Descrição |
|---|---|
| `sdd.inspect` | Mostra estado atual do grafo |
| `sdd.query_graph` | Busca nós por texto, tipo ou ID |
| `sdd.list_nodes` | Lista nós por tipo |
| `sdd.count_nodes` | Conta nós por tipo |
| `sdd.get_nodes_by_status` | Lista nós filtrados por status |
| `sdd.get_context` | Context pack para um nó |
| `sdd.find_path` | Encontra caminho entre nós |
| `sdd.analyze_impact` | Análise de impacto via traversal |

### Graph Traversal

| Ferramenta | Descrição |
|---||
| `sdd.traverse_outgoing` | BFS seguindo arestas de saída |
| `sdd.traverse_incoming` | BFS seguindo arestas de entrada |
| `sdd.traverse_both` | BFS bidirecional |
| `sdd.get_subgraph` | Extrai subgrafo a partir de um nó |

### CRUD de Nós e Relacionamentos

| Ferramenta | Descrição |
|---|---|
| `sdd.add_node` | Adiciona feature, requirement, entity, etc. |
| `sdd.update_node` | Atualiza campos de um nó existente |
| `sdd.remove_node` | Remove um nó do grafo |
| `sdd.add_relationship` | Cria relações entre nós |
| `sdd.remove_relationship` | Remove um relacionamento |

### Descoberta e Briefing

| Ferramenta | Descrição |
|---|---|
| `sdd.discover` | Analisa briefing, retorna perguntas para a ferramenta `question` |
| `sdd.update_from_answers` | Atualiza grafo com respostas |

### Change Management

| Ferramenta | Descrição |
|---|---|
| `sdd.create_change` | Cria Change com approval gates |
| `sdd.approve_change` | Aprova uma mudança |
| `sdd.complete_change` | Marca mudança como completa |
| `sdd.pending_changes` | Lista mudanças pendentes |

### Validação e Qualidade

| Ferramenta | Descrição |
|---|---|
| `sdd.validate` | Valida integridade do SDD |
| `sdd.constitution` | Gerencia constituição do projeto (princípios) |
| `sdd.quality` | Calcula score de qualidade com tendência |
| `sdd.contradictions` | Detecta contradições no grafo |
| `sdd.verify_usage` | Verifica uso de funcionalidades SDD |

### Detecção de Drift

| Ferramenta | Descrição |
|---|---|
| `sdd.detect_drift` | Detecta drift specification ↔ código |
| `sdd.config_drift` | Detecta drift em configs |
| `sdd.detect_sync_conflicts` | Detecta conflitos entre grafo local e remoto |

### Padrões e Anti-Patterns

| Ferramenta | Descrição |
|---|---|
| `sdd.anti_patterns` | Detecta padrões antiéticos no grafo |
| `sdd.clone_detection` | Detecta código duplicado no projeto |

### Código e Geração

| Ferramenta | Descrição |
|---|---|
| `sdd.plan_implementation` | Gera plano de implementação |
| `sdd.generate_code` | Gera código (templates ou via AI para stacks arbitrárias) |
| `sdd.enforce` | Força workflow SDD-first |
| `sdd.enforce_rules` | Mostra regras de enforcement |
| `sdd.full_cycle` | Ciclo completo: enforce → validate → generate → sync |

### Qualidade de Código

| Ferramenta | Descrição |
|---|---|
| `sdd.analyze_complexity` | Analisa complexidade ciclomática e cognitiva |
| `sdd.code_metrics` | Métricas de código (LOC, SLOC, nesting depth) |
| `sdd.detect_smells` | Detecta code smells |
| `sdd.analyze_dependencies` | Analisa grafo de dependências e coupling |
| `sdd.find_dead_code` | Encontra código não utilizado |
| `sdd.remove_dead_code` | Remove código morto identificado |
| `sdd.parse_symbols` | Parseia símbolos (funções, classes, interfaces) |

### Análise

| Ferramenta | Descrição |
|---|---|
| `sdd.check_compliance` | Verificação de compliance (GDPR, LGPD, HIPAA, SOC2) |
| `sdd.security_audit` | Auditoria de segurança |
| `sdd.analyze_scalability` | Análise de escalabilidade |

### Codebase Intelligence

| Ferramenta | Descrição |
|---|---|
| `sdd.analyze_codebase` | Analisa codebase completa e cria nós de arquivo/símbolo |

### Sync e Colaboração

| Ferramenta | Descrição |
|---|---|
| `sdd.sync_status` | Verifica status de sincronização com remote |
| `sdd.sync_pull` | Puxa últimas mudanças do remote |
| `sdd.sync_push` | Envia mudanças SDD para remote |
| `sdd.merge_graphs` | Merge de dois grafos |

### Rollback

| Ferramenta | Descrição |
|---|---|
| `sdd.create_snapshot` | Cria snapshot antes de mudanças |
| `sdd.rollback` | Reverte uma change (git → snapshot → backup) |
| `sdd.rollback_history` | Histórico de rollbacks |

### Permissões

| Ferramenta | Descrição |
|---|---|
| `sdd.load_permissions_config` | Carrega config de permissões |
| `sdd.save_permissions_config` | Salva config de permissões |
| `sdd.check_permission` | Verifica permissão de um usuário |
| `sdd.check_change_approval` | Verifica se mudança precisa de aprovação |
| `sdd.set_role` | Define role de um usuário |
| `sdd.get_user_role` | Retorna role do usuário |
| `sdd.audit_log` | Visualiza log de auditoria |

### Enterprise Workflows

| Ferramenta | Descrição | Approval Level |
|---|---|---|
| `sdd.bug_fix` | Workflow de bug fix completo | AUTO |
| `sdd.hotfix` | Documentar hotfix retroativo | POST_HOC |
| `sdd.refactoring` | Refactoring com verificação de dependências | REVIEW |
| `sdd.deprecate` | Deprecation com plano de migração | APPROVAL |
| `sdd.create_migration` | Migração de dados com rollback | APPROVAL |
| `sdd.create_experiment` | Experimento A/B | REVIEW |
| `sdd.create_flag` | Feature flag | AUTO |
| `sdd.create_tenant` | Multi-tenancy | APPROVAL |
| `sdd.onboard_developer` | Guia de onboarding | - |
| `sdd.report_incident` | Reportar incidente | - |
| `sdd.create_sla` | Criar SLA | - |

### Monitoramento e Observabilidade

| Ferramenta | Descrição |
|---|---|
| `sdd.setup_monitoring` | Configuração de monitoramento |
| `sdd.generate_dashboard` | Gerar dashboard de monitoramento |

### Documentação e Conhecimento

| Ferramenta | Descrição |
|---|---|
| `sdd.generate_docs` | Gerar documentação (API, user guide, dev guide, architecture) |
| `sdd.knowledge_transfer` | Transferência de conhecimento |
| `sdd.session_handoff` | Gera pacote de handoff da sessão |
| `sdd.workflow_export` | Exporta estado do SDD como relatório |

### Custo e CICD

| Ferramenta | Descrição |
|---|---|
| `sdd.estimate_cost` | Estimativa de custos |
| `sdd.generate_cicd` | Gera config CI/CD (GitHub, GitLab, Jenkins, Docker) |
| `sdd.disaster_recovery_plan` | Plano de disaster recovery |

### Infraestrutura

| Ferramenta | Descrição |
|---|---|
| `sdd.install_hooks` | Instala hooks Git para SDD |
| `sdd.brownfield_scan` | Analisa projeto existente |
| `sdd.start_dashboard` | Inicia servidor web com visualização 3D do grafo |
| `sdd.mcp_server_info` | Informações do servidor MCP |
| `sdd.handle_mcp_tool` | Processa tool via protocolo MCP |

### Promessas

| Ferramenta | Descrição |
|---|---|
| `sdd.promises` | Rastreia promessas de especificação |
| `sdd.coverage` | Mede cobertura de testes por requisito |

## Tech Stack e Geração de Código

### Stacks com templates built-in

O plugin gera código automaticamente para:

| Camada | Tecnologias |
|---|---|
| Frontend | React + React Router + hooks customizados |
| Backend | Express ou Fastify + rotas REST + controllers + services + repositories |
| Database | SQLite, PostgreSQL ou MySQL (via drivers nativos) + schema SQL |
| Testes | Bun test |
| Tipos | TypeScript compartilhado |

### Stacks arbitrárias (via AI)

Para qualquer outra combinação (Django, FastAPI, Rails, Go, etc.):

1. O plugin detecta a stack do grafo
2. Se não está no conjunto de templates built-in, retorna uma **spec prompt**
3. A spec prompt lista entidades, endpoints e regras de negócio extraídas do grafo
4. O AI gera o código completo usando seu conhecimento sobre as tecnologias escolhidas
5. Você pode especificar a stack via briefing (`FastAPI com PostgreSQL`) ou via arquivo `@tech.md`

### Detecção automática

O plugin detecta automaticamente no briefing:

- **Frontend**: React, Vue, Angular, Svelte, Next.js, Nuxt, Tailwind, shadcn/ui, etc.
- **Backend**: Express, Fastify, NestJS, Django, FastAPI, Flask, Rails, Laravel, Spring Boot, Go, Rust, etc.
- **Database**: PostgreSQL, MySQL, SQLite, MongoDB, Redis, Supabase, Firebase, Turso, etc.
- **Auth**: JWT, Google/GitHub OAuth, Clerk, Auth0, NextAuth, sessão/cookie, etc.
- **Linguagem**: TypeScript, JavaScript, Python, Go, Rust, Java, Ruby
- **Testes**: Jest, Vitest, Bun test, Cypress, Playwright, pytest, RSpec

Tecnologias que já foram mencionadas **não são perguntadas novamente**.

## Tipos de nós suportados

| Tipo | Descrição |
|---|---|
| `project` | O projeto |
| `domain` | Domínio funcional |
| `feature` | Funcionalidade |
| `requirement` | Requisito |
| `business_rule` | Regra de negócio |
| `actor` | Usuário/sistema externo |
| `entity` | Entidade de domínio |
| `value_object` | Objeto de valor |
| `flow` | Fluxo |
| `use_case` | Caso de uso |
| `architecture_component` | Componente arquitetural |
| `module` | Módulo |
| `api` | Interface API |
| `endpoint` | Endpoint HTTP |
| `database` | Banco de dados |
| `table` | Tabela |
| `field` | Campo |
| `task` | Tarefa de implementação |
| `test` | Teste |
| `file` | Arquivo do código |
| `symbol` | Função, classe, interface |
| `change` | Mudança do sistema |
| `decision` | Decisão arquitetural (ADR) |
| `constraint` | Restrição |
| `assumption` | Premissa registrada |
| `constitution` | Princípios do projeto (must/should/may) |

## Tipos de relações

```
contains, depends_on, requires, implements, implemented_by,
satisfied_by, affects, modifies, creates, deletes, uses,
calls, persists_to, exposes, tested_by, tests, derived_from,
contradicts, supersedes, replaces, blocked_by, belongs_to,
owned_by, triggered_by, flows_to
```

## Fluxo de enforcement

Toda modificação segue obrigatoriamente. **O hook bloqueia programaticamente** qualquer Write/Edit em arquivos fonte que não tenha um Change node aprovado:

```
USUÁRIO: "Adicione X"
    ↓
Write/Edit interceptado pelo hook
    ↓
Hook verifica: arquivo fonte? SDD inicializado? Change aprovado cobrindo esse arquivo?
    ↓
Se NÃO tem Change aprovado → ERRO: operação bloqueada
    ↓
Agente é forçado a seguir o workflow SDD:
    ↓
sdd.enforce → classifica a mudança
    ↓
sdd.discover → coleta informações faltantes
    ↓
question → menus de seleção para o usuário
    ↓
sdd.update_from_answers → atualiza grafo
    ↓
sdd.create_change → cria Change node
    ↓
sdd.approve_change → aprova o Change
    ↓
Write/Edit → operação liberada pelo hook
    ↓
sdd.generate_code → gera/atualiza código
    ↓
sdd.complete_change → marca como completa
```

**O que é bloqueado:** qualquer operação de escrita em arquivos `.ts`, `.js`, `.py`, `.go`, `.rs`, `.java`, `.rb`, `.vue`, `.svelte` (fora de `node_modules`, `.sdd/`, `dist/`, `build/`).

**O que NÃO é bloqueado:** arquivos de config (`package.json`, `tsconfig.json`), `.env`, arquivos `.sdd/`, arquivos fora do projeto.

**O que acontece quando bloqueado:** o agente recebe uma mensagem de erro descrevendo exatamente o que precisa fazer (enforce → approve → retry).

## Autenticação e Roles

### Como funcionam as roles

O sistema de permissões funciona em 3 níveis:

**1. Remote Detection (automático)**
- Plugin detecta automaticamente o repositório remoto (GitHub/GitLab)
- Se detectar, usa a API para verificar permissões do usuário
- Se não detectar ou não tiver token → **todos têm acesso admin**

**2. Roles disponíveis**
| Role | Permissões |
|---|---|
| `admin` | Tudo: criar, aprovar, modificar constituição, rollback, gerenciar permissões |
| `architect` | Criar, aprovar features/requirements, aprovar arquitetura, decisões |
| `developer` | Criar, aprovar features/requirements |
| `viewer` | Apenas visualização |

**3. Fallback automático**
- Sem repositório remoto → todos são admin
- Sem token de autenticação → todos são admin
- Token inválido → fallback para admin
- Usuário não encontrado no remote → verifica role local

### Configuração do token

**GitHub:**
```bash
export GITHUB_TOKEN=ghp_seutokenaqui
```

**GitLab:**
```bash
export GITLAB_TOKEN=glpat-seutokenaqui
```

O token precisa ter permissões de leitura de colaboradores:
- GitHub: `repo` scope
- GitLab: `read_api` scope

### Verificar status

```
sdd.remote_status
```

Mostra se o remote está configurado e se o token está presente.

### Exemplo de uso

```
# Verificar permissão de um usuário
sdd.check_permission(user: "joao", permission: "approve_architecture")

# Definir role manualmente (local)
sdd.set_role(user: "maria", role: "architect")

# Verificar status do remote
sdd.remote_status
```

## Enterprise Workflows

O plugin detecta automaticamente cenários enterprise e sugere workflows específicos:

### Detecção Automática

Quando você digita algo como:
- "Corrija o bug no login" → Detecta **bug fix** e sugere `sdd.bug_fix`
- "Emergência: sistema fora do ar" → Detecta **hotfix** e desabilita enforcement
- "Refatore o módulo de auth" → Detecta **refactoring** e sugere `sdd.refactoring`
- "Deprecie a rota /api/v1" → Detecta **deprecation** e sugere `sdd.deprecate`
- "Migre os dados da tabela users" → Detecta **migration** e sugere `sdd.create_migration`
- "Crie um experimento A/B" → Detecta **A/B testing** e sugere `sdd.create_experiment`
- "Adicione feature flag" → Detecta **feature flag** e sugere `sdd.create_flag`
- "Multi-tenancy ao sistema" → Detecta **multi-tenancy** e sugere `sdd.create_tenant`
- "Onboarding para novo dev" → Detecta **onboarding** e sugere `sdd.onboard_developer`
- "Faça auditoria de segurança" → Detecta **security** e sugere `sdd.security_audit`
- "Analise escalabilidade" → Detecta **scalability** e sugere `sdd.analyze_scalability`
- "Verifique compliance com GDPR" → Detecta **compliance** e sugere `sdd.check_compliance`
- "Configure monitoramento" → Detecta **monitoring** e sugere `sdd.setup_monitoring`
- "Reporte incidente" → Detecta **incident** e sugere `sdd.report_incident`
- "Crie SLA de 99.9%" → Detecta **SLA** e sugere `sdd.create_sla`
- "Estime custos" → Detecta **cost** e sugere `sdd.estimate_cost`
- "Gere documentação" → Detecta **documentation** e sugere `sdd.generate_docs`
- "Transferência de conhecimento" → Detecta **knowledge** e sugere `sdd.knowledge_transfer`
- "Plano de disaster recovery" → Detecta **disaster** e sugere `sdd.disaster_recovery_plan`

### Tools Disponíveis

| Tool | Descrição | Approval Level |
|---|---|---|
| `sdd.bug_fix` | Workflow de bug fix completo | AUTO |
| `sdd.hotfix` | Documentar hotfix retroativo | POST_HOC |
| `sdd.refactoring` | Refactoring com verificação de dependências | REVIEW |
| `sdd.deprecate` | Deprecation com plano de migração | APPROVAL |
| `sdd.create_migration` | Migração de dados com rollback | APPROVAL |
| `sdd.create_experiment` | Experimento A/B | REVIEW |
| `sdd.create_flag` | Feature flag | AUTO |
| `sdd.create_tenant` | Multi-tenancy | APPROVAL |
| `sdd.onboard_developer` | Guia de onboarding | - |
| `sdd.security_audit` | Auditoria de segurança | - |
| `sdd.analyze_scalability` | Análise de escalabilidade | - |
| `sdd.check_compliance` | Verificação de compliance (GDPR, LGPD, HIPAA, SOC2, PCI_DSS, ISO27001) | - |
| `sdd.setup_monitoring` | Configuração de monitoramento | - |
| `sdd.generate_dashboard` | Gerar dashboard de monitoramento | - |
| `sdd.report_incident` | Reportar incidente | - |
| `sdd.create_sla` | Criar SLA | - |
| `sdd.estimate_cost` | Estimativa de custos | - |
| `sdd.generate_docs` | Gerar documentação | - |
| `sdd.knowledge_transfer` | Transferência de conhecimento | - |
| `sdd.disaster_recovery_plan` | Plano de disaster recovery | - |

### Exemplos de Uso

```bash
# Bug fix (aprovação automática)
sdd.bug_fix(description: "Login retorna 500", files: ["src/auth.ts"], severity: "high")

# Hotfix (emergência)
# 1. Enforcement é desabilitado automaticamente
# 2. Aplique a correção
# 3. Documente retroativamente:
sdd.hotfix(description: "Sistema fora do ar", files: ["src/server.ts"], urgency: "critical")

# Refactoring
sdd.refactoring(target: "auth", description: "Extrair validação", type: "extract", files: ["src/auth.ts"])

# Deprecation
sdd.deprecate(target: "/api/v1/users", removal_date: "2025-12-31", endpoints: ["/api/v1/users"])

# Migration
sdd.create_migration(source: "users_v1", target: "users_v2", description: "Adicionar campo email")

# A/B Testing
sdd.create_experiment(
  hypothesis: "Novo botão aumenta conversão",
  variants: [
    { name: "control", description: "Botão azul", traffic_percentage: 50 },
    { name: "variant", description: "Botão verde", traffic_percentage: 50 }
  ],
  metric: "conversion_rate",
  duration: 14
)

# Feature Flag
sdd.create_flag(name: "new_dashboard", description: "Novo dashboard", rollout: 10)

# Multi-tenancy
sdd.create_tenant(name: "empresa_acme", type: "shared_database", isolation: "row")

# Onboarding
sdd.onboard_developer(developer_name: "João")

# Security Audit
sdd.security_audit()

# Scalability Analysis
sdd.analyze_scalability()

# Compliance
sdd.check_compliance(standard: "GDPR")
sdd.check_compliance(standard: "LGPD")

# Monitoring
sdd.setup_monitoring()

# Incident Management
sdd.report_incident(title: "Sistema fora do ar", severity: "SEV1", impact: "Todos os usuários afetados")

# SLA
sdd.create_sla(name: "Uptime", metric: "availability", target: 99.9, period: "monthly")

# Cost Estimation
sdd.estimate_cost()

# Documentation
sdd.generate_docs(type: "api")

# Knowledge Transfer
sdd.knowledge_transfer()

# Disaster Recovery
sdd.disaster_recovery_plan()

# Dashboard Generation
sdd.generate_dashboard(type: "overview")
```

## Estrutura do projeto

```
src/
├ index.ts                          # Entry point do plugin
├ sdd/
│  ├── domain/types.ts              # 38 tipos de nós + relações + grafos
│  ├── graph/engine.ts              # CRUD do Knowledge Graph
│  ├── graph/traverse.ts            # BFS, impact analysis, pathfinding
│  ├── persistence/yaml.ts          # Repositórios YAML + snapshots
│  ├── discovery/briefing.ts        # Análise de briefing + detecção de tech stack + perguntas
│  ├── changes/manager.ts           # Change management + approval gates
│  ├── validation/validator.ts      # Validação estrutural/semântica
│  ├── drift/detector.ts            # Detecção de drift
│  ├── drift/signals.ts             # Sinais avançados de drift
│  ├── enforcement/interceptor.ts   # Força workflow SDD-first
│  ├── codegen/generator.ts         # Templates built-in + spec prompt para AI
│  ├── toggle/state.ts              # Liga/desliga enforcement SDD
│  ├── constitution/validator.ts    # Validação de princípios
│  ├── promises/tracker.ts          # Rastreamento de promessas
│  ├── quality/scorer.ts            # Score de qualidade com tendência
│  ├── session/handoff.ts           # Handoff de sessão
│  ├── patterns/anti-patterns.ts    # Detecção de anti-padrões
│  ├── patterns/ast-clones.ts       # Detecção de clones AST
│  ├── patterns/contradictions.ts   # Detecção de contradições
│  ├── patterns/config-drift.ts     # Detecção de drift em configs
│  ├── coverage/tracker.ts          # Cobertura de testes
│  ├── workflow/exporter.ts         # Exportação de workflow
│  ├── brownfield/scanner.ts        # Análise de projetos existentes
│  ├── cicd/generators.ts           # Geração CI/CD (GitHub, GitLab, Jenkins, Docker)
│  ├── sync/git-sync.ts             # Sincronização Git + conflitos
│  ├── rollback/manager.ts          # Rollback 3 camadas (git → snapshot → backup)
│  ├── permissions/access.ts        # Controle de acesso + auditoria
│  ├── workflows/
│  │   ├── bug-fix.ts               # Workflow de bug fix
│  │   ├── hotfix.ts                # Workflow de hotfix
│  │   ├── refactoring.ts           # Workflow de refactoring
│  │   ├── deprecation.ts           # Workflow de deprecation
│  │   ├── data-migration.ts        # Workflow de migração de dados
│  │   ├── ab-testing.ts            # Workflow de A/B testing
│  │   ├── feature-flags.ts         # Workflow de feature flags
│  │   ├── multi-tenancy.ts         # Workflow de multi-tenancy
│  │   └── onboarding.ts            # Workflow de onboarding
│  ├── analysis/
│  │   ├── security.ts              # Auditoria de segurança
│  │   ├── scalability.ts           # Análise de escalabilidade
│  │   └── compliance.ts            # Validação regulatory
│  ├── monitoring/
│  │   └── setup.ts                 # Configuração de monitoramento
│  ├── incidents/
│  │   └── manager.ts               # Gestão de incidentes
│  ├── sla/
│  │   └── tracker.ts               # Rastreamento de SLA
│  ├── cost/
│  │   └── estimator.ts             # Estimativa de custos
│  ├── documentation/
│  │   └── generator.ts             # Geração de documentação
│  ├── knowledge/
│  │   └── transfer.ts              # Transferência de conhecimento
│  ├── disaster/
│  │   └── recovery.ts              # Plano de disaster recovery
│  └── transactions/manager.ts      # Transações lógicas
├ opencode/
│  ├── tools.ts                     # 95 ferramentas para o agente
│  ├── hooks.ts                     # Hooks do OpenCode
│  ├── system-prompt.ts             # Instruções SDD + integração question tool
│  └── shell-hooks.ts               # Hooks Git para SDD
├ mcp/
│  └── server.ts                    # Servidor MCP
├ code-intelligence/
│  └── analyzer.ts                  # Análise de código (AST básico)
└ server/
   └── server.ts                    # Dashboard web (API + UI)
```

## Estrutura `.sdd/`

Quando inicializado, o plugin cria:

```
.sdd/
├ graph.yaml              # O Knowledge Graph completo
├ enabled                 # Estado do toggle (JSON: {enabled, changed_at})
├ nodes/                  # Nós individuais (futuro)
├ relationships/          # Relações (futuro)
├ changes/                # Histórico de mudanças
├ snapshots/              # Snapshots do estado
└ transactions/           # Transações lógicas
```

## Desenvolvimento

```bash
# Instalar dependências
bun install

# Verificar tipos
bun run typecheck

# Rodar testes
bun test
```

## Licença

MIT
