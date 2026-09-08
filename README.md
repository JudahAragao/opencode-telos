# OPENCODE TELOS

A **Spec-Driven Development (SDD)** plugin for [OpenCode](https://github.com/anomalyco/opencode). It turns the development environment into a conversational system based on a Knowledge Graph, where the specification always comes before the code.

## What it does

- **Conversational discovery**: analyzes your briefing, detects what is missing and asks questions with selection menus (via the OpenCode `question` tool)
- **Knowledge Graph**: keeps a semantic graph as the source of truth for the project
- **Configurable tech stack**: detects mentioned technologies, uses the AI's knowledge for stacks not supported by templates
- **@ references**: reads `.md` files to extract stack specifications
- **Code generation**: generates code for supported stacks (Express+React+SQLite) or uses AI for arbitrary stacks
- **SDD-first enforcement**: blocks code modifications that did not go through the specification
- **Change management**: every change becomes a trackable Change node in the graph
- **Impact analysis**: traverses the graph to show what will be affected
- **Drift detection**: detects when the code deviated from the specification
- **Web dashboard**: real-time 3D graph visualization with 3d-force-graph
- **Constitution**: defines mandatory, optional and preferred principles for the project
- **Promise tracking**: tracks specification promises and detects violations
- **Quality scoring**: calculates a quality score (0-100%) with trend
- **Anti-pattern detection**: identifies god nodes, circular dependencies, speculation
- **AST clone detection**: detects duplicated code in the project
- **Contradiction detection**: identifies conflicting requirements and rules
- **Test coverage tracking**: measures test coverage by requirement
- **Config drift detection**: detects inconsistencies in configs
- **Session handoff**: generates a state package to continue work
- **Workflow export**: exports the SDD state as a structured report
- **Shell hooks**: installs Git hooks for SDD integration
- **Brownfield scanning**: analyzes existing projects for integration
- **CI/CD Integration**: generates GitHub Actions, GitLab CI, Jenkins, Docker, CircleCI, Azure DevOps, AWS CodePipeline, Travis CI, NPM Publish, Docker Compose, Maven (Java), Python (pip), Go (GoReleaser) with SDD validation
- **Multi-developer Sync**: Git-based synchronization with conflict detection and resolution
- **Rollback**: 3 rollback layers (git → snapshot → backup)
- **Permissions**: role-based access control (admin, architect, developer, viewer) with GitHub/GitLab authentication
- **Enterprise Workflows**: automated workflows for enterprise scenarios:
  - **Bug Fixing**: workflow with automatic approval
  - **Hotfix/Emergency**: enforcement bypass + retrospective documentation
  - **Refactoring**: dependency verification + mandatory tests
  - **Deprecation**: migration plan + notifications
  - **Data Migration**: migration scripts + rollback
  - **A/B Testing**: experiments with variants
  - **Feature Flags**: rollout control
  - **Multi-tenancy**: data isolation
  - **Onboarding**: guide for new developers
  - **Security Audit**: automated security audit
  - **Scalability Analysis**: scalability analysis
  - **Compliance**: regulatory validation (GDPR, HIPAA, SOC2)
  - **Monitoring**: metrics and alert configuration
  - **Incident Management**: incident management
  - **SLA Tracking**: service level agreement tracking
  - **Cost Management**: cost estimation
  - **Documentation**: documentation generation
  - **Knowledge Transfer**: knowledge transfer
  - **Disaster Recovery**: disaster recovery plan

## Prerequisites

- [OpenCode](https://github.com/anomalyco/opencode) installed
- [Bun](https://bun.sh) (plugin runtime)

## Installation

### Option 1: Via OpenCode CLI (recommended)

```bash
opencode plugin add opencode-telos
```

This installs the plugin automatically in your OpenCode.

### Option 2: Via npm

```bash
npm install -g opencode-telos
```

Then add it to your `opencode.json`:

```json
{
  "plugin": ["opencode-telos"]
}
```

### Option 3: Local plugin

Clone or copy the plugin folder into an accessible directory:

```bash
git clone https://github.com/JudahAragao/opencode-telos.git ~/.config/opencode/plugins/opencode-telos
```

Then add it to your `opencode.json`:

```json
{
  "plugin": ["~/.config/opencode/plugins/opencode-telos"]
}
```

### Option 4: Project-local plugin

Copy the `opencode-telos` folder into your project:

```bash
cp -r /path/to/opencode-telos ./opencode-telos
```

Then add it to your `opencode.json`:

```json
{
  "plugin": ["./opencode-telos"]
}
```

## How the interaction works

### SDD toggle (on/off)

The plugin can be enabled or disabled at any time. The plugin registers a
**command hub** on the `command.execute.before` hook: a single `sdd` command
that routes to deterministic subcommands (executed by the plugin, without
depending on the LLM to perform the action):

| Command | Subcommand | Effect |
|---|---|---|
| `/sdd` | `panel` / `help` | Shows the panel with the available subcommands |
| `/sdd on` | `on` / `enable` | Enables SDD enforcement (every change requires a spec) |
| `/sdd off` | `off` / `disable` | Disables enforcement (you can code freely) |
| `/sdd status` | `status` | Shows the current toggle state |
| `/sdd cache_reset` | `cache_reset` | Clears caches without killing the session |

> **Note:** because slash `/` commands in OpenCode are *prompt commands* by
> definition, invoking them makes OpenCode **also trigger an LLM turn** after
> the `command.execute.before` hook. The deterministic action itself
> (enable/disable) is performed by the hook without depending on the model; the
> extra turn is an inherent behavior of the OpenCode command flow.

**Recommended way (no LLM turn):** the same operations are available as
**tools/MCP**, called by the agent deterministically:

| Tool | Effect |
|---|---|
| `sdd.toggle` | Enables/disables enforcement |
| `sdd.toggle_status` | Shows the current toggle state |

When disabled:
- The SDD system prompt is not injected
- There is no enforcement on writes/edits
- The agent can modify code directly

When enabled:
- Mandatory SDD-first workflow
- Spec before code
- Change nodes for every modification

The toggle state is persisted in `.sdd/enabled` inside the project.

### Step 1: Describe the project

Open OpenCode in your project folder and describe what you want to create:

```
I want to create a task management system.
Each user will have their own tasks with title, description and status.
```

The plugin automatically:

1. Detects that SDD is not initialized
2. Runs `sdd.discover` analyzing your briefing
3. Detects: entities (user, task), domain (task_management)
4. Detects mentioned technologies (none yet)
5. Returns structured questions for the `question` tool

### Step 2: Answer with selection menus

OpenCode displays a menu for each missing question:

```
? Which framework will be used on the frontend?
  > React
    Vue.js
    Angular
    Svelte
    Next.js
    [Type your own answer]
```

```
? Which framework will be used on the backend?
  > Express
    Fastify
    NestJS
    Django
    FastAPI
    [Type your own answer]
```

```
? Which database will be used?
  > SQLite
    PostgreSQL
    MySQL
    MongoDB
    [Type your own answer]
```

```
? How will users log in to the system?
  > Email + Password
    Google OAuth
    JWT
    No authentication
    [Type your own answer]
```

```
? How should deletions work in the system?
  > Hard delete (permanent)
    Soft delete (reversible)
```

You select an option or type your own answer. The plugin updates the Knowledge Graph automatically.

### Step 3: Specify the stack via .md files (optional)

If you prefer to define the stack in a file, create a `.md` and reference it with `@`:

```
I want a task system. @tech.md
```

Where `tech.md` contains:

```markdown
## Stack
- Frontend: Next.js + Tailwind
- Backend: FastAPI (Python)
- Database: PostgreSQL
- Auth: Clerk
```

The plugin reads the file, detects the technologies and **does not ask** about them.

### Step 4: Generate the code

Once the specification is sufficient:

```
Generate the project code
```

The plugin:

- If the stack has built-in templates (Express+React+SQLite): generates the files automatically
- If the stack is different: returns a detailed specification and the AI generates the code using its knowledge of your chosen technologies

### Step 5: Modify features

```
Add a priority field to tasks with LOW, MEDIUM and HIGH values
```

The plugin **forces** the SDD workflow:

1. `sdd.enforce` → classifies as "add_functionality"
2. Creates a Change node (e.g. CHG-001)
3. Analyzes impact: Task entity, API, tests
4. Updates the specification
5. Validates the SDD
6. Regenerates the affected code
7. Completes the Change

### Step 6: Architectural changes

```
Change the database from SQLite to PostgreSQL
```

The plugin **blocks** and asks for explicit approval before proceeding.

### Step 7: Check drift

```
Check if there is any drift in the project
```

The plugin compares the graph with the code and reports divergences.

### Complete the specification manually

If you think the AI did not ask all the questions, you can:

**Validate what is missing:**
```
Validate the SDD and tell me what is missing in the spec
```
The agent runs `sdd.validate` and lists errors/warnings (e.g. entity without fields, requirement without task).

**Run discovery again:**
```
Analyze the current SDD and ask all the missing questions
```
The agent inspects the graph with `sdd.inspect`, identifies gaps, and asks questions via `question`.

**Check completeness before generating:**
```
Check if the spec is complete before generating code
```

**Add entities/rules manually:**
```
Add a Tenant entity with fields id (uuid), name (string), created_at (timestamp)
```
The agent runs `sdd.add_node` directly.

**Add a relationship:**
```
Create a relationship: Tenant contains User
```

**Query the current state:**
```
Show the current SDD state
```
The agent runs `sdd.inspect` showing stats, nodes by type and status distribution.

## Available tools

### Graph initialization and management

| Tool | Description |
|---|---|
| `sdd.initialize` | Initializes SDD for the project |
| `sdd.toggle_status` | Enables/disables SDD enforcement |
| `sdd.list_snapshots` | Lists snapshots available for rollback |

### Navigation and search

| Tool | Description |
|---|---|
| `sdd.inspect` | Shows the current state of the graph |
| `sdd.query_graph` | Searches nodes by text, type or ID |
| `sdd.list_nodes` | Lists nodes by type |
| `sdd.count_nodes` | Counts nodes by type |
| `sdd.get_nodes_by_status` | Lists nodes filtered by status |
| `sdd.get_context` | Context pack for a node |
| `sdd.find_path` | Finds a path between nodes |
| `sdd.analyze_impact` | Impact analysis via traversal |

### Graph traversal

| Tool | Description |
|---|---|
| `sdd.traverse_outgoing` | BFS following outgoing edges |
| `sdd.traverse_incoming` | BFS following incoming edges |
| `sdd.traverse_both` | Bidirectional BFS |
| `sdd.get_subgraph` | Extracts a subgraph from a node |

### Node and relationship CRUD

| Tool | Description |
|---|---|
| `sdd.add_node` | Adds feature, requirement, entity, etc. |
| `sdd.update_node` | Updates fields of an existing node |
| `sdd.remove_node` | Removes a node from the graph |
| `sdd.add_relationship` | Creates relationships between nodes |
| `sdd.remove_relationship` | Removes a relationship |

### Discovery and briefing

| Tool | Description |
|---|---|
| `sdd.discover` | Analyzes briefing, returns questions for the `question` tool |
| `sdd.update_from_answers` | Updates the graph with answers |

### Change management

| Tool | Description |
|---|---|
| `sdd.create_change` | Creates a Change with approval gates |
| `sdd.approve_change` | Approves a change |
| `sdd.complete_change` | Marks a change as complete |
| `sdd.pending_changes` | Lists pending changes |

### Validation and quality

| Tool | Description |
|---|---|
| `sdd.validate` | Validates SDD integrity |
| `sdd.constitution` | Manages the project constitution (principles) |
| `sdd.quality` | Calculates the quality score with trend |
| `sdd.contradictions` | Detects contradictions in the graph |
| `sdd.verify_usage` | Verifies SDD feature usage |

### Drift detection

| Tool | Description |
|---|---|
| `sdd.detect_drift` | Detects specification ↔ code drift |
| `sdd.config_drift` | Detects drift in configs |
| `sdd.detect_sync_conflicts` | Detects conflicts between local and remote graphs |

### Patterns and anti-patterns

| Tool | Description |
|---|---|
| `sdd.anti_patterns` | Detects anti-patterns in the graph |
| `sdd.clone_detection` | Detects duplicated code in the project |

### Code and generation

| Tool | Description |
|---|---|
| `sdd.plan_implementation` | Generates an implementation plan |
| `sdd.generate_code` | Generates code (templates or via AI for arbitrary stacks) |
| `sdd.enforce` | Enforces the SDD-first workflow |
| `sdd.enforce_rules` | Shows the enforcement rules |
| `sdd.full_cycle` | Full cycle: enforce → validate → generate → sync |

### Code quality

| Tool | Description |
|---|---|
| `sdd.analyze_complexity` | Analyzes cyclomatic and cognitive complexity |
| `sdd.code_metrics` | Code metrics (LOC, SLOC, nesting depth) |
| `sdd.detect_smells` | Detects code smells |
| `sdd.analyze_dependencies` | Analyzes the dependency graph and coupling |
| `sdd.find_dead_code` | Finds unused code |
| `sdd.remove_dead_code` | Removes identified dead code |
| `sdd.parse_symbols` | Parses symbols (functions, classes, interfaces) |

### Analysis

| Tool | Description |
|---|---|
| `sdd.check_compliance` | Compliance check (GDPR, LGPD, HIPAA, SOC2) |
| `sdd.security_audit` | Security audit |
| `sdd.analyze_scalability` | Scalability analysis |

### Codebase intelligence

| Tool | Description |
|---|---|
| `sdd.analyze_codebase` | Analyzes the complete codebase and creates file/symbol nodes |

### Sync and collaboration

| Tool | Description |
|---|---|
| `sdd.sync_status` | Checks sync status with remote |
| `sdd.sync_pull` | Pulls latest changes from remote |
| `sdd.sync_push` | Pushes SDD changes to remote |
| `sdd.merge_graphs` | Merges two graphs |

### Rollback

| Tool | Description |
|---|---|
| `sdd.create_snapshot` | Creates a snapshot before changes |
| `sdd.rollback` | Rolls back a change (git → snapshot → backup) |
| `sdd.rollback_history` | Rollback history |

### Permissions

| Tool | Description |
|---|---|
| `sdd.load_permissions_config` | Loads the permissions config |
| `sdd.save_permissions_config` | Saves the permissions config |
| `sdd.check_permission` | Checks a user's permission |
| `sdd.check_change_approval` | Checks whether a change requires approval |
| `sdd.set_role` | Sets a user's role |
| `sdd.get_user_role` | Returns a user's role |
| `sdd.audit_log` | Views the audit log |

### Enterprise workflows

| Tool | Description | Approval level |
|---|---|---|
| `sdd.bug_fix` | Full bug fix workflow | AUTO |
| `sdd.hotfix` | Retrospective hotfix documentation | POST_HOC |
| `sdd.refactoring` | Refactoring with dependency verification | REVIEW |
| `sdd.deprecate` | Deprecation with migration plan | APPROVAL |
| `sdd.create_migration` | Data migration with rollback | APPROVAL |
| `sdd.create_experiment` | A/B experiment | REVIEW |
| `sdd.create_flag` | Feature flag | AUTO |
| `sdd.create_tenant` | Multi-tenancy | APPROVAL |
| `sdd.onboard_developer` | Onboarding guide | - |
| `sdd.report_incident` | Report an incident | - |
| `sdd.create_sla` | Create an SLA | - |

### Monitoring and observability

| Tool | Description |
|---|---|
| `sdd.setup_monitoring` | Monitoring configuration |
| `sdd.generate_dashboard` | Generate monitoring dashboard |

### Documentation and knowledge

| Tool | Description |
|---|---|
| `sdd.generate_docs` | Generate documentation (API, user guide, dev guide, architecture) |
| `sdd.knowledge_transfer` | Knowledge transfer |
| `sdd.session_handoff` | Generates a session handoff package |
| `sdd.workflow_export` | Exports the SDD state as a report |

### Cost and CI/CD

| Tool | Description |
|---|---|
| `sdd.estimate_cost` | Cost estimation |
| `sdd.generate_cicd` | Generates CI/CD config (GitHub, GitLab, Jenkins, Docker) |
| `sdd.disaster_recovery_plan` | Disaster recovery plan |

### Infrastructure

| Tool | Description |
|---|---|
| `sdd.install_hooks` | Installs Git hooks for SDD |
| `sdd.brownfield_scan` | Analyzes an existing project |
| `sdd.start_dashboard` | Starts the web server with 3D graph visualization |
| `sdd.mcp_server_info` | MCP server information |
| `sdd.handle_mcp_tool` | Processes a tool via the MCP protocol |

### Promises

| Tool | Description |
|---|---|
| `sdd.promises` | Tracks specification promises |
| `sdd.coverage` | Measures test coverage by requirement |

## Tech stack and code generation

### Stacks with built-in templates

The plugin generates code automatically for:

| Layer | Technologies |
|---|---|
| Frontend | React + React Router + custom hooks |
| Backend | Express or Fastify + REST routes + controllers + services + repositories |
| Database | SQLite, PostgreSQL or MySQL (via native drivers) + SQL schema |
| Tests | Bun test |
| Types | Shared TypeScript |

### Arbitrary stacks (via AI)

For any other combination (Django, FastAPI, Rails, Go, etc.):

1. The plugin detects the stack from the graph
2. If it is not in the built-in template set, it returns a **spec prompt**
3. The spec prompt lists entities, endpoints and business rules extracted from the graph
4. The AI generates the complete code using its knowledge of your chosen technologies
5. You can specify the stack via the briefing (`FastAPI with PostgreSQL`) or via a `@tech.md` file

### Automatic detection

The plugin automatically detects in the briefing:

- **Frontend**: React, Vue, Angular, Svelte, Next.js, Nuxt, Tailwind, shadcn/ui, etc.
- **Backend**: Express, Fastify, NestJS, Django, FastAPI, Flask, Rails, Laravel, Spring Boot, Go, Rust, etc.
- **Database**: PostgreSQL, MySQL, SQLite, MongoDB, Redis, Supabase, Firebase, Turso, etc.
- **Auth**: JWT, Google/GitHub OAuth, Clerk, Auth0, NextAuth, session/cookie, etc.
- **Language**: TypeScript, JavaScript, Python, Go, Rust, Java, Ruby
- **Tests**: Jest, Vitest, Bun test, Cypress, Playwright, pytest, RSpec

Technologies that have already been mentioned **are not asked again**.

## Supported node types

| Type | Description |
|---|---|
| `project` | The project |
| `domain` | Functional domain |
| `feature` | Feature |
| `requirement` | Requirement |
| `business_rule` | Business rule |
| `actor` | External user/system |
| `entity` | Domain entity |
| `value_object` | Value object |
| `flow` | Flow |
| `use_case` | Use case |
| `architecture_component` | Architectural component |
| `module` | Module |
| `api` | API interface |
| `endpoint` | HTTP endpoint |
| `database` | Database |
| `table` | Table |
| `field` | Field |
| `task` | Implementation task |
| `test` | Test |
| `file` | Code file |
| `symbol` | Function, class, interface |
| `change` | System change |
| `decision` | Architectural decision (ADR) |
| `constraint` | Constraint |
| `assumption` | Recorded assumption |
| `constitution` | Project principles (must/should/may) |

## Relationship types

```
contains, depends_on, requires, implements, implemented_by,
satisfied_by, affects, modifies, creates, deletes, uses,
calls, persists_to, exposes, tested_by, tests, derived_from,
contradicts, supersedes, replaces, blocked_by, belongs_to,
owned_by, triggered_by, flows_to
```

## Enforcement flow

Every modification must follow it. **The hook blocks programmatically** any Write/Edit to source files that does not have an approved Change node:

```
USER: "Add X"
    ↓
Write/Edit intercepted by the hook
    ↓
Hook checks: source file? SDD initialized? Approved Change covering this file?
    ↓
If there is NO approved Change → ERROR: operation blocked
    ↓
The agent is forced to follow the SDD workflow:
    ↓
sdd.enforce → classifies the change
    ↓
sdd.discover → collects missing information
    ↓
question → selection menus for the user
    ↓
sdd.update_from_answers → updates the graph
    ↓
sdd.create_change → creates a Change node
    ↓
sdd.approve_change → approves the Change
    ↓
Write/Edit → operation released by the hook
    ↓
sdd.generate_code → generates/updates code
    ↓
sdd.complete_change → marks as complete
```

**What is blocked:** any write operation on `.ts`, `.js`, `.py`, `.go`, `.rs`, `.java`, `.rb`, `.vue`, `.svelte` files (outside `node_modules`, `.sdd/`, `dist/`, `build/`).

**What is NOT blocked:** config files (`package.json`, `tsconfig.json`), `.env`, `.sdd/` files, files outside the project.

**What happens when blocked:** the agent receives an error message describing exactly what it needs to do (enforce → approve → retry).

## Authentication and roles

### How roles work

The permissions system works on 3 levels:

**1. Remote Detection (automatic)**
- The plugin automatically detects the remote repository (GitHub/GitLab)
- If detected, it uses the API to check the user's permissions
- If not detected or no token → **everyone has admin access**

**2. Available roles**
| Role | Permissions |
|---|---|
| `admin` | Everything: create, approve, modify constitution, rollback, manage permissions |
| `architect` | Create/approve features/requirements, approve architecture, decisions |
| `developer` | Create/approve features/requirements |
| `viewer` | View only |

**3. Automatic fallback**
- No remote repository → everyone is admin
- No auth token → everyone is admin
- Invalid token → fallback to admin
- User not found on remote → checks local role

### Token configuration

**GitHub:**
```bash
export GITHUB_TOKEN=ghp_yourtokenhere
```

**GitLab:**
```bash
export GITLAB_TOKEN=glpat-yourtokenhere
```

The token needs collaborator-read permissions:
- GitHub: `repo` scope
- GitLab: `read_api` scope

### Check status

```
sdd.remote_status
```

Shows whether the remote is configured and whether the token is present.

### Usage example

```
# Check a user's permission
sdd.check_permission(user: "joao", permission: "approve_architecture")

# Set a role manually (local)
sdd.set_role(user: "maria", role: "architect")

# Check remote status
sdd.remote_status
```

## Enterprise workflows

The plugin automatically detects enterprise scenarios and suggests specific workflows:

### Automatic detection

When you type something like:
- "Fix the login bug" → Detects **bug fix** and suggests `sdd.bug_fix`
- "Emergency: system is down" → Detects **hotfix** and disables enforcement
- "Refactor the auth module" → Detects **refactoring** and suggests `sdd.refactoring`
- "Deprecate the /api/v1 route" → Detects **deprecation** and suggests `sdd.deprecate`
- "Migrate the users table data" → Detects **migration** and suggests `sdd.create_migration`
- "Create an A/B experiment" → Detects **A/B testing** and suggests `sdd.create_experiment`
- "Add a feature flag" → Detects **feature flag** and suggests `sdd.create_flag`
- "Add multi-tenancy to the system" → Detects **multi-tenancy** and suggests `sdd.create_tenant`
- "Onboarding for a new dev" → Detects **onboarding** and suggests `sdd.onboard_developer`
- "Run a security audit" → Detects **security** and suggests `sdd.security_audit`
- "Analyze scalability" → Detects **scalability** and suggests `sdd.analyze_scalability`
- "Check GDPR compliance" → Detects **compliance** and suggests `sdd.check_compliance`
- "Set up monitoring" → Detects **monitoring** and suggests `sdd.setup_monitoring`
- "Report an incident" → Detects **incident** and suggests `sdd.report_incident`
- "Create a 99.9% SLA" → Detects **SLA** and suggests `sdd.create_sla`
- "Estimate costs" → Detects **cost** and suggests `sdd.estimate_cost`
- "Generate documentation" → Detects **documentation** and suggests `sdd.generate_docs`
- "Knowledge transfer" → Detects **knowledge** and suggests `sdd.knowledge_transfer`
- "Disaster recovery plan" → Detects **disaster** and suggests `sdd.disaster_recovery_plan`

### Available tools

| Tool | Description | Approval level |
|---|---|---|
| `sdd.bug_fix` | Full bug fix workflow | AUTO |
| `sdd.hotfix` | Retrospective hotfix documentation | POST_HOC |
| `sdd.refactoring` | Refactoring with dependency verification | REVIEW |
| `sdd.deprecate` | Deprecation with migration plan | APPROVAL |
| `sdd.create_migration` | Data migration with rollback | APPROVAL |
| `sdd.create_experiment` | A/B experiment | REVIEW |
| `sdd.create_flag` | Feature flag | AUTO |
| `sdd.create_tenant` | Multi-tenancy | APPROVAL |
| `sdd.onboard_developer` | Onboarding guide | - |
| `sdd.security_audit` | Security audit | - |
| `sdd.analyze_scalability` | Scalability analysis | - |
| `sdd.check_compliance` | Compliance check (GDPR, LGPD, HIPAA, SOC2, PCI_DSS, ISO27001) | - |
| `sdd.setup_monitoring` | Monitoring configuration | - |
| `sdd.generate_dashboard` | Generate monitoring dashboard | - |
| `sdd.report_incident` | Report an incident | - |
| `sdd.create_sla` | Create an SLA | - |
| `sdd.estimate_cost` | Cost estimation | - |
| `sdd.generate_docs` | Generate documentation | - |
| `sdd.knowledge_transfer` | Knowledge transfer | - |
| `sdd.disaster_recovery_plan` | Disaster recovery plan | - |

### Usage examples

```bash
# Bug fix (automatic approval)
sdd.bug_fix(description: "Login returns 500", files: ["src/auth.ts"], severity: "high")

# Hotfix (emergency)
# 1. Enforcement is disabled automatically
# 2. Apply the fix
# 3. Document retroactively:
sdd.hotfix(description: "System is down", files: ["src/server.ts"], urgency: "critical")

# Refactoring
sdd.refactoring(target: "auth", description: "Extract validation", type: "extract", files: ["src/auth.ts"])

# Deprecation
sdd.deprecate(target: "/api/v1/users", removal_date: "2025-12-31", endpoints: ["/api/v1/users"])

# Migration
sdd.create_migration(source: "users_v1", target: "users_v2", description: "Add email field")

# A/B Testing
sdd.create_experiment(
  hypothesis: "New button increases conversion",
  variants: [
    { name: "control", description: "Blue button", traffic_percentage: 50 },
    { name: "variant", description: "Green button", traffic_percentage: 50 }
  ],
  metric: "conversion_rate",
  duration: 14
)

# Feature Flag
sdd.create_flag(name: "new_dashboard", description: "New dashboard", rollout: 10)

# Multi-tenancy
sdd.create_tenant(name: "acme_corp", type: "shared_database", isolation: "row")

# Onboarding
sdd.onboard_developer(developer_name: "John")

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
sdd.report_incident(title: "System is down", severity: "SEV1", impact: "All users affected")

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

## Project structure

```
src/
├ index.ts                              # Plugin entry point (synchronous init — no HTTP await)
├ server-entry.ts                       # "./server" subpath with utilities (createMcpServer, dashboard, analyzeCodebase)
├ sdd/
│  ├── domain/types.ts                  # Node types + relationships + graphs
│  ├── graph/                           # Knowledge Graph CRUD and navigation
│  │   ├── engine.ts                      # Engines / integrity
│  │   ├── traverse.ts                    # BFS, impact analysis, pathfinding
│  │   ├── integrity.ts / integrity-guard.ts / pruner.ts
│  ├── persistence/                     # Storage backends
│  │   ├── yaml.ts                        # YAML repositories + snapshots
│  │   ├── sqlite.ts                      # SQLite backend (1000+ nodes)
│  │   └── repository.ts                  # Repository abstraction
│  ├── discovery/                       # Briefing analysis + questions
│  │   ├── briefing.ts                     # Briefing analysis
│  │   ├── briefing-analyzer.ts            # Tech stack detection
│  │   ├── adaptive.ts                     # Adaptive discovery
│  │   └── graph-builder.ts                # Graph construction
│  ├── changes/manager.ts               # Change management + approval gates
│  ├── validation/                      # Structural/semantic validation
│  │   ├── validator.ts                    # Main validator
│  │   ├── smart-validator.ts              # Smart per-subsystem validation
│  │   ├── executable.ts / coverage-index.ts
│  ├── drift/                           # Drift detection
│  │   ├── detector.ts                     # Spec ↔ code drift
│  │   ├── signals.ts                      # Advanced drift signals
│  │   └── exclusion.ts                    # Drift whitelist
│  ├── enforcement/interceptor.ts       # Enforces the SDD-first workflow
│  │   └── workflow-tracker.ts             # Per-session workflow tracking
│  ├── codegen/generator.ts             # Built-in templates + spec prompt for AI
│  ├── toggle/state.ts                  # SDD enforcement on/off
│  ├── cache/                           # Cache (memory + persistent + lock)
│  │   ├── manager.ts / atomic.ts / fingerprint.ts / snapshot-store.ts
│  ├── constitution/validator.ts        # Principle validation
│  ├── promises/                        # Promise tracking
│  │   ├── tracker.ts / classifier.ts
│  ├── quality/scorer.ts                # Quality score with trend
│  ├── session/handoff.ts               # Session handoff
│  ├── patterns/                        # Anti-pattern detection
│  │   ├── anti-patterns.ts / ast-clones.ts / contradictions.ts / config-drift.ts / learner.ts
│  ├── coverage/tracker.ts              # Test coverage
│  ├── workflow/exporter.ts             # Workflow export
│  ├── brownfield/scanner.ts            # Existing project analysis
│  ├── cicd/generators.ts               # CI/CD generation (GitHub, GitLab, Jenkins, Docker)
│  ├── sync/git-sync.ts                 # Git sync + conflicts
│  ├── rollback/manager.ts              # 3-layer rollback (git → snapshot → backup)
│  ├── permissions/access.ts            # Access control + audit
│  ├── migrations/                      # SDD migrations
│  │   ├── fixes.ts / index.ts / migration-runner.ts
│  ├── code-quality/                    # Code quality
│  │   ├── complexity.ts / metrics.ts / smells.ts / dependencies.ts
│  │   ├── symbol-parser.ts / usage-tracker.ts / import-analyzer.ts / conventions.ts / utils.ts
│  ├── workflows/                       # Enterprise workflows
│  │   ├── bug-fix.ts / hotfix.ts / refactoring.ts / deprecation.ts / data-migration.ts
│  │   ├── ab-testing.ts / feature-flags.ts / multi-tenancy.ts / onboarding.ts
│  ├── analysis/                        # Audits
│  │   ├── security.ts / scalability.ts / compliance.ts
│  ├── monitoring/                      # Monitoring
│  │   ├── setup.ts / telemetry.ts
│  ├── incidents/manager.ts             # Incident management
│  ├── sla/tracker.ts                   # SLA tracking
│  ├── cost/estimator.ts                # Cost estimation
│  ├── documentation/generator.ts       # Documentation generation
│  ├── knowledge/transfer.ts            # Knowledge transfer
│  ├── disaster/recovery.ts             # Disaster recovery plan
│  ├── transactions/manager.ts          # Logical transactions
│  ├── project-dir.ts                   # Project directory resolution (rejects "/")
│  └── log.ts                           # Plugin debug log
├ opencode/
│  ├── tools.ts                         # Tools for the agent
│  ├── hooks.ts                         # OpenCode hooks (including cache restore with try/catch)
│  ├── command.ts                       # "sdd" command hub (command.execute.before)
│  ├── system-prompt.ts                 # SDD instructions + question tool integration
│  ├── shell-hooks.ts                   # Git hooks for SDD
│  ├── router/                          # Semantic tool routing
│  │   ├── index.ts / categories.ts / intent-classifier.ts / semantic-nudge.ts / state-gate.ts
│  │   ├── tool-embeddings.ts / tool-registry.ts / tool-taxonomy.ts / tools-composite.ts
│  │   └── graph-state-snapshot.ts
│  └── workflows/                       # Opencode workflow executor
│      ├── index.ts / chains.ts / executor.ts / tools-workflow.ts / types.ts
├ mcp/
│  └── server.ts                        # MCP server
├ code-intelligence/
│  ├── analyzer.ts                      # Code analysis
│  └── ast/                             # AST (tree-sitter + fallback)
│      ├── index.ts / cache.ts / common.ts / component.ts / fallback.ts / ir.ts / metrics.ts
│      └── registry.ts / tree-sitter.ts / typescript.ts
└ server/
   ├── server.ts                        # Web dashboard (API + UI)
   └── events.ts                        # Dashboard events
```

## `.sdd/` structure

When initialized, the plugin creates:

```
.sdd/
├ graph.yaml              # The complete Knowledge Graph
├ enabled                 # Toggle state (JSON: {enabled, changed_at})
├ nodes/                  # Individual nodes (future)
├ relationships/          # Relationships (future)
├ changes/                # Change history
├ snapshots/              # State snapshots
└ transactions/           # Logical transactions
```

## Development

```bash
# Install dependencies
bun install

# Verify types
bun run typecheck

# Compile (generates dist/)
bun run build

# Lint (noUnusedLocals/noUnusedParameters)
bun run lint

# Run tests
bun test
```

## License

MIT
