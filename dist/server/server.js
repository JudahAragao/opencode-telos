import { createRepository } from "../sdd/persistence/repository.js";
import { getGraphStats, getNode } from "../sdd/graph/engine.js";
import { computeImpact } from "../sdd/graph/traverse.js";
import { validateGraph } from "../sdd/validation/validator.js";
import { detectDrift } from "../sdd/drift/detector.js";
import { getPendingChanges } from "../sdd/changes/manager.js";
import { progressEmitter } from "./events.js";
export class SddDashboardServer {
    repo;
    projectDir;
    port = 0;
    constructor(projectDir) {
        this.projectDir = projectDir;
        this.repo = createRepository(projectDir);
    }
    async start() {
        if (!this.repo.isInitialized()) {
            throw new Error("SDD not initialized");
        }
        const server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch: async (req) => {
                const url = new URL(req.url);
                return this.handleRequest(url, req);
            },
        });
        this.port = server.port ?? 0;
        return this.port;
    }
    getPort() {
        return this.port;
    }
    getUrl() {
        return `http://127.0.0.1:${this.port}`;
    }
    async handleRequest(url, req) {
        const origin = req.headers.get("origin");
        const allowedOrigins = new Set([`http://127.0.0.1:${this.port}`, `http://localhost:${this.port}`]);
        const corsHeaders = {
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        };
        if (origin && allowedOrigins.has(origin)) {
            corsHeaders["Access-Control-Allow-Origin"] = origin;
            corsHeaders["Vary"] = "Origin";
        }
        if (req.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders });
        }
        try {
            const path = url.pathname;
            if (path === "/api/health") {
                return this.jsonResponse({ status: "ok", timestamp: new Date().toISOString() }, corsHeaders);
            }
            if (path === "/api/project") {
                return this.jsonResponse(this.getProjectInfo(), corsHeaders);
            }
            if (path === "/api/graph") {
                return this.jsonResponse(this.getGraphData(), corsHeaders);
            }
            if (path === "/api/graph/counts") {
                return this.jsonResponse(this.getGraphCounts(), corsHeaders);
            }
            if (path === "/api/graph/summary") {
                const offset = parseInt(url.searchParams.get("offset") || "0");
                const limit = parseInt(url.searchParams.get("limit") || "500");
                const type = url.searchParams.get("type") || undefined;
                return this.jsonResponse(this.getGraphSummary(offset, limit, type), corsHeaders);
            }
            if (path === "/api/graph/relationships") {
                const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0);
                const limit = Math.min(5000, Math.max(1, parseInt(url.searchParams.get("limit") || "2000", 10) || 2000));
                return this.jsonResponse(this.getGraphRelationships(offset, limit), corsHeaders);
            }
            if (path === "/api/graph/types") {
                return this.jsonResponse(this.getNodeTypeCounts(), corsHeaders);
            }
            if (path === "/api/nodes") {
                const type = url.searchParams.get("type");
                return this.jsonResponse(this.getNodes(type), corsHeaders);
            }
            if (path.startsWith("/api/nodes/") && path.endsWith("/relationships")) {
                const nodeId = path.split("/")[3];
                return this.jsonResponse(this.getNodeRelationships(nodeId), corsHeaders);
            }
            if (path.startsWith("/api/nodes/") && path.endsWith("/impact")) {
                const nodeId = path.split("/")[3];
                const depth = parseInt(url.searchParams.get("depth") || "3");
                return this.jsonResponse(this.getNodeImpact(nodeId, depth), corsHeaders);
            }
            if (path.startsWith("/api/nodes/")) {
                const nodeId = path.split("/")[3];
                return this.jsonResponse(this.getNodeDetail(nodeId), corsHeaders);
            }
            if (path === "/api/status") {
                return this.jsonResponse(this.getStatus(), corsHeaders);
            }
            if (path === "/api/validation") {
                return this.jsonResponse(this.getValidation(), corsHeaders);
            }
            if (path === "/api/drift") {
                return this.jsonResponse(this.getDrift(), corsHeaders);
            }
            if (path === "/api/changes") {
                return this.jsonResponse(this.getChanges(), corsHeaders);
            }
            if (path === "/api/events") {
                return this.streamEvents(req);
            }
            if (path === "/api/progress") {
                return this.getProgress();
            }
            if (path === "/") {
                return this.serveDashboard(corsHeaders);
            }
            if (path === "/favicon.ico") {
                return new Response(null, { status: 204, headers: corsHeaders });
            }
            return this.jsonResponse({ error: "Not found" }, corsHeaders, 404);
        }
        catch (error) {
            return this.jsonResponse({ error: error instanceof Error ? error.message : String(error) }, corsHeaders, 500);
        }
    }
    jsonResponse(data, headers = {}, status = 200) {
        return new Response(JSON.stringify(data), {
            status,
            headers: { "Content-Type": "application/json", ...headers },
        });
    }
    getProjectInfo() {
        if (!this.repo.isInitialized())
            return { initialized: false };
        const graph = this.repo.loadGraph();
        return {
            initialized: true,
            project_id: graph.project_id,
            version: graph.version,
            sdd_version: graph.metadata.sdd_version,
            created_at: graph.metadata.created_at,
            updated_at: graph.metadata.updated_at,
        };
    }
    getGraphData() {
        if (!this.repo.isInitialized())
            return { nodes: [], relationships: [], updated_at: "" };
        // Use optimized SQLite queries when available for large graphs
        const sqliteRepo = this.repo;
        if (sqliteRepo.getGraphCounts && sqliteRepo.getUpdatedAt && sqliteRepo.getAllNodesSummary && sqliteRepo.getAllRelationshipsSummary && sqliteRepo.getNodesSummary && sqliteRepo.getRelationshipsSummary) {
            const counts = sqliteRepo.getGraphCounts();
            const updatedAt = sqliteRepo.getUpdatedAt();
            // For graphs under 2000 nodes, send all data at once
            if (counts.nodeCount <= 2000) {
                const nodes = sqliteRepo.getAllNodesSummary();
                const rels = sqliteRepo.getAllRelationshipsSummary();
                return { nodes, relationships: rels, updated_at: updatedAt, nodeCount: counts.nodeCount, relCount: counts.relCount };
            }
            // For larger graphs, send all nodes summary (lightweight) but only first 2000 relationships
            const nodes = sqliteRepo.getAllNodesSummary();
            const relsResult = sqliteRepo.getRelationshipsSummary(0, 2000);
            return {
                nodes,
                relationships: relsResult.relationships,
                updated_at: updatedAt,
                nodeCount: counts.nodeCount,
                relCount: relsResult.total,
                hasMoreRelationships: relsResult.total > 2000,
            };
        }
        // Fallback for YAML
        const graph = this.repo.loadGraph();
        return {
            nodes: graph.nodes.map((n) => ({
                id: n.id,
                type: n.type,
                name: n.name,
                status: n.status,
                version: n.version,
            })),
            relationships: graph.relationships.map((r) => ({
                id: r.id,
                from: r.from,
                to: r.to,
                type: r.type,
            })),
            updated_at: graph.metadata.updated_at,
        };
    }
    getGraphCounts() {
        if (!this.repo.isInitialized())
            return { nodeCount: 0, relCount: 0, updated_at: "" };
        const sqliteRepo = this.repo;
        if (sqliteRepo.getGraphCounts && sqliteRepo.getUpdatedAt) {
            const counts = sqliteRepo.getGraphCounts();
            const updatedAt = sqliteRepo.getUpdatedAt();
            return { ...counts, updated_at: updatedAt };
        }
        const graph = this.repo.loadGraph();
        return {
            nodeCount: graph.nodes.length,
            relCount: graph.relationships.length,
            updated_at: graph.metadata.updated_at,
        };
    }
    getGraphSummary(offset, limit, type) {
        if (!this.repo.isInitialized())
            return { nodes: [], relationships: [], total: 0 };
        const sqliteRepo = this.repo;
        if (sqliteRepo.getNodesSummary) {
            const nodesResult = sqliteRepo.getNodesSummary(offset, limit, type);
            return {
                nodes: nodesResult.nodes,
                total: nodesResult.total,
                offset,
                limit,
                hasMore: offset + limit < nodesResult.total,
            };
        }
        // Fallback for YAML — load full graph and slice
        const graph = this.repo.loadGraph();
        let nodes = graph.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            name: n.name,
            status: n.status,
            version: n.version,
        }));
        if (type)
            nodes = nodes.filter((n) => n.type === type);
        return {
            nodes: nodes.slice(offset, offset + limit),
            total: nodes.length,
            offset,
            limit,
            hasMore: offset + limit < nodes.length,
        };
    }
    getGraphRelationships(offset, limit) {
        if (!this.repo.isInitialized())
            return { relationships: [], total: 0, offset, limit, hasMore: false };
        const sqliteRepo = this.repo;
        if (sqliteRepo.getRelationshipsSummary) {
            const result = sqliteRepo.getRelationshipsSummary(offset, limit);
            return {
                relationships: result.relationships,
                total: result.total,
                offset,
                limit,
                hasMore: offset + limit < result.total,
            };
        }
        const relationships = this.repo.loadGraph().relationships.map((r) => ({
            id: r.id,
            from: r.from,
            to: r.to,
            type: r.type,
        }));
        return {
            relationships: relationships.slice(offset, offset + limit),
            total: relationships.length,
            offset,
            limit,
            hasMore: offset + limit < relationships.length,
        };
    }
    getNodeTypeCounts() {
        if (!this.repo.isInitialized())
            return [];
        const sqliteRepo = this.repo;
        if (sqliteRepo.getNodeTypeCounts) {
            return sqliteRepo.getNodeTypeCounts();
        }
        const graph = this.repo.loadGraph();
        const counts = {};
        for (const n of graph.nodes) {
            counts[n.type] = (counts[n.type] || 0) + 1;
        }
        return Object.entries(counts)
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count);
    }
    getNodes(type) {
        if (!this.repo.isInitialized())
            return [];
        const sqliteRepo = this.repo;
        if (type && sqliteRepo.getNodesByType) {
            return sqliteRepo.getNodesByType(type);
        }
        const graph = this.repo.loadGraph();
        if (type) {
            return graph.nodes.filter((n) => n.type === type);
        }
        return graph.nodes;
    }
    getNodeDetail(nodeId) {
        if (!this.repo.isInitialized())
            return { error: "Not initialized" };
        const sqliteRepo = this.repo;
        if (sqliteRepo.getNodeById) {
            const node = sqliteRepo.getNodeById(nodeId);
            return node || { error: "Node not found" };
        }
        const graph = this.repo.loadGraph();
        const node = getNode(graph, nodeId);
        if (!node)
            return { error: "Node not found" };
        return node;
    }
    getNodeRelationships(nodeId) {
        if (!this.repo.isInitialized())
            return [];
        const sqliteRepo = this.repo;
        if (sqliteRepo.getRelationshipsForNode) {
            return sqliteRepo.getRelationshipsForNode(nodeId);
        }
        const graph = this.repo.loadGraph();
        return graph.relationships.filter((r) => r.from === nodeId || r.to === nodeId);
    }
    getNodeImpact(nodeId, depth) {
        if (!this.repo.isInitialized())
            return { error: "Not initialized" };
        const graph = this.repo.loadGraph();
        return computeImpact(graph, nodeId, depth);
    }
    getStatus() {
        if (!this.repo.isInitialized())
            return { initialized: false };
        const graph = this.repo.loadGraph();
        const stats = getGraphStats(graph);
        const pending = getPendingChanges(graph);
        const validation = validateGraph(graph, undefined, this.projectDir);
        return {
            initialized: true,
            stats,
            pending_changes: pending.length,
            validation_errors: validation.errors.length,
            validation_warnings: validation.warnings.length,
        };
    }
    getValidation() {
        if (!this.repo.isInitialized())
            return { error: "Not initialized" };
        const graph = this.repo.loadGraph();
        return validateGraph(graph, undefined, this.projectDir);
    }
    getDrift() {
        if (!this.repo.isInitialized())
            return { error: "Not initialized" };
        const graph = this.repo.loadGraph();
        return detectDrift(graph, this.projectDir);
    }
    getChanges() {
        if (!this.repo.isInitialized())
            return [];
        const sqliteRepo = this.repo;
        if (sqliteRepo.getNodesByType) {
            return sqliteRepo.getNodesByType("change");
        }
        const graph = this.repo.loadGraph();
        return graph.nodes
            .filter((n) => n.type === "change")
            .sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    streamEvents(_req) {
        let unsubscribe = null;
        const stream = new ReadableStream({
            start(controller) {
                const encoder = new TextEncoder();
                const send = (event) => {
                    try {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                    }
                    catch {
                        // Stream might be closed
                    }
                };
                // Send initial connection event
                send({ type: "connected", timestamp: new Date().toISOString(), data: {} });
                // Send current build status if any
                const currentBuild = progressEmitter.getCurrentBuild();
                if (currentBuild) {
                    send({
                        type: "build_status",
                        timestamp: new Date().toISOString(),
                        data: currentBuild,
                    });
                }
                // Subscribe to progress events
                unsubscribe = progressEmitter.on((event) => {
                    send(event);
                });
                // Send heartbeat every 30 seconds to keep connection alive
                const heartbeat = setInterval(() => {
                    try {
                        controller.enqueue(encoder.encode(`:heartbeat\n\n`));
                    }
                    catch {
                        clearInterval(heartbeat);
                    }
                }, 30000);
                // Cleanup on close
                const originalCancel = stream.cancel?.bind(stream);
                stream.cancel = () => {
                    clearInterval(heartbeat);
                    if (unsubscribe)
                        unsubscribe();
                    return originalCancel?.() ?? Promise.resolve();
                };
            },
            cancel() {
                if (unsubscribe)
                    unsubscribe();
            },
        });
        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
                "Access-Control-Allow-Origin": `http://127.0.0.1:${this.port}`,
            },
        });
    }
    getProgress() {
        const currentBuild = progressEmitter.getCurrentBuild();
        return new Response(JSON.stringify({
            building: progressEmitter.isBuilding(),
            currentBuild,
            subscribers: progressEmitter.getSubscriberCount(),
        }), {
            headers: { "Content-Type": "application/json" },
        });
    }
    serveDashboard(headers) {
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SDD Knowledge Graph Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; overflow: hidden; }
    .container { display: grid; grid-template-columns: 280px 1fr 320px; height: 100vh; }
    .sidebar { background: #161b22; border-right: 1px solid #30363d; padding: 16px; overflow-y: auto; display: flex; flex-direction: column; }
    .main { position: relative; overflow: hidden; }
    .details { background: #161b22; border-left: 1px solid #30363d; padding: 16px; overflow-y: auto; }
    h1 { font-size: 18px; margin-bottom: 16px; color: #58a6ff; }
    h2 { font-size: 14px; margin-bottom: 8px; color: #8b949e; text-transform: uppercase; letter-spacing: 1px; }
    .stat { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #21262d; }
    .stat-label { color: #8b949e; }
    .stat-value { font-weight: 600; }
    .node-list { list-style: none; flex: 1; overflow-y: auto; }
    .node-item { padding: 8px 12px; margin: 2px 0; border-radius: 6px; cursor: pointer; transition: background 0.2s; }
    .node-item:hover { background: #21262d; }
    .node-item.selected { background: #1f6feb33; border-left: 3px solid #58a6ff; }
    .node-id { font-size: 11px; color: #8b949e; }
    .node-name { font-size: 13px; font-weight: 500; }
    .node-status { font-size: 10px; padding: 2px 6px; border-radius: 10px; margin-left: 8px; }
    .status-DRAFT { background: #30363d; color: #8b949e; }
    .status-APPROVED { background: #238636; color: #fff; }
    .status-IMPLEMENTING { background: #9e6a03; color: #fff; }
    .status-IMPLEMENTED { background: #1f6feb; color: #fff; }
    .status-BLOCKED { background: #da3633; color: #fff; }
    .filter-bar { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
    .filter-btn { padding: 4px 10px; border-radius: 12px; border: 1px solid #30363d; background: transparent; color: #c9d1d9; cursor: pointer; font-size: 11px; transition: all 0.2s; }
    .filter-btn:hover { border-color: #58a6ff; }
    .filter-btn.active { background: #1f6feb; border-color: #1f6feb; color: #fff; }
    .search { width: 100%; padding: 8px 12px; border-radius: 6px; border: 1px solid #30363d; background: #0d1117; color: #c9d1d9; margin-bottom: 12px; font-size: 13px; outline: none; }
    .search:focus { border-color: #58a6ff; }
    .detail-section { margin-bottom: 16px; }
    .detail-section h3 { font-size: 12px; color: #58a6ff; margin-bottom: 8px; }
    .detail-field { font-size: 12px; padding: 4px 0; }
    .detail-field .label { color: #8b949e; }
    #graph-container { width: 100%; height: 100%; }
    .graph-overlay { position: absolute; bottom: 12px; left: 12px; background: #161b22ee; border: 1px solid #30363d; border-radius: 8px; padding: 10px 14px; font-size: 11px; color: #8b949e; pointer-events: none; }
    .graph-controls { position: absolute; top: 12px; right: 12px; display: flex; flex-direction: column; gap: 6px; }
    .graph-btn { width: 32px; height: 32px; border-radius: 6px; border: 1px solid #30363d; background: #161b22; color: #c9d1d9; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
    .graph-btn:hover { border-color: #58a6ff; color: #58a6ff; }
    .legend { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .legend-item { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #8b949e; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
    .progress-panel { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px; margin-bottom: 16px; display: none; }
    .progress-panel.active { display: block; }
    .progress-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .progress-title { font-size: 12px; font-weight: 600; color: #58a6ff; }
    .progress-percent { font-size: 11px; color: #3fb950; }
    .progress-bar-bg { height: 6px; background: #21262d; border-radius: 3px; overflow: hidden; margin-bottom: 8px; }
    .progress-bar { height: 100%; background: linear-gradient(90deg, #1f6feb, #3fb950); border-radius: 3px; transition: width 0.3s ease; }
    .progress-step { font-size: 11px; color: #8b949e; }
    .progress-log { max-height: 120px; overflow-y: auto; font-size: 10px; font-family: monospace; color: #8b949e; margin-top: 8px; }
    .progress-log-entry { padding: 2px 0; border-bottom: 1px solid #21262d; }
    .progress-log-entry.error { color: #f85149; }
    .progress-log-entry.complete { color: #3fb950; }
    .sse-status { display: flex; align-items: center; gap: 4px; font-size: 10px; color: #8b949e; margin-bottom: 8px; }
    .sse-dot { width: 6px; height: 6px; border-radius: 50%; }
    .sse-dot.connected { background: #3fb950; }
    .sse-dot.disconnected { background: #f85149; }
    .large-graph-notice { background: #1c2333; border: 1px solid #30363d; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; font-size: 11px; color: #d29922; display: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="sidebar">
      <h1>SDD Knowledge Graph</h1>
      <div class="sse-status" id="sse-status">
        <span class="sse-dot disconnected" id="sse-dot"></span>
        <span id="sse-text">Disconnected</span>
      </div>
      <div class="progress-panel" id="progress-panel">
        <div class="progress-header">
          <span class="progress-title" id="progress-title">Building...</span>
          <span class="progress-percent" id="progress-percent">0%</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar" id="progress-bar" style="width: 0%"></div>
        </div>
        <div class="progress-step" id="progress-step">Initializing...</div>
        <div class="progress-log" id="progress-log"></div>
      </div>
      <input id="search" class="search" type="text" placeholder="Search nodes...">
      <div id="filters" class="filter-bar"></div>
      <div id="legend" class="legend"></div>
      <h2>Nodes (<span id="node-count">0</span>)</h2>
      <ul id="node-list" class="node-list"></ul>
    </div>
    <div class="main">
      <div id="graph-container"></div>
      <div class="graph-controls">
        <button class="graph-btn" onclick="resetView()" title="Reset view">&#x21bb;</button>
        <button class="graph-btn" onclick="zoomIn()" title="Zoom in">+</button>
        <button class="graph-btn" onclick="zoomOut()" title="Zoom out">&minus;</button>
      </div>
      <div class="graph-overlay" id="graph-overlay">Loading...</div>
    </div>
    <div class="details" id="details">
      <h2>Node Details</h2>
      <p style="color: #8b949e; font-size: 13px;">Click a node to view details</p>
    </div>
  </div>
  <script src="https://unpkg.com/3d-force-graph@1.73.4/dist/3d-force-graph.min.js"></script>
  <script>
    var TYPE_COLORS = {
      project: "#58a6ff", feature: "#3fb950", requirement: "#d29922",
      entity: "#bc8cff", task: "#f85149", change: "#f0883e",
      architecture_component: "#79c0ff", test: "#56d364", business_rule: "#f778ba",
      actor: "#d2a8ff", flow: "#79c0ff", use_case: "#56d364", module: "#d29922",
      api: "#79c0ff", endpoint: "#58a6ff", database: "#bc8cff", table: "#d2a8ff",
      field: "#8b949e", file: "#8b949e", symbol: "#8b949e",
      decision: "#f0883e", constraint: "#da3633", assumption: "#d29922",
      value_object: "#d2a8ff", domain: "#58a6ff",
    };

    var graphData = { nodes: [], links: [] };
    var allNodes = [];
    var allLinks = [];
    var selectedNodeId = null;
    var activeFilter = null;
    var searchQuery = "";
    var fg = null;
    // Use counter-based hash instead of string concatenation (O(1) for large graphs)
    var lastNodeCount = 0;
    var lastRelCount = 0;
    var lastUpdatedAt = "";
    var isLargeGraph = false;
    var LARGE_GRAPH_THRESHOLD = 2000;

    function getColor(type) { return TYPE_COLORS[type] || "#8b949e"; }

    // Helper to safely extract id from node ref (may be object or string after graphData())
    function linkSourceId(l) { return (typeof l.source === "object" && l.source !== null) ? l.source.id : l.source; }
    function linkTargetId(l) { return (typeof l.target === "object" && l.target !== null) ? l.target.id : l.target; }

    function loadGraph() {
      fetch("/api/graph")
        .then(function(res) { return res.json(); })
        .then(function(data) {
          var nodeCount = data.nodeCount || data.nodes.length;
          var relCount = data.relCount || data.relationships.length;
          var updatedAt = data.updated_at || "";

          // O(1) change detection: compare counters + timestamp
          var changed = nodeCount !== lastNodeCount || relCount !== lastRelCount || updatedAt !== lastUpdatedAt;
          lastNodeCount = nodeCount;
          lastRelCount = relCount;
          lastUpdatedAt = updatedAt;

          isLargeGraph = nodeCount > LARGE_GRAPH_THRESHOLD;

          allNodes = data.nodes;
          function renderLoadedLinks(links) {
            allLinks = links;
            if (changed) applyFilters();
            renderFilters();
            renderLegend();
            renderNodeList();
            var overlayText = nodeCount + " nodes, " + relCount + " links";
            if (isLargeGraph) overlayText += " (large graph mode)";
            document.getElementById("graph-overlay").textContent = overlayText;
          }

          if (data.hasMoreRelationships) {
            function loadRelationshipPage(offset, links) {
              return fetch("/api/graph/relationships?offset=" + offset + "&limit=2000")
                .then(function(res) { return res.json(); })
                .then(function(page) {
                  var combined = links.concat(page.relationships || []);
                  if (page.hasMore) return loadRelationshipPage(offset + (page.relationships || []).length, combined);
                  renderLoadedLinks(combined);
                });
            }
            loadRelationshipPage(data.relationships.length, data.relationships).catch(function(e) {
              console.error("Failed to load relationship page:", e);
              renderLoadedLinks(data.relationships);
            });
          } else {
            renderLoadedLinks(data.relationships);
          }
        })
        .catch(function(e) { console.error("Failed to load graph:", e); });
    }

    function applyFilters() {
      var filteredNodes = allNodes;
      if (activeFilter) filteredNodes = filteredNodes.filter(function(n) { return n.type === activeFilter; });
      if (searchQuery) {
        var q = searchQuery.toLowerCase();
        filteredNodes = filteredNodes.filter(function(n) {
          return n.name.toLowerCase().indexOf(q) !== -1 || n.id.toLowerCase().indexOf(q) !== -1 || n.type.toLowerCase().indexOf(q) !== -1;
        });
      }
      var nodeIds = new Set(filteredNodes.map(function(n) { return n.id; }));
      var filteredLinks = allLinks.filter(function(l) { return nodeIds.has(l.from) && nodeIds.has(l.to); });
      var newData = {
        nodes: filteredNodes,
        links: filteredLinks.map(function(r) { return { id: r.id, source: r.from, target: r.to, type: r.type }; })
      };

      // For large graphs, limit nodes rendered in 3D to keep performance smooth
      if (isLargeGraph && newData.nodes.length > 500) {
        var renderLimit = 500;
        // Prioritize nodes connected to selected node, then by type diversity
        if (selectedNodeId) {
          var connected = [];
          var notConnected = [];
          newData.nodes.forEach(function(n) {
            if (n.id === selectedNodeId) { connected.unshift(n); return; }
            var isConn = newData.links.some(function(l) {
              return (l.source === selectedNodeId && l.target === n.id) || (l.target === selectedNodeId && l.source === n.id);
            });
            if (isConn) connected.push(n);
            else notConnected.push(n);
          });
          newData.nodes = connected.concat(notConnected).slice(0, renderLimit);
        } else {
          // Sample: keep first N to maintain type diversity
          newData.nodes = newData.nodes.slice(0, renderLimit);
        }
        // Only keep links between visible nodes
        var visIds = new Set(newData.nodes.map(function(n) { return n.id; }));
        newData.links = newData.links.filter(function(l) { return visIds.has(l.source) && visIds.has(l.target); });
      }

      if (fg) {
        updateGraphData(newData);
      } else {
        graphData = newData;
      }
    }

    function updateGraphData(newData) {
      if (!fg) return;
      // Preserve positions of existing nodes to avoid restarting the simulation
      var posMap = {};
      graphData.nodes.forEach(function(n) {
        if (n.x !== undefined) {
          posMap[n.id] = { x: n.x, y: n.y, z: n.z, vx: n.vx, vy: n.vy, vz: n.vz };
        }
      });
      newData.nodes.forEach(function(n) {
        var pos = posMap[n.id];
        if (pos) {
          n.x = pos.x; n.y = pos.y; n.z = pos.z;
          n.vx = pos.vx; n.vy = pos.vy; n.vz = pos.vz;
        }
      });
      graphData = newData;
      fg.graphData(graphData);
      // Re-apply highlight if a node is selected
      if (selectedNodeId) {
        highlightNode(selectedNodeId);
      }
    }

    function renderFilters() {
      // Build type counts in a single pass (O(n) instead of O(n*types))
      var typeCounts = {};
      var types = [];
      allNodes.forEach(function(n) {
        if (!typeCounts[n.type]) { typeCounts[n.type] = 0; types.push(n.type); }
        typeCounts[n.type]++;
      });
      var el = document.getElementById("filters");
      var html = '<button class="filter-btn active" data-filter="all">All (' + allNodes.length + ')</button>';
      types.forEach(function(t) {
        html += '<button class="filter-btn" data-filter="' + t + '">' + t + " (" + typeCounts[t] + ")</button>";
      });
      el.innerHTML = html;
      el.querySelectorAll(".filter-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
          var f = this.getAttribute("data-filter");
          activeFilter = f === "all" ? null : f;
          el.querySelectorAll(".filter-btn").forEach(function(b) { b.classList.remove("active"); });
          this.classList.add("active");
          applyFilters();
          renderNodeList();
        });
      });
    }

    function renderLegend() {
      // Build unique types in a single pass
      var seen = {};
      var types = [];
      allNodes.forEach(function(n) { if (!seen[n.type]) { seen[n.type] = true; types.push(n.type); } });
      var el = document.getElementById("legend");
      el.innerHTML = types.slice(0, 10).map(function(t) {
        return '<span class="legend-item"><span class="legend-dot" style="background:' + getColor(t) + '"></span>' + t + "</span>";
      }).join("");
    }

    function renderNodeList() {
      var nodes = graphData.nodes;
      document.getElementById("node-count").textContent = isLargeGraph ? (lastNodeCount + "+") : nodes.length;
      var el = document.getElementById("node-list");
      // For large graphs, limit sidebar list to 200 items
      var listLimit = isLargeGraph ? 200 : nodes.length;
      var html = "";
      var displayNodes = nodes.slice(0, listLimit);
      displayNodes.forEach(function(n) {
        var sel = selectedNodeId === n.id ? " selected" : "";
        html += '<li class="node-item' + sel + '" data-id="' + n.id + '">' +
          '<div class="node-id">' + n.id + "</div>" +
          '<div class="node-name">' + n.name + '<span class="node-status status-' + n.status + '">' + n.status + "</span></div>" +
          "</li>";
      });
      if (isLargeGraph && nodes.length > listLimit) {
        html += '<li style="padding:8px;color:#8b949e;font-size:11px;text-align:center">... ' + (nodes.length - listLimit) + " more (use search to filter)</li>";
      }
      el.innerHTML = html;
      el.querySelectorAll(".node-item").forEach(function(item) {
        item.addEventListener("click", function() {
          selectNode(this.getAttribute("data-id"));
        });
      });
    }

    function selectNode(id) {
      selectedNodeId = id;
      renderNodeList();
      highlightNode(id);
      fetch("/api/nodes/" + id)
        .then(function(res) { return res.json(); })
        .then(function(node) {
          return fetch("/api/nodes/" + id + "/relationships")
            .then(function(res2) { return res2.json(); })
            .then(function(rels) { renderDetails(node, rels); centerOnNode(id); });
        })
        .catch(function(e) { console.error("Failed to load node:", e); });
    }

    function renderDetails(node, rels) {
      var el = document.getElementById("details");
      var outgoing = rels.filter(function(r) { return r.from === node.id; });
      var incoming = rels.filter(function(r) { return r.to === node.id; });
      var html = "<h2>Node Details</h2>" +
        '<div class="detail-section"><h3>Info</h3>' +
        '<div class="detail-field"><span class="label">ID:</span> ' + node.id + "</div>" +
        '<div class="detail-field"><span class="label">Type:</span> <span class="legend-dot" style="background:' + getColor(node.type) + ';display:inline-block;vertical-align:middle;margin-right:4px"></span>' + node.type + "</div>" +
        '<div class="detail-field"><span class="label">Name:</span> ' + node.name + "</div>" +
        '<div class="detail-field"><span class="label">Status:</span> <span class="node-status status-' + node.status + '">' + node.status + "</span></div>" +
        '<div class="detail-field"><span class="label">Version:</span> ' + node.version + "</div>";
      if (node.description) html += '<div class="detail-field"><span class="label">Description:</span> ' + node.description + "</div>";
      if (node.metadata && Object.keys(node.metadata).length > 0) {
        html += '<div class="detail-field"><span class="label">Metadata:</span> <pre style="font-size:11px;color:#8b949e;white-space:pre-wrap;margin-top:4px">' + JSON.stringify(node.metadata, null, 2) + "</pre></div>";
      }
      html += "</div>";
      if (outgoing.length) {
        html += '<div class="detail-section"><h3>Outgoing (' + outgoing.length + ')</h3>';
        outgoing.forEach(function(r) { html += '<div class="detail-field" style="cursor:pointer" data-goto="' + r.to + '">' + r.type + " &rarr; " + r.to + "</div>"; });
        html += "</div>";
      }
      if (incoming.length) {
        html += '<div class="detail-section"><h3>Incoming (' + incoming.length + ')</h3>';
        incoming.forEach(function(r) { html += '<div class="detail-field" style="cursor:pointer" data-goto="' + r.from + '">' + r.type + " &larr; " + r.from + "</div>"; });
        html += "</div>";
      }
      el.innerHTML = html;
      el.querySelectorAll("[data-goto]").forEach(function(el) {
        el.addEventListener("click", function() { selectNode(this.getAttribute("data-goto")); });
      });
    }

    function highlightNode(id) {
      if (!fg) return;
      var connectedIds = new Set();
      if (id) {
        connectedIds.add(id);
        allLinks.forEach(function(l) {
          var from = l.from || l.source;
          var to = l.to || l.target;
          if (from === id) connectedIds.add(to);
          if (to === id) connectedIds.add(from);
        });
      }
      fg.nodeColor(function(n) {
        if (!id) return getColor(n.type);
        return connectedIds.has(n.id) ? getColor(n.type) : getColor(n.type);
      });
      fg.nodeOpacity(function(n) {
        if (!id) return 0.9;
        return connectedIds.has(n.id) ? 1.0 : 0.6;
      });
      fg.linkOpacity(function(l) {
        var sid = linkSourceId(l);
        var tid = linkTargetId(l);
        if (!id) return 0.6;
        return (sid === id || tid === id) ? 0.9 : 0.15;
      });
      fg.linkWidth(function(l) {
        var sid = linkSourceId(l);
        var tid = linkTargetId(l);
        if (!id) return 1;
        return (sid === id || tid === id) ? 2.5 : 0.5;
      });
    }

    function clearHighlight() {
      selectedNodeId = null;
      if (!fg) return;
      fg.nodeColor(function(n) { return getColor(n.type); });
      fg.nodeOpacity(0.9);
      fg.linkOpacity(0.6);
      fg.linkWidth(1);
      fg.linkDirectionalParticles(0);
    }

    function centerOnNode(id) {
      if (!fg) return;
      var node = graphData.nodes.find(function(n) { return n.id === id; });
      if (node && node.x !== undefined) {
        var distance = 120;
        var distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
        fg.cameraPosition(
          { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
          { x: node.x, y: node.y, z: node.z },
          600
        );
      }
    }

    function resetView() {
      clearHighlight();
      selectedNodeId = null;
      renderNodeList();
      document.getElementById("details").innerHTML = '<h2>Node Details</h2><p style="color:#8b949e;font-size:13px">Click a node to view details</p>';
      if (fg) fg.cameraPosition({ x: 0, y: 0, z: 500 }, { x: 0, y: 0, z: 0 }, 600);
    }

    function zoomIn() { if (fg) fg.cameraPosition({ z: fg.cameraPosition().z * 0.7 }); }
    function zoomOut() { if (fg) fg.cameraPosition({ z: fg.cameraPosition().z * 1.4 }); }

    function initGraph() {
      var container = document.getElementById("graph-container");
      fg = ForceGraph3D()(container)
        .graphData(graphData)
        .backgroundColor("#0d1117")
        .width(container.offsetWidth)
        .height(container.offsetHeight)
        .nodeVal(function(n) { return selectedNodeId === n.id ? 12 : 6; })
        .nodeColor(function(n) { return getColor(n.type); })
        .nodeOpacity(0.9)
        .nodeResolution(isLargeGraph ? 8 : 24)
        .nodeLabel(function(n) { return "<b>" + n.name + "</b><br/>" + n.type + " [" + n.status + "]"; })
        .onNodeClick(function(node) { selectNode(node.id); })
        .onBackgroundClick(function() {
          clearHighlight();
          renderNodeList();
          document.getElementById("details").innerHTML = '<h2>Node Details</h2><p style="color:#8b949e;font-size:13px">Click a node to view details</p>';
        })
        .linkColor(function() { return "#30363d"; })
        .linkOpacity(0.6)
        .linkWidth(1)
        .linkLabel(function(l) { return l.type; })
        .linkDirectionalParticles(0)
        .d3AlphaDecay(isLargeGraph ? 0.05 : 0.02)
        .d3VelocityDecay(isLargeGraph ? 0.5 : 0.3)
        .enablePointerInteraction(true)
        .showNavInfo(false);

      window.addEventListener("resize", function() {
        if (fg && container) {
          fg.width(container.offsetWidth);
          fg.height(container.offsetHeight);
        }
      });
    }

    document.getElementById("search").addEventListener("input", function(e) {
      searchQuery = e.target.value;
      applyFilters();
      renderNodeList();
    });

    initGraph();
    loadGraph();
    // Poll every 10s using lightweight counter-based change detection
    setInterval(loadGraph, 10000);

    // ─── SSE Real-time Progress ──────────────────────────────────────
    var progressPanel = document.getElementById("progress-panel");
    var progressTitle = document.getElementById("progress-title");
    var progressPercent = document.getElementById("progress-percent");
    var progressBar = document.getElementById("progress-bar");
    var progressStep = document.getElementById("progress-step");
    var progressLog = document.getElementById("progress-log");
    var sseDot = document.getElementById("sse-dot");
    var sseText = document.getElementById("sse-text");
    var eventSource = null;

    function connectSSE() {
      if (eventSource) {
        eventSource.close();
      }
      eventSource = new EventSource("/api/events");

      eventSource.onopen = function() {
        sseDot.className = "sse-dot connected";
        sseText.textContent = "Connected";
      };

      eventSource.onerror = function() {
        var readyState = eventSource ? eventSource.readyState : -1;
        // 0=CONNECTING, 1=OPEN, 2=CLOSED
        if (readyState === 2) {
          // Connection permanently closed — manual reconnect needed
          sseDot.className = "sse-dot disconnected";
          sseText.textContent = "Disconnected";
          setTimeout(connectSSE, 3000);
        } else if (readyState === 0) {
          // Browser is auto-reconnecting, show status but don't create new instance
          sseDot.className = "sse-dot disconnected";
          sseText.textContent = "Reconnecting...";
        }
        // readyState === 1 (OPEN): transient error, connection still alive — do nothing
      };

      eventSource.onmessage = function(e) {
        try {
          var event = JSON.parse(e.data);
          handleProgressEvent(event);
        } catch (err) {
          console.error("Failed to parse SSE event:", err);
        }
      };
    }

    function handleProgressEvent(event) {
      // Update progress panel for build events
      if (event.type === "info" && event.step === "build_start") {
        progressPanel.classList.add("active");
        progressTitle.textContent = "Building Graph...";
        progressPercent.textContent = "0%";
        progressBar.style.width = "0%";
        progressStep.textContent = event.message;
        progressLog.innerHTML = "";
        addLogEntry("Build started: " + (event.details ? event.details.buildId : ""));
        return;
      }

      if (event.type === "step") {
        progressPanel.classList.add("active");
        progressTitle.textContent = "Building Graph...";
        if (event.progress !== undefined) {
          progressPercent.textContent = event.progress + "%";
          progressBar.style.width = event.progress + "%";
        }
        progressStep.textContent = event.message;
        addLogEntry("[STEP] " + event.message);
        return;
      }

      if (event.type === "progress") {
        if (event.progress !== undefined) {
          progressPercent.textContent = event.progress + "%";
          progressBar.style.width = event.progress + "%";
        }
        progressStep.textContent = event.message;
        return;
      }

      if (event.type === "error") {
        addLogEntry("[ERROR] " + event.message, "error");
        return;
      }

      if (event.type === "complete") {
        progressTitle.textContent = "Build Complete";
        progressPercent.textContent = "100%";
        progressBar.style.width = "100%";
        progressStep.textContent = event.message;
        addLogEntry("[DONE] " + event.message, "complete");
        // Refresh graph after build completes
        setTimeout(loadGraph, 500);
        // Hide panel after 5 seconds
        setTimeout(function() {
          progressPanel.classList.remove("active");
        }, 5000);
        return;
      }

      // Handle other events
      if (event.type === "connected") {
        addLogEntry("SSE connected");
      }
      if (event.type === "build_status") {
        progressPanel.classList.add("active");
        progressTitle.textContent = "Build in Progress...";
        if (event.data && event.data.progress !== undefined) {
          progressPercent.textContent = event.data.progress + "%";
          progressBar.style.width = event.data.progress + "%";
        }
        if (event.data && event.data.currentStep) {
          progressStep.textContent = event.data.currentStep;
        }
      }
    }

    function addLogEntry(text, className) {
      var entry = document.createElement("div");
      entry.className = "progress-log-entry" + (className ? " " + className : "");
      var time = new Date().toLocaleTimeString();
      entry.textContent = "[" + time + "] " + text;
      progressLog.appendChild(entry);
      progressLog.scrollTop = progressLog.scrollHeight;
    }

    // Start SSE connection
    connectSSE();
  </script>
</body>
</html>`;
        return new Response(html, {
            headers: { "Content-Type": "text/html", ...headers },
        });
    }
}
