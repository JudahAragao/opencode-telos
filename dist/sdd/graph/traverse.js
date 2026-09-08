import { getNode, getOutgoing, getIncoming } from "./engine.js";
export function bfsOutgoing(graph, startId, options = {}) {
    const maxDepth = options.max_depth ?? 10;
    const edgeTypes = options.edge_types ? new Set(options.edge_types) : null;
    const visited = new Set();
    const distances = new Map();
    const resultNodes = [];
    const resultEdges = [];
    const queue = [{ id: startId, depth: 0 }];
    visited.add(startId);
    distances.set(startId, 0);
    if (options.include_start) {
        const startNode = getNode(graph, startId);
        if (startNode)
            resultNodes.push(startNode);
    }
    while (queue.length > 0) {
        const current = queue.shift();
        if (current.depth >= maxDepth)
            continue;
        const outgoing = getOutgoing(graph, current.id);
        for (const edge of outgoing) {
            if (edgeTypes && !edgeTypes.has(edge.type))
                continue;
            if (visited.has(edge.to))
                continue;
            visited.add(edge.to);
            distances.set(edge.to, current.depth + 1);
            resultEdges.push(edge);
            const targetNode = getNode(graph, edge.to);
            if (targetNode)
                resultNodes.push(targetNode);
            queue.push({ id: edge.to, depth: current.depth + 1 });
        }
    }
    return { nodes: resultNodes, edges: resultEdges, distances };
}
export function bfsIncoming(graph, startId, options = {}) {
    const maxDepth = options.max_depth ?? 10;
    const edgeTypes = options.edge_types ? new Set(options.edge_types) : null;
    const visited = new Set();
    const distances = new Map();
    const resultNodes = [];
    const resultEdges = [];
    const queue = [{ id: startId, depth: 0 }];
    visited.add(startId);
    distances.set(startId, 0);
    if (options.include_start) {
        const startNode = getNode(graph, startId);
        if (startNode)
            resultNodes.push(startNode);
    }
    while (queue.length > 0) {
        const current = queue.shift();
        if (current.depth >= maxDepth)
            continue;
        const incoming = getIncoming(graph, current.id);
        for (const edge of incoming) {
            if (edgeTypes && !edgeTypes.has(edge.type))
                continue;
            if (visited.has(edge.from))
                continue;
            visited.add(edge.from);
            distances.set(edge.from, current.depth + 1);
            resultEdges.push(edge);
            const sourceNode = getNode(graph, edge.from);
            if (sourceNode)
                resultNodes.push(sourceNode);
            queue.push({ id: edge.from, depth: current.depth + 1 });
        }
    }
    return { nodes: resultNodes, edges: resultEdges, distances };
}
export function bfsBoth(graph, startId, options = {}) {
    const maxDepth = options.max_depth ?? 10;
    const edgeTypes = options.edge_types ? new Set(options.edge_types) : null;
    const visited = new Set();
    const distances = new Map();
    const resultNodes = [];
    const resultEdges = [];
    const queue = [{ id: startId, depth: 0 }];
    visited.add(startId);
    distances.set(startId, 0);
    if (options.include_start) {
        const startNode = getNode(graph, startId);
        if (startNode)
            resultNodes.push(startNode);
    }
    while (queue.length > 0) {
        const current = queue.shift();
        if (current.depth >= maxDepth)
            continue;
        const outgoing = getOutgoing(graph, current.id);
        const incoming = getIncoming(graph, current.id);
        const allEdges = [...outgoing, ...incoming];
        for (const edge of allEdges) {
            if (edgeTypes && !edgeTypes.has(edge.type))
                continue;
            const neighborId = edge.from === current.id ? edge.to : edge.from;
            if (visited.has(neighborId))
                continue;
            visited.add(neighborId);
            distances.set(neighborId, current.depth + 1);
            resultEdges.push(edge);
            const neighborNode = getNode(graph, neighborId);
            if (neighborNode)
                resultNodes.push(neighborNode);
            queue.push({ id: neighborId, depth: current.depth + 1 });
        }
    }
    return { nodes: resultNodes, edges: resultEdges, distances };
}
export function findPath(graph, fromId, toId, maxDepth = 10) {
    const visited = new Set();
    const queue = [{ id: fromId, path: [fromId] }];
    visited.add(fromId);
    while (queue.length > 0) {
        const current = queue.shift();
        if (current.id === toId) {
            return current.path
                .map((id) => getNode(graph, id))
                .filter(Boolean);
        }
        if (current.path.length > maxDepth)
            continue;
        const outgoing = getOutgoing(graph, current.id);
        for (const edge of outgoing) {
            if (!visited.has(edge.to)) {
                visited.add(edge.to);
                queue.push({ id: edge.to, path: [...current.path, edge.to] });
            }
        }
    }
    return null;
}
export function computeImpact(graph, nodeId, maxDepth = 5) {
    const depth1 = bfsOutgoing(graph, nodeId, { max_depth: 1, include_start: false });
    const depthN = bfsOutgoing(graph, nodeId, { max_depth: maxDepth, include_start: false });
    const directIds = new Set(depth1.nodes.map((n) => n.id));
    const indirectIds = new Set();
    const potentialIds = new Set();
    for (const node of depthN.nodes) {
        if (directIds.has(node.id))
            continue;
        const dist = depthN.distances.get(node.id) ?? 0;
        if (dist <= 2)
            indirectIds.add(node.id);
        else
            potentialIds.add(node.id);
    }
    return {
        direct: depth1.nodes,
        indirect: [...indirectIds].map((id) => getNode(graph, id)).filter(Boolean),
        potential: [...potentialIds].map((id) => getNode(graph, id)).filter(Boolean),
    };
}
/**
 * Compute impact with concrete actions: what files to modify,
 * what relationships to update, what tests to add.
 */
export function computeImpactActions(graph, nodeId, maxDepth = 3) {
    const impact = computeImpact(graph, nodeId, maxDepth);
    const actions = [];
    const sourceNode = getNode(graph, nodeId);
    if (!sourceNode)
        return actions;
    // Direct impact → modify actions
    for (const node of impact.direct) {
        const files = findNodeFiles(graph, node.id);
        const actionType = node.type === "file" ? "modify" :
            node.type === "test" ? "add_test" : "update_spec";
        actions.push({
            node_id: node.id,
            node_type: node.type,
            node_name: node.name,
            action: actionType,
            description: generateActionDescription(sourceNode, node),
            target_files: files,
            priority: "high",
        });
    }
    // Indirect impact → medium priority
    for (const node of impact.indirect) {
        const files = findNodeFiles(graph, node.id);
        actions.push({
            node_id: node.id,
            node_type: node.type,
            node_name: node.name,
            action: "update_spec",
            description: `Verify ${node.type} "${node.name}" still aligns after changes to "${sourceNode.name}"`,
            target_files: files,
            priority: "medium",
        });
    }
    // Potential impact → low priority, verification needed
    for (const node of impact.potential.slice(0, 10)) {
        const files = findNodeFiles(graph, node.id);
        actions.push({
            node_id: node.id,
            node_type: node.type,
            node_name: node.name,
            action: "update_spec",
            description: `Check if ${node.type} "${node.name}" needs updates`,
            target_files: files,
            priority: "low",
        });
    }
    return actions;
}
function findNodeFiles(graph, nodeId) {
    const files = [];
    // Check if the node itself is a file
    const node = getNode(graph, nodeId);
    if (node?.type === "file") {
        const path = node.metadata.path;
        if (path)
            files.push(path);
        return files;
    }
    // Find file nodes connected to this node
    for (const rel of graph.relationships) {
        if (rel.from === nodeId || rel.to === nodeId) {
            const otherId = rel.from === nodeId ? rel.to : rel.from;
            const other = getNode(graph, otherId);
            if (other?.type === "file") {
                const path = other.metadata.path;
                if (path)
                    files.push(path);
            }
            if (other?.type === "symbol") {
                const path = other.metadata.file_path;
                if (path)
                    files.push(path);
            }
        }
    }
    return [...new Set(files)];
}
function generateActionDescription(source, target) {
    const relType = target.type;
    if (relType === "entity")
        return `Update entity "${target.name}" to reflect changes in "${source.name}"`;
    if (relType === "endpoint")
        return `Update endpoint "${target.name}" API contract`;
    if (relType === "requirement")
        return `Verify requirement "${target.name}" is still satisfied`;
    if (relType === "test")
        return `Update test "${target.name}" for new behavior`;
    if (relType === "business_rule")
        return `Check if business rule "${target.name}" still applies`;
    if (relType === "file")
        return `Modify file "${target.name}"`;
    return `Update ${relType} "${target.name}"`;
}
export function getSubgraph(graph, nodeIds) {
    const idSet = new Set(nodeIds);
    return {
        version: graph.version,
        project_id: graph.project_id,
        nodes: graph.nodes.filter((n) => idSet.has(n.id)),
        relationships: graph.relationships.filter((r) => idSet.has(r.from) && idSet.has(r.to)),
        metadata: { ...graph.metadata },
    };
}
