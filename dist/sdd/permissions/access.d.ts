export type Role = "admin" | "architect" | "developer" | "viewer";
export type Permission = "create_feature" | "create_requirement" | "create_entity" | "create_endpoint" | "create_change" | "approve_feature" | "approve_requirement" | "approve_architecture" | "approve_breaking" | "modify_constitution" | "modify_decision" | "execute_rollback" | "manage_permissions" | "sync_push" | "sync_pull";
export interface RolePermissions {
    role: Role;
    permissions: Permission[];
    max_approvals: number;
}
export interface AuditEntry {
    id: string;
    timestamp: string;
    user: string;
    action: string;
    target: string;
    result: "allowed" | "denied";
    details?: string;
}
export interface PermissionConfig {
    roles: RolePermissions[];
    approval_requirements: Record<string, number>;
    audit_log: AuditEntry[];
}
export interface RemoteAuthConfig {
    provider: "github" | "gitlab" | null;
    owner: string;
    repo: string;
    token: string;
    branch: string;
}
export interface RemoteUser {
    login: string;
    id: number;
    role: Role;
    permissions: {
        admin: boolean;
        push: boolean;
        pull: boolean;
    };
}
export declare function loadPermissions(projectDir: string): PermissionConfig;
export declare function savePermissions(projectDir: string, config: PermissionConfig): void;
export declare function checkPermission(userRole: Role, permission: Permission, projectDir: string): boolean;
export declare function checkChangeApproval(changeType: string, userRole: Role, projectDir: string): boolean;
export declare function getRequiredApprovals(changeType: string, projectDir: string): number;
export declare function addAuditEntry(projectDir: string, user: string, action: string, target: string, result: "allowed" | "denied", details?: string): void;
export interface AuditLogFilters {
    user?: string;
    action?: string;
    limit?: number;
    /** Filter by target (node ID, file path, etc.). */
    target?: string;
    /** Filter by result (allowed/denied). */
    result?: 'allowed' | 'denied';
    /** Only entries after this ISO timestamp. */
    dateFrom?: string;
    /** Only entries before this ISO timestamp. */
    dateTo?: string;
    /** Max entries to return (default: all). */
    maxEntries?: number;
}
/** Cache for audit log reads. Key: projectDir. */
export declare function getAuditLog(projectDir: string, filters?: AuditLogFilters): AuditEntry[];
export declare function setRole(projectDir: string, user: string, role: Role): void;
export declare function getUserRole(projectDir: string, user: string): Role;
export declare function detectRemote(projectDir: string): RemoteAuthConfig | null;
export declare function fetchRemoteUser(projectDir: string, username: string): RemoteUser | null;
export declare function getUserRoleWithAuth(projectDir: string, user: string): Role;
export declare function formatRemoteStatus(remote: RemoteAuthConfig | null): string;
export declare function formatPermissionCheck(user: string, role: Role, permission: Permission, allowed: boolean): string;
export declare function formatAuditLog(entries: AuditEntry[]): string;
