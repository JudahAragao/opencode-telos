export interface DashboardEvent {
    type: string;
    timestamp: string;
    data: unknown;
}
/** Porta preferida do dashboard (estável entre sessões). Override via SDD_DASHBOARD_PORT. */
export declare const DEFAULT_DASHBOARD_PORT = 7331;
/** Porta configurada pelo usuário, se houver. */
export declare function resolveDashboardPort(): number;
export declare class SddDashboardServer {
    private repo;
    private projectDir;
    private port;
    private server;
    constructor(projectDir: string);
    /**
     * Sobe o servidor de dashboard.
     *
     * @param preferredPort - porta desejada. Se estiver ocupada, cai para uma
     *   porta efêmera em vez de falhar; a porta retornada é a autoritativa.
     * @returns a porta em que o servidor está escutando
     */
    start(preferredPort?: number): number;
    /** Encerra o servidor, se estiver rodando. */
    stop(): void;
    isRunning(): boolean;
    getProjectDir(): string;
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
/**
 * Sobe o dashboard do projeto ou reaproveita o que já estiver rodando.
 *
 * @returns a porta em que o dashboard está escutando
 */
export declare function startSharedDashboard(projectDir: string, preferredPort?: number): number;
/** Encerra o dashboard compartilhado. Retorna false se não havia nada rodando. */
export declare function stopSharedDashboard(): boolean;
/** URL do dashboard compartilhado, ou null se não estiver rodando. */
export declare function getSharedDashboardUrl(): string | null;
