import { getNodesByType } from "../graph/engine.js";
import { GraphIndices } from "../graph/index.js";
/**
 * Default dependency rules for infrastructure detection.
 * The AI can extend or override these per-project.
 */
export const DEFAULT_DEPENDENCY_RULES = [
    {
        keywords: ["docker", "container", "dockerfile", "docker-compose", "image"],
        description: "Docker infrastructure required",
        checkExists: (graph) => {
            // Check for Docker-related architecture components
            const archNodes = getNodesByType(graph, "architecture_component");
            const hasDockerArch = archNodes.some(n => {
                const tech = n.metadata.technology?.toLowerCase() || "";
                return tech.includes("docker");
            });
            // Check for Docker files
            const files = getNodesByType(graph, "file");
            const hasDockerFiles = files.some(f => {
                const path = f.metadata.path?.toLowerCase() || "";
                return path.includes("dockerfile") || path.includes("docker-compose") || path.includes(".dockerignore");
            });
            return hasDockerArch || hasDockerFiles;
        },
    },
    {
        keywords: ["health check", "healthcheck", "liveness", "readiness", "probes"],
        description: "Health check infrastructure required",
        checkExists: (graph) => {
            const archNodes = getNodesByType(graph, "architecture_component");
            return archNodes.some(n => {
                const name = n.name.toLowerCase();
                const tech = n.metadata.technology?.toLowerCase() || "";
                return name.includes("health") || name.includes("monitoring") || tech.includes("health");
            });
        },
    },
    {
        keywords: ["rollback", "roll-back", "auto-rollback", "automático"],
        description: "Rollback infrastructure required",
        checkExists: (graph) => {
            // Check for migration nodes with rollback scripts
            const migrations = getNodesByType(graph, "migration");
            if (migrations.length > 0)
                return true;
            // Check for architecture components related to deployment
            const archNodes = getNodesByType(graph, "architecture_component");
            return archNodes.some(n => {
                const name = n.name.toLowerCase();
                return name.includes("deploy") || name.includes("ci") || name.includes("cd");
            });
        },
    },
    {
        keywords: ["dlq", "dead letter", "dead-letter", "idempotency", "idempotent"],
        description: "Message queue infrastructure required",
        checkExists: (graph) => {
            const archNodes = getNodesByType(graph, "architecture_component");
            return archNodes.some(n => {
                const tech = n.metadata.technology?.toLowerCase() || "";
                const name = n.name.toLowerCase();
                return tech.includes("queue") || tech.includes("rabbitmq") || tech.includes("kafka") ||
                    tech.includes("bull") || tech.includes("redis") ||
                    name.includes("queue") || name.includes("worker") || name.includes("event");
            });
        },
    },
    {
        keywords: ["observability", "observabilidade", "logging", "tracing", "metrics", "prometheus", "grafana", "datadog"],
        description: "Observability stack required",
        checkExists: (graph) => {
            const archNodes = getNodesByType(graph, "architecture_component");
            const hasObs = archNodes.some(n => {
                const tech = n.metadata.technology?.toLowerCase() || "";
                const name = n.name.toLowerCase();
                return tech.includes("prometheus") || tech.includes("grafana") || tech.includes("datadog") ||
                    tech.includes("opentelemetry") || tech.includes("otel") ||
                    name.includes("observ") || name.includes("monitor") || name.includes("log");
            });
            // Also check for metric/alert nodes
            const metrics = getNodesByType(graph, "metric");
            const alerts = getNodesByType(graph, "alert");
            return hasObs || metrics.length > 0 || alerts.length > 0;
        },
    },
    {
        keywords: ["semver", "semantic version", "versioning"],
        description: "Versioning infrastructure required",
        checkExists: (graph) => {
            // Check for manifest/config files with versioning
            const files = getNodesByType(graph, "file");
            return files.some(f => {
                const path = f.metadata.path?.toLowerCase() || "";
                return path.includes("package.json") || path.includes("manifest") || path.includes("version");
            });
        },
    },
    {
        keywords: ["performance", "perf", "latência", "response time", "tempo de resposta"],
        description: "Performance measurement infrastructure required",
        checkExists: (graph) => {
            // Check for SLA nodes or metric nodes related to performance
            const slas = getNodesByType(graph, "sla");
            const metrics = getNodesByType(graph, "metric");
            const hasPerfSla = slas.some(s => {
                const metric = s.metadata.metric?.toLowerCase() || "";
                return metric.includes("response") || metric.includes("latency") || metric.includes("performance");
            });
            const hasPerfMetric = metrics.some(m => {
                const name = m.metadata.metric_name?.toLowerCase() || "";
                return name.includes("response") || name.includes("latency") || name.includes("p99");
            });
            return hasPerfSla || hasPerfMetric;
        },
    },
    {
        keywords: ["cpt", "dynamic registration", "registro dinâmico"],
        description: "Dynamic registration infrastructure required",
        checkExists: (graph) => {
            // Check for plugin system or module system architecture
            const archNodes = getNodesByType(graph, "architecture_component");
            return archNodes.some(n => {
                const name = n.name.toLowerCase();
                return name.includes("plugin") || name.includes("module") || name.includes("registry");
            });
        },
    },
    {
        keywords: ["cli search", "busca cli", "search cli"],
        description: "CLI search infrastructure required",
        checkExists: (graph) => {
            // Check for CLI-related architecture or files
            const archNodes = getNodesByType(graph, "architecture_component");
            const hasCliArch = archNodes.some(n => {
                const name = n.name.toLowerCase();
                return name.includes("cli") || name.includes("command");
            });
            const files = getNodesByType(graph, "file");
            const hasCliFiles = files.some(f => {
                const path = f.metadata.path?.toLowerCase() || "";
                return path.includes("cli") || path.includes("command");
            });
            return hasCliArch || hasCliFiles;
        },
    },
    {
        keywords: ["layer ordering", "layer order", "ordering", "ordenação"],
        description: "Layer ordering infrastructure required",
        checkExists: (graph) => {
            // Check for multiple architecture components with defined layers
            const archNodes = getNodesByType(graph, "architecture_component");
            const layers = new Set(archNodes.map(n => n.metadata.layer).filter(Boolean));
            return layers.size >= 2;
        },
    },
    {
        keywords: ["checksum", "hash", "integridade"],
        description: "Checksum infrastructure required",
        checkExists: (graph) => {
            // Check for build/deploy pipeline architecture
            const archNodes = getNodesByType(graph, "architecture_component");
            return archNodes.some(n => {
                const name = n.name.toLowerCase();
                return name.includes("build") || name.includes("pipeline") || name.includes("ci");
            });
        },
    },
];
/**
 * Classify whether a promise is verifiable based on its description
 * and the current graph state.
 *
 * The AI can pass custom rules to override or extend the defaults.
 */
export function classifyPromiseVerifiability(description, graph, customRules) {
    const rules = customRules || DEFAULT_DEPENDENCY_RULES;
    const indices = GraphIndices.from(graph);
    const descLower = description.toLowerCase();
    for (const rule of rules) {
        // Check if any keyword matches the promise description
        const matchesKeyword = rule.keywords.some(kw => descLower.includes(kw.toLowerCase()));
        if (!matchesKeyword)
            continue;
        // Keyword matched — now check if the required infrastructure exists
        const infrastructureExists = rule.checkExists(graph, indices);
        if (!infrastructureExists) {
            return {
                verifiable: false,
                reason: `Requires ${rule.description} (no matching infrastructure in graph)`,
            };
        }
    }
    return { verifiable: true };
}
/**
 * Batch classify a list of promises, returning those that are unverifiable.
 */
export function findUnverifiablePromises(promises, graph, customRules) {
    const results = [];
    for (const promise of promises) {
        if (promise.status !== "pending")
            continue;
        const classification = classifyPromiseVerifiability(promise.description, graph, customRules);
        if (!classification.verifiable && classification.reason) {
            results.push({
                id: promise.id,
                description: promise.description,
                reason: classification.reason,
            });
        }
    }
    return results;
}
