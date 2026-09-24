export interface AcceptanceApiResult {
    status: number;
    body: unknown;
}
export declare function handleListAcceptance(projectDir: string, requirementId?: string): AcceptanceApiResult;
export declare function handleAcceptanceMutation(projectDir: string, criterionId: string, action: "accept" | "reject" | "waive" | "reopen" | "update_text", raw: unknown): AcceptanceApiResult;
export declare function handleAcceptAll(projectDir: string, requirementId: string, raw: unknown): AcceptanceApiResult;
export declare function handleAcceptanceMigration(projectDir: string, raw?: unknown): AcceptanceApiResult;
export declare function handleFinalAcceptance(projectDir: string, changeId: string, status: "ACCEPTED" | "REJECTED", raw: unknown): AcceptanceApiResult;
export declare function handleListGuidance(projectDir: string, targetNodeId?: string): AcceptanceApiResult;
export declare function handleImpact(projectDir: string, nodeId: string, depth: number): AcceptanceApiResult;
export declare function handleGuidance(projectDir: string, action: "create" | "analyze" | "propose" | "apply" | "reject", targetId: string, raw: unknown): AcceptanceApiResult;
