// Unpatched toResult snippet from @paperclipai/adapter-opencode-local dist/server/execute.js
const toResult = (attempt, clearSessionOnMissingSession = false) => {
    if (attempt.proc.timedOut) {
        return {
            exitCode: attempt.proc.exitCode,
            signal: attempt.proc.signal,
            timedOut: true,
            errorMessage: `Timed out after ${timeoutSec}s`,
            clearSession: clearSessionOnMissingSession,
        };
    }
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
