import { readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { execFileSync } from "child_process";
import { atomicWriteFile } from "../cache/atomic.js";
const PERMISSIONS_FILE = ".sdd/permissions.json";
const AUDIT_LOG_FILE = ".sdd/audit-log.json";
const DEFAULT_ROLES = [
    {
        role: "admin",
        permissions: [
            "create_feature", "create_requirement", "create_entity", "create_endpoint",
            "create_change", "approve_feature", "approve_requirement",
            "approve_architecture", "approve_breaking", "modify_constitution",
            "modify_decision", "execute_rollback", "manage_permissions",
            "sync_push", "sync_pull",
        ],
        max_approvals: 100,
    },
    {
        role: "architect",
        permissions: [
            "create_feature", "create_requirement", "create_entity", "create_endpoint",
            "create_change", "approve_feature", "approve_requirement",
            "approve_architecture", "modify_decision",
            "sync_push", "sync_pull",
        ],
        max_approvals: 50,
    },
    {
        role: "developer",
        permissions: [
            "create_feature", "create_requirement", "create_entity", "create_endpoint",
            "create_change", "approve_feature", "approve_requirement",
            "sync_push", "sync_pull",
        ],
        max_approvals: 20,
    },
    {
        role: "viewer",
        permissions: [],
        max_approvals: 0,
    },
];
const CHANGE_TYPE_PERMISSIONS = {
    feature: "approve_feature",
    requirement: "approve_requirement",
    architecture_component: "approve_architecture",
    constraint: "approve_architecture",
    decision: "modify_decision",
    constitution: "modify_constitution",
};
export function loadPermissions(projectDir) {
    const path = join(projectDir, PERMISSIONS_FILE);
    if (!existsSync(path)) {
        return {
            roles: DEFAULT_ROLES,
            approval_requirements: {
                feature: 1,
                requirement: 1,
                architecture_component: 2,
                breaking_change: 2,
            },
            audit_log: [],
        };
    }
    try {
        return JSON.parse(readFileSync(path, "utf-8"));
    }
    catch {
        return {
            roles: DEFAULT_ROLES,
            approval_requirements: {},
            audit_log: [],
        };
    }
}
export function savePermissions(projectDir, config) {
    const path = join(projectDir, PERMISSIONS_FILE);
    const dir = dirname(path);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    atomicWriteFile(path, JSON.stringify(config, null, 2));
}
export function checkPermission(userRole, permission, projectDir) {
    const config = loadPermissions(projectDir);
    const roleConfig = config.roles.find((r) => r.role === userRole);
    if (!roleConfig)
        return false;
    return roleConfig.permissions.includes(permission);
}
export function checkChangeApproval(changeType, userRole, projectDir) {
    const permission = CHANGE_TYPE_PERMISSIONS[changeType];
    if (!permission)
        return true;
    return checkPermission(userRole, permission, projectDir);
}
export function getRequiredApprovals(changeType, projectDir) {
    const config = loadPermissions(projectDir);
    return config.approval_requirements[changeType] || 1;
}
export function addAuditEntry(projectDir, user, action, target, result, details) {
    const auditPath = join(projectDir, AUDIT_LOG_FILE);
    const dir = dirname(auditPath);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    let entries = [];
    if (existsSync(auditPath)) {
        try {
            entries = JSON.parse(readFileSync(auditPath, "utf-8"));
        }
        catch {
            entries = [];
        }
    }
    entries.push({
        id: `audit_${Date.now()}`,
        timestamp: new Date().toISOString(),
        user,
        action,
        target,
        result,
        details,
    });
    if (entries.length > 1000) {
        entries = entries.slice(-1000);
    }
    atomicWriteFile(auditPath, JSON.stringify(entries, null, 2));
}
/** Cache for audit log reads. Key: projectDir. */
export function getAuditLog(projectDir, filters) {
    const auditPath = join(projectDir, AUDIT_LOG_FILE);
    if (!existsSync(auditPath))
        return [];
    try {
        let entries = JSON.parse(readFileSync(auditPath, "utf-8"));
        if (filters?.user) {
            entries = entries.filter((e) => e.user === filters.user);
        }
        if (filters?.action) {
            entries = entries.filter((e) => e.action === filters.action);
        }
        if (filters?.target) {
            entries = entries.filter((e) => e.target === filters.target);
        }
        if (filters?.result) {
            entries = entries.filter((e) => e.result === filters.result);
        }
        if (filters?.dateFrom) {
            entries = entries.filter((e) => e.timestamp >= filters.dateFrom);
        }
        if (filters?.dateTo) {
            entries = entries.filter((e) => e.timestamp <= filters.dateTo);
        }
        if (filters?.maxEntries) {
            entries = entries.slice(-filters.maxEntries);
        }
        else if (filters?.limit) {
            entries = entries.slice(-filters.limit);
        }
        return entries;
    }
    catch {
        return [];
    }
}
export function setRole(projectDir, user, role) {
    const usersFile = join(projectDir, ".sdd", "users.json");
    let users = {};
    if (existsSync(usersFile)) {
        try {
            users = JSON.parse(readFileSync(usersFile, "utf-8"));
        }
        catch {
            users = {};
        }
    }
    users[user] = role;
    atomicWriteFile(usersFile, JSON.stringify(users, null, 2));
    addAuditEntry(projectDir, "system", "set_role", user, "allowed", `Role set to ${role}`);
}
export function getUserRole(projectDir, user) {
    const usersFile = join(projectDir, ".sdd", "users.json");
    if (!existsSync(usersFile))
        return "viewer";
    try {
        const users = JSON.parse(readFileSync(usersFile, "utf-8"));
        return users[user] || "viewer";
    }
    catch {
        return "viewer";
    }
}
export function detectRemote(projectDir) {
    try {
        const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], {
            cwd: projectDir,
            encoding: "utf-8",
            timeout: 5000,
        }).trim();
        if (!remoteUrl)
            return null;
        let provider = null;
        let owner = "";
        let repo = "";
        if (remoteUrl.includes("github.com")) {
            provider = "github";
            const match = remoteUrl.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
            if (match) {
                owner = match[1];
                repo = match[2];
            }
        }
        else if (remoteUrl.includes("gitlab.com")) {
            provider = "gitlab";
            const match = remoteUrl.match(/gitlab\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
            if (match) {
                owner = match[1];
                repo = match[2];
            }
        }
        if (!provider || !owner || !repo)
            return null;
        const token = process.env.GITHUB_TOKEN || process.env.GITLAB_TOKEN || "";
        return {
            provider,
            owner,
            repo,
            token,
            branch: "main",
        };
    }
    catch {
        return null;
    }
}
export function fetchRemoteUser(projectDir, username) {
    const remote = detectRemote(projectDir);
    if (!remote || !remote.token)
        return null;
    try {
        if (remote.provider === "github") {
            const response = execFileSync("curl", ["-fsS", "--config", "-", `https://api.github.com/repos/${encodeURIComponent(remote.owner)}/${encodeURIComponent(remote.repo)}/collaborators/${encodeURIComponent(username)}/permission`], {
                cwd: projectDir,
                encoding: "utf-8",
                timeout: 10000,
                input: `header = ${JSON.stringify(`Authorization: token ${remote.token}`)}\n`,
            });
            const data = JSON.parse(response);
            if (!data.permission)
                return null;
            const role = data.permission === "admin" ? "admin"
                : data.permission === "write" ? "developer"
                    : data.permission === "read" ? "viewer"
                        : "viewer";
            return {
                login: username,
                id: 0,
                role,
                permissions: {
                    admin: data.permission === "admin",
                    push: data.permission === "admin" || data.permission === "write",
                    pull: true,
                },
            };
        }
        if (remote.provider === "gitlab") {
            const response = execFileSync("curl", ["-fsS", "--config", "-", `https://gitlab.com/api/v4/projects/${encodeURIComponent(`${remote.owner}/${remote.repo}`)}/members/all/${encodeURIComponent(username)}`], {
                cwd: projectDir,
                encoding: "utf-8",
                timeout: 10000,
                input: `header = ${JSON.stringify(`PRIVATE-TOKEN: ${remote.token}`)}\n`,
            });
            const data = JSON.parse(response);
            if (!data.access_level)
                return null;
            const role = data.access_level >= 50 ? "admin"
                : data.access_level >= 30 ? "developer"
                    : data.access_level >= 10 ? "viewer"
                        : "viewer";
            return {
                login: username,
                id: data.id,
                role,
                permissions: {
                    admin: data.access_level >= 50,
                    push: data.access_level >= 30,
                    pull: data.access_level >= 10,
                },
            };
        }
    }
    catch {
        return null;
    }
    return null;
}
export function getUserRoleWithAuth(projectDir, user) {
    const localRole = getUserRole(projectDir, user);
    if (localRole !== "viewer")
        return localRole;
    const remoteUser = fetchRemoteUser(projectDir, user);
    if (remoteUser) {
        return remoteUser.role;
    }
    const remote = detectRemote(projectDir);
    if (remote && remote.token) {
        return "viewer";
    }
    return "admin";
}
export function formatRemoteStatus(remote) {
    if (!remote)
        return "No remote configured";
    const lines = [
        `**Provider:** ${remote.provider}`,
        `**Repository:** ${remote.owner}/${remote.repo}`,
        `**Token:** ${remote.token ? "✅ Configured" : "❌ Not configured"}`,
    ];
    return lines.join("\n");
}
export function formatPermissionCheck(user, role, permission, allowed) {
    const status = allowed ? "✅" : "❌";
    return `${status} User **${user}** (${role}) → ${permission}: ${allowed ? "ALLOWED" : "DENIED"}`;
}
export function formatAuditLog(entries) {
    const lines = [
        "## Audit Log",
        "",
    ];
    if (entries.length === 0) {
        lines.push("No audit entries found.");
        return lines.join("\n");
    }
    for (const entry of entries.slice(-20)) {
        const status = entry.result === "allowed" ? "✅" : "❌";
        lines.push(`- ${status} **${entry.user}** ${entry.action} → ${entry.target} (${entry.timestamp})`);
        if (entry.details) {
            lines.push(`  ${entry.details}`);
        }
    }
    return lines.join("\n");
}
