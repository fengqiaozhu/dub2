// Drifted toResult snippet where structure has changed unexpectedly
const toResult = (attempt, clearSessionOnMissingSession = false) => {
    // Upstream refactored attempt handling
    if (!attempt.proc) {
        return null;
    }
    const resolvedSessionId = null;
    const resolvedSessionParams = null;
