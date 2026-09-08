import type { KnowledgeGraph } from '../domain/types.js';
export interface MonitoringSetup {
    metrics: Array<{
        name: string;
        type: 'counter' | 'gauge' | 'histogram' | 'summary';
        description: string;
        labels?: string[];
    }>;
    alerts: Array<{
        name: string;
        condition: string;
        severity: 'critical' | 'warning' | 'info';
        channels: string[];
    }>;
    dashboards: Array<{
        name: string;
        metrics: string[];
    }>;
}
export declare function setupMonitoring(graph: KnowledgeGraph): MonitoringSetup;
export declare function formatMonitoringSetup(setup: MonitoringSetup): string;
export interface DashboardConfig {
    title: string;
    panels: Array<{
        title: string;
        type: 'graph' | 'stat' | 'table' | 'heatmap' | 'gauge';
        query: string;
        position: {
            x: number;
            y: number;
            w: number;
            h: number;
        };
    }>;
    refresh_interval: string;
    time_range: string;
}
export declare function generateDashboardConfig(graph: KnowledgeGraph, dashboardType: 'overview' | 'api' | 'database' | 'security'): DashboardConfig;
export declare function formatDashboardConfig(config: DashboardConfig): string;
