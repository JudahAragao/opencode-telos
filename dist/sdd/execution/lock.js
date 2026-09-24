const projectTails = new Map();
/** Serialize mutations per project without coupling unrelated projects. */
export async function withProjectExecutionLock(projectDir, operation) {
    const previous = projectTails.get(projectDir) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    projectTails.set(projectDir, queued);
    await previous;
    try {
        return await operation();
    }
    finally {
        release();
        if (projectTails.get(projectDir) === queued)
            projectTails.delete(projectDir);
    }
}
