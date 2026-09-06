import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, writeFileSync } from "fs"
import { dirname } from "path"

/** Write a cache artifact so readers see either the old complete file or the new complete file. */
export function atomicWriteFile(filePath: string, content: string): void {
  const directory = dirname(filePath)
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true })

  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  let descriptor: number | undefined
  try {
    descriptor = openSync(temporaryPath, "w", 0o600)
    writeFileSync(descriptor, content, "utf-8")
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporaryPath, filePath)
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor) } catch {}
    }
    try {
      // A failed rename must not leave a misleading cache artifact behind.
      if (existsSync(temporaryPath)) {
        const { unlinkSync } = require("fs")
        unlinkSync(temporaryPath)
      }
    } catch {}
  }
}
