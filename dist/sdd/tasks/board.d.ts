/**
 * Task board domain — Kanban view over `task` nodes without changing the SDD
 * schema.
 *
 * Everything here operates on the existing Knowledge Graph:
 *   - node type `task` (already part of `NodeType` / `TaskNode`);
 *   - statuses already present in `NodeStatus` (`todo`, `ready`, `in_progress`,
 *     `blocked`, `completed`, plus the lifecycle ones);
 *   - existing relationship types (`contains`, `implements`, `depends_on`,
 *     `blocked_by`, `tested_by`).
 *
 * The only new surface is metadata on the task node (`metadata` is an open
 * `Record<string, unknown>` in both YAML and SQLite backends), used to persist
 * the Kanban column and the AI-integration state.
 */
import type { KnowledgeGraph, NodeStatus, RelationshipType, TaskNode } from "../domain/types.js";
export type TaskColumn = "backlog" | "ready" | "in_progress" | "blocked" | "done";
export type IntegrationStatus = "pending" | "integrated" | "manual";
export declare const TASK_COLUMNS: readonly TaskColumn[];
export declare const TASK_COLUMN_LABELS: Record<TaskColumn, string>;
export declare function isTaskColumn(value: unknown): value is TaskColumn;
/** Map any SDD status to the Kanban column it belongs to. */
export declare function statusToColumn(status: NodeStatus | string): TaskColumn;
/** Canonical status for a Kanban column (used when a card is dropped). */
export declare function columnToStatus(column: TaskColumn): NodeStatus;
export declare function getTaskNodes(graph: KnowledgeGraph): TaskNode[];
export declare function getTask(graph: KnowledgeGraph, id: string): TaskNode | undefined;
/**
 * Next `TASK-###` id, matching the format produced by `sdd.add_node`
 * (`${project_id}-TASK-001`). Scans for the highest existing suffix instead of
 * counting nodes so removals never cause a collision.
 */
export declare function nextTaskId(graph: KnowledgeGraph): string;
export interface TaskLink {
    id: string;
    type: RelationshipType;
    direction: "outgoing" | "incoming";
    node_id: string;
    node_type?: string;
    node_name?: string;
}
export interface TaskBoardItem {
    id: string;
    name: string;
    description?: string;
    status: NodeStatus;
    column: TaskColumn;
    version: number;
    metadata: Record<string, unknown>;
    integration_status: IntegrationStatus;
    created_at: string;
    updated_at: string;
    links: TaskLink[];
}
export declare function taskIntegrationStatus(task: TaskNode): IntegrationStatus;
export declare function toTaskBoardItem(graph: KnowledgeGraph, task: TaskNode): TaskBoardItem;
export declare function listTasks(graph: KnowledgeGraph): TaskBoardItem[];
export interface CreateTaskInput {
    name: string;
    description?: string;
    goal?: string;
    files?: string[];
    acceptance?: string[];
    column?: TaskColumn;
    status?: NodeStatus;
    link_to?: string;
    link_type?: RelationshipType;
    origin?: string;
    integration_status?: IntegrationStatus;
}
export declare function createTask(graph: KnowledgeGraph, input: CreateTaskInput): TaskNode;
export interface UpdateTaskInput {
    name?: string;
    description?: string;
    goal?: string;
    files?: string[];
    acceptance?: string[];
    status?: NodeStatus;
    column?: TaskColumn;
    metadata?: Record<string, unknown>;
    /** Re-flag the task for AI integration (content changed). */
    markPending?: boolean;
    expected_version?: number;
}
export declare function updateTask(graph: KnowledgeGraph, id: string, input: UpdateTaskInput): TaskNode;
export declare function removeTask(graph: KnowledgeGraph, id: string): void;
export declare function markTaskIntegrated(graph: KnowledgeGraph, id: string): TaskNode;
export declare function getPendingIntegrationTasks(graph: KnowledgeGraph): TaskNode[];
/**
 * Deterministic integration plan handed to the agent (via the system prompt or
 * the `sdd.integrate_tasks` tool). It never mutates the graph itself.
 */
export declare function buildIntegrationBrief(graph: KnowledgeGraph): string;
/** Short, deterministic prompt used to wake the agent when a card is saved. */
export declare function buildTaskIntegrationPrompt(taskId: string, name: string): string;
