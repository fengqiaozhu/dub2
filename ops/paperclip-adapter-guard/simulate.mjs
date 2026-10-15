#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const APPLY_SCRIPT = path.join(SCRIPT_DIR, "apply.mjs");
const CHECK_SCRIPT = path.join(SCRIPT_DIR, "check.mjs");
const FIXTURES_DIR = path.join(SCRIPT_DIR, "fixtures");

const unpatchedSnippet = fsSync.readFileSync(path.join(FIXTURES_DIR, "unpatched-toResult.js"), "utf8");
const driftedSnippet = fsSync.readFileSync(path.join(FIXTURES_DIR, "drifted-toResult.js"), "utf8");

function buildSyntheticExecuteContent(snippet) {
  return `import { spawn } from "node:child_process";

export async function execute(ctx) {
    const timeoutSec = ctx.config?.timeoutSec ?? 2;
    const command = ctx.config?.command;
    const cwd = ctx.config?.cwd ?? process.cwd();
    const env = { ...process.env, ...(ctx.config?.env ?? {}) };

    const proc = await new Promise((resolve) => {
        const child = spawn(command, [], { cwd, env, shell: true });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
        }, timeoutSec * 1000);

        child.stdout.on("data", (d) => { stdout += d.toString(); });
        child.stderr.on("data", (d) => { stderr += d.toString(); });
        child.on("close", (code, signal) => {
            clearTimeout(timer);
            resolve({
                exitCode: code,
                signal,
                timedOut,
                stdout,
                stderr,
            });
        });
    });

    let sessionId = null;
    for (const line of proc.stdout.split("\\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed.sessionID || parsed.sessionId) {
                sessionId = parsed.sessionID || parsed.sessionId;
            }
        } catch {}
    }

    const attempt = {
        proc,
        rawStderr: proc.stderr,
        parsed: {
            sessionId,
            usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
            costUsd: 0,
            summary: "",
        },
    };

    const effectiveExecutionCwd = cwd;
    const workspaceId = ctx.context?.workspaceId;
    const workspaceRepoUrl = ctx.context?.workspaceRepoUrl;
    const workspaceRepoRef = ctx.context?.workspaceRepoRef;
    const executionTargetIsRemote = false;
    const runtimeSessionId = ctx.runtime?.sessionId;
    const runtime = ctx.runtime ?? {};

${snippet}
        const parsedError = typeof attempt.parsed.errorMessage === "string" ? attempt.parsed.errorMessage.trim() : "";
        return {
            exitCode: attempt.proc.exitCode,
            signal: attempt.proc.signal,
            timedOut: attempt.proc.timedOut,
            sessionId: resolvedSessionId,
            sessionParams: resolvedSessionParams,
            sessionDisplayId: resolvedSessionId,
            clearSession: Boolean(clearSessionOnMissingSession && !resolvedSessionId),
            errorMessage: attempt.proc.timedOut ? \`Timed out after \${timeoutSec}s\` : null,
        };
    };
    return toResult(attempt);
}
`;
}

function runCommand(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function setupMockPackage(baseDir, name, version, snippet) {
  const pkgDir = path.join(baseDir, name);
  const serverDir = path.join(pkgDir, "dist", "server");
  await fs.mkdir(serverDir, { recursive: true });

  const pkgJson = {
    name: "@paperclipai/adapter-opencode-local",
    version,
    type: "module",
    main: "./dist/index.js",
  };

  await fs.writeFile(path.join(pkgDir, "package.json"), JSON.stringify(pkgJson, null, 2), "utf8");
  const execContent = buildSyntheticExecuteContent(snippet);
  const execPath = path.join(serverDir, "execute.js");
  await fs.writeFile(execPath, execContent, "utf8");
  return { pkgDir, execPath };
}

async function main() {
  const scratchBase = process.env.PAPERCLIP_SCRATCH_DIR ||
                      process.env.PAPERCLIP_RUN_SCRATCH_DIR ||
                      os.tmpdir();
  const simDir = await fs.mkdtemp(path.join(scratchBase, "adapter-guard-sim-"));
  console.log(`[simulate] Running 5-case simulation in ${simDir}`);

  try {
    // -------------------------------------------------------------
    // Case 1: 未打补丁后的应用 (Apply unpatched)
    // -------------------------------------------------------------
    console.log("[simulate] Case 1: Unpatched file -> apply");
    const { pkgDir: case1Pkg, execPath: case1Exec } = await setupMockPackage(
      simDir,
      "case1-unpatched",
      "2026.1012.0",
      unpatchedSnippet
    );
    const originalUnpatchedContent = await fs.readFile(case1Exec, "utf8");

    // Before apply, behavior check should report behavior regression (code 4)
    const preCheck = await runCommand(process.execPath, [CHECK_SCRIPT, case1Pkg]);
    if (preCheck.code !== 4) {
      throw new Error(`Case 1 expected pre-apply check to fail with 4, got ${preCheck.code}. Stderr: ${preCheck.stderr}`);
    }

    const apply1 = await runCommand(process.execPath, [APPLY_SCRIPT, case1Pkg]);
    if (apply1.code !== 0) {
      throw new Error(`Case 1 apply failed with code ${apply1.code}. Stderr: ${apply1.stderr}`);
    }

    const case1ContentAfter = await fs.readFile(case1Exec, "utf8");
    if (!case1ContentAfter.includes("Resolve the session before the timeout return.")) {
      throw new Error("Case 1 apply did not insert marker comment.");
    }
    if (!case1ContentAfter.includes("sessionId: resolvedSessionId")) {
      throw new Error("Case 1 apply did not set sessionId in timeout return.");
    }

    const backupFile = path.join(path.dirname(case1Exec), "execute.js.pre-session-guard");
    if (!fsSync.existsSync(backupFile)) {
      throw new Error("Case 1 apply did not create backup file execute.js.pre-session-guard.");
    }
    const backupContent = await fs.readFile(backupFile, "utf8");
    if (backupContent !== originalUnpatchedContent) {
      throw new Error("Case 1 backup file content does not match original unpatched content.");
    }
    console.log("  ✓ Case 1 passed: Successfully applied patch and verified backup.");

    // -------------------------------------------------------------
    // Case 2: 第二次应用 (Second apply / Idempotency)
    // -------------------------------------------------------------
    console.log("[simulate] Case 2: Second apply (Idempotency)");
    const apply2 = await runCommand(process.execPath, [APPLY_SCRIPT, case1Pkg]);
    if (apply2.code !== 0) {
      throw new Error(`Case 2 second apply failed with code ${apply2.code}. Stderr: ${apply2.stderr}`);
    }
    const case1ContentAfter2 = await fs.readFile(case1Exec, "utf8");
    if (case1ContentAfter2 !== case1ContentAfter) {
      throw new Error("Case 2 target file bytes changed during second apply (idempotency violation).");
    }
    console.log("  ✓ Case 2 passed: Second apply exited 0 with target file bytes unchanged.");

    // -------------------------------------------------------------
    // Case 3: 回滚 (Rollback)
    // -------------------------------------------------------------
    console.log("[simulate] Case 3: Rollback (--rollback)");
    const rollback = await runCommand(process.execPath, [APPLY_SCRIPT, "--rollback", case1Pkg]);
    if (rollback.code !== 0) {
      throw new Error(`Case 3 rollback failed with code ${rollback.code}. Stderr: ${rollback.stderr}`);
    }
    const rolledBackContent = await fs.readFile(case1Exec, "utf8");
    if (rolledBackContent !== originalUnpatchedContent) {
      throw new Error("Case 3 rollback content does not match original unpatched backup.");
    }
    // Verify behavior check again fails with code 4 after rollback
    const postRollbackCheck = await runCommand(process.execPath, [CHECK_SCRIPT, case1Pkg]);
    if (postRollbackCheck.code !== 4) {
      throw new Error(`Case 3 expected post-rollback check to fail with 4, got ${postRollbackCheck.code}`);
    }

    // Also test rollback without backup fails with non-zero exit code
    const { pkgDir: noBackupPkg } = await setupMockPackage(
      simDir,
      "case3-nobackup",
      "2026.1012.0",
      unpatchedSnippet
    );
    const noBackupRollback = await runCommand(process.execPath, [APPLY_SCRIPT, "--rollback", noBackupPkg]);
    if (noBackupRollback.code === 0) {
      throw new Error("Case 3 expected rollback without backup to exit non-zero, got 0.");
    }
    if (!noBackupRollback.stderr.startsWith("adapter-session-guard:")) {
      throw new Error(`Case 3 expected stderr prefix 'adapter-session-guard:', got: ${noBackupRollback.stderr}`);
    }
    console.log("  ✓ Case 3 passed: Rollback restored backup successfully and failed when backup absent.");

    // -------------------------------------------------------------
    // Case 4: 不支持版本 (Unsupported version)
    // -------------------------------------------------------------
    console.log("[simulate] Case 4: Unsupported version");
    const { pkgDir: case4Pkg, execPath: case4Exec } = await setupMockPackage(
      simDir,
      "case4-unsupported",
      "2026.1099.0",
      unpatchedSnippet
    );
    const case4Before = await fs.readFile(case4Exec, "utf8");
    const apply4 = await runCommand(process.execPath, [APPLY_SCRIPT, case4Pkg]);
    if (apply4.code !== 2) {
      throw new Error(`Case 4 expected exit code 2 for unsupported version, got ${apply4.code}. Stderr: ${apply4.stderr}`);
    }
    if (!apply4.stderr.startsWith("adapter-session-guard:")) {
      throw new Error(`Case 4 expected stderr prefix 'adapter-session-guard:', got: ${apply4.stderr}`);
    }
    const case4After = await fs.readFile(case4Exec, "utf8");
    if (case4Before !== case4After) {
      throw new Error("Case 4 file was modified despite unsupported version.");
    }
    console.log("  ✓ Case 4 passed: Exited with code 2 for unsupported version, file unmodified.");

    // -------------------------------------------------------------
    // Case 5: 锚点漂移 (Anchor drift)
    // -------------------------------------------------------------
    console.log("[simulate] Case 5: Anchor drift");
    const { pkgDir: case5Pkg, execPath: case5Exec } = await setupMockPackage(
      simDir,
      "case5-drifted",
      "2026.1012.0",
      driftedSnippet
    );
    const case5Before = await fs.readFile(case5Exec, "utf8");
    const apply5 = await runCommand(process.execPath, [APPLY_SCRIPT, case5Pkg]);
    if (apply5.code !== 3) {
      throw new Error(`Case 5 expected exit code 3 for anchor drift, got ${apply5.code}. Stderr: ${apply5.stderr}`);
    }
    if (!apply5.stderr.startsWith("adapter-session-guard:")) {
      throw new Error(`Case 5 expected stderr prefix 'adapter-session-guard:', got: ${apply5.stderr}`);
    }
    const case5After = await fs.readFile(case5Exec, "utf8");
    if (case5Before !== case5After) {
      throw new Error("Case 5 file was modified despite anchor drift.");
    }
    console.log("  ✓ Case 5 passed: Exited with code 3 for anchor drift, file unmodified.");

    console.log("\n[simulate] ALL 5 CASES PASSED SUCCESSFULLY (Exit code 0).");
    process.exit(0);
  } finally {
    try {
      await fs.rm(simDir, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error(`adapter-session-guard: simulate failed: ${err.message}`);
  process.exit(1);
});
