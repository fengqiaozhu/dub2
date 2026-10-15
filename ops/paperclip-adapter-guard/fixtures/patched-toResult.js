// Patched toResult snippet from @paperclipai/adapter-opencode-local dist/server/execute.js
const toResult = (attempt, clearSessionOnMissingSession = false) => {
    // Resolve the session before the timeout return. A SIGTERM still has
    // parsed stdout, and dropping that id makes the next retry start cold.
    const resolvedSessionId = attempt.parsed.sessionId ??
        (clearSessionOnMissingSession ? null : runtimeSessionId ?? runtime.sessionId ?? null);
    const resolvedSessionParams = resolvedSessionId
        ? {
            sessionId: resolvedSessionId,
            cwd: effectiveExecutionCwd,
            ...(workspaceId ? { workspaceId } : {}),
            ...(workspaceRepoUrl ? { repoUrl: workspaceRepoUrl } : {}),
            ...(workspaceRepoRef ? { repoRef: workspaceRepoRef } : {}),
            ...(executionTargetIsRemote
                ? {
                    remoteExecution: adapterExecutionTargetSessionIdentity(runtimeExecutionTarget),
                }
                : {}),
        }
        : null;
    if (attempt.proc.timedOut) {
        return {
            exitCode: attempt.proc.exitCode,
            signal: attempt.proc.signal,
            timedOut: true,
            errorMessage: `Timed out after ${timeoutSec}s`,
            clearSession: Boolean(clearSessionOnMissingSession && !resolvedSessionId),
            sessionId: resolvedSessionId,
            sessionParams: resolvedSessionParams,
            sessionDisplayId: resolvedSessionId,
        };
    }
