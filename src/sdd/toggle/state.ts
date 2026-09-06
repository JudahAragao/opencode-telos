import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"

export interface SddToggleState {
  enabled: boolean
  changed_at: string
}

const TOGGLE_FILE = ".sdd/enabled"

export function getToggleState(projectDir: string): SddToggleState {
  const filePath = join(projectDir, TOGGLE_FILE)
  if (!existsSync(filePath)) {
    return { enabled: true, changed_at: new Date().toISOString() }
  }
  try {
    const content = readFileSync(filePath, "utf-8").trim()
    return JSON.parse(content)
  } catch {
    return { enabled: true, changed_at: new Date().toISOString() }
  }
}

export function setToggleState(projectDir: string, enabled: boolean): SddToggleState {
  const state: SddToggleState = {
    enabled,
    changed_at: new Date().toISOString(),
  }
  const filePath = join(projectDir, TOGGLE_FILE)
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8")
  return state
}

export function isSddEnabled(projectDir: string): boolean {
  return getToggleState(projectDir).enabled
}
