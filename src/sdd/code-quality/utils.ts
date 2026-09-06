/**
 * Check if a file matches the focusFiles patterns.
 * Supports * wildcard (e.g., "src/services/*", "*Service*").
 */
export function fileMatchesFocus(fileName: string, focusFiles: string[]): boolean {
  return focusFiles.some(pattern => {
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$")
      return regex.test(fileName)
    }
    return fileName === pattern || fileName.endsWith("/" + pattern)
  })
}
