export interface ConfigDriftItem {
    file: string;
    type: "version_mismatch" | "deprecated_setting" | "missing_config" | "inconsistency";
    description: string;
    expected?: string;
    actual?: string;
    severity: "error" | "warning" | "info";
}
export interface ConfigDriftReport {
    items: ConfigDriftItem[];
    total: number;
    by_type: Record<string, number>;
}
export declare function detectConfigDrift(projectDir: string): ConfigDriftReport;
export declare function formatConfigDriftReport(report: ConfigDriftReport): string;
