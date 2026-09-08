export interface DashboardEvent {
    type: string;
    timestamp: string;
    data: unknown;
}
export declare class SddDashboardServer {
    private repo;
    private projectDir;
    private port;
    constructor(projectDir: string);
    start(): Promise<number>;
    getPort(): number;
    getUrl(): string;
    private handleRequest;
    private jsonResponse;
    private getProjectInfo;
    private getGraphData;
    private getGraphCounts;
    private getGraphSummary;
    private getGraphRelationships;
    private getNodeTypeCounts;
    private getNodes;
    private getNodeDetail;
    private getNodeRelationships;
    private getNodeImpact;
    private getStatus;
    private getValidation;
    private getDrift;
    private getChanges;
    private streamEvents;
    private getProgress;
    private serveDashboard;
}
