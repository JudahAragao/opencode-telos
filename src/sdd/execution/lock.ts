const projectTails = new Map<string, Promise<void>>()

/** Serialize mutations per project without coupling unrelated projects. */
export async function withProjectExecutionLock<T>(projectDir: string, operation: () => Promise<T> | T): Promise<T> {
  const previous = projectTails.get(projectDir) || Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const queued = previous.then(() => current)
  projectTails.set(projectDir, queued)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (projectTails.get(projectDir) === queued) projectTails.delete(projectDir)
  }
}
