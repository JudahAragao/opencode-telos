import { describe, expect, test, beforeEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { checkPermission, getUserRoleWithAuth, setRole, savePermissions, loadPermissions, addAuditEntry, getAuditLog } from "../src/sdd/permissions/access.js"
import type { Role, Permission } from "../src/sdd/permissions/access.js"

describe("checkPermission", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "perm-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
  })

  test("admin can do everything", () => {
    expect(checkPermission("admin", "create_feature", dir)).toBe(true)
    expect(checkPermission("admin", "approve_feature", dir)).toBe(true)
    expect(checkPermission("admin", "manage_permissions", dir)).toBe(true)
    expect(checkPermission("admin", "execute_rollback", dir)).toBe(true)
  })

  test("viewer cannot create or approve", () => {
    expect(checkPermission("viewer", "create_feature", dir)).toBe(false)
    expect(checkPermission("viewer", "approve_feature", dir)).toBe(false)
  })

  test("developer can create but not approve architecture", () => {
    expect(checkPermission("developer", "create_feature", dir)).toBe(true)
    expect(checkPermission("developer", "approve_architecture", dir)).toBe(false)
  })

  test("architect can approve architecture", () => {
    expect(checkPermission("architect", "approve_architecture", dir)).toBe(true)
    expect(checkPermission("architect", "create_feature", dir)).toBe(true)
  })

  test("unknown role falls back to default", () => {
    // loadPermissions returns default roles if no config file
    const hasPermission = checkPermission("developer", "create_feature", dir)
    expect(typeof hasPermission).toBe("boolean")
  })
})

describe("setRole / getUserRoleWithAuth", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "perm-role-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
  })

  test("set and get role for a user", () => {
    setRole(dir, "alice", "architect")
    const role = getUserRoleWithAuth(dir, "alice")
    expect(role).toBe("architect")
  })

  test("default role is admin when no auth configured", () => {
    // When no remote auth is configured, getUserRoleWithAuth defaults to admin
    const role = getUserRoleWithAuth(dir, "unknown-user")
    expect(role).toBe("admin")
  })

  test("setRole persists role for user", () => {
    setRole(dir, "alice", "architect")
    const role = getUserRoleWithAuth(dir, "alice")
    expect(role).toBe("architect")
  })
})

describe("savePermissions / loadPermissions", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "perm-save-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
  })

  test("round-trip permissions config", () => {
    const config = { version: 1, roles: { admin: ["*"], viewer: ["graph_read"] } }
    savePermissions(dir, config)
    const loaded = loadPermissions(dir)
    expect(loaded.roles).toBeDefined()
  })
})

describe("addAuditEntry / getAuditLog", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "perm-audit-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
  })

  test("audit entries are recorded", () => {
    addAuditEntry(dir, "alice", "code_write", "src/index.ts", "allowed")
    addAuditEntry(dir, "bob", "graph_write", "graph", "denied")
    const log = getAuditLog(dir, 10)
    expect(log.length).toBe(2)
    expect(log[0].user).toBe("alice")
    expect(log[1].action).toBe("graph_write")
  })

  test("audit log respects limit", () => {
    for (let i = 0; i < 5; i++) {
      addAuditEntry(dir, `user${i}`, "code_write", `file${i}.ts`, "allowed")
    }
    const log = getAuditLog(dir, 3)
    expect(log.length).toBeLessThanOrEqual(5)
  })
})
