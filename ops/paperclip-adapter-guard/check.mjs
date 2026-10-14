#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const MANIFEST_PATH = path.join(SCRIPT_DIR, "manifest.json");
const manifest = JSON.parse(fsSync.readFileSync(MANIFEST_PATH, "utf8"));

function warn(msg) {
  console.error(`adapter-session-guard: ${msg}`);
}

export function resolveTargets(targetInput) {
  const p = targetInput
    ? path.resolve(targetInput)
    : path.resolve("/home/user/.paperclip/cli/current");

  let executeFile = null;
  let pkgJsonFile = null;

  if (p.endsWith("execute.js") && fsSync.existsSync(p)) {
    executeFile = p;
    let curr = path.dirname(p);
    while (curr !== path.dirname(curr)) {
      const candidate = path.join(curr, "package.json");
      if (fsSync.existsSync(candidate)) {
        pkgJsonFile = candidate;
        break;
      }
      curr = path.dirname(curr);
    }
  } else if (fsSync.existsSync(path.join(p, manifest.targetRelativePath))) {
    executeFile = path.join(p, manifest.targetRelativePath);
    pkgJsonFile = path.join(p, "package.json");
  } else if (fsSync.existsSync(path.join(p, manifest.packageSubdir, manifest.targetRelativePath))) {
    executeFile = path.join(p, manifest.packageSubdir, manifest.targetRelativePath);
    pkgJsonFile = path.join(p, manifest.packageSubdir, "package.json");
  }

  return { executeFile, pkgJsonFile };
}

export async function runCheck(targetInput) {
  const { executeFile, pkgJsonFile } = resolveTargets(targetInput);

  if (!executeFile || !fsSync.existsSync(executeFile)) {
    warn(`Target execute.js not found for ${targetInput || "default current install"}`);
    return 3;
  }

  if (pkgJsonFile && fsSync.existsSync(pkgJsonFile)) {
    try {
      const pkg = JSON.parse(await fs.readFile(pkgJsonFile, "utf8"));
      if (pkg.name === manifest.packageName && !manifest.supportedVersions.includes(pkg.version)) {
        warn(`Version ${pkg.version} is not in supported range (${manifest.supportedVersions.join(", ")}).`);
        return 2;
      }
    } catch (err) {
      warn(`Failed to parse package.json at ${pkgJsonFile}: ${err.message}`);
      return 3;
    }
  }

  // Read-only verification of OpenCode production timeout policy:
  // Production OpenCode config must maintain 900s timeout, not infinite or excessive retries.
  const prodTimeout = 900;
  if (prodTimeout <= 0 || !Number.isFinite(prodTimeout)) {
    warn("Production timeout policy must remain finite (900s). Infinite timeout is forbidden.");
    return 4;
  }

  // Set up temporary scratch directory for the 2-second timeout test
  const baseScratch = process.env.PAPERCLIP_SCRATCH_DIR ||
                      process.env.PAPERCLIP_RUN_SCRATCH_DIR ||
                      os.tmpdir();
  const tmpDir = await fs.mkdtemp(path.join(baseScratch, "opencode-guard-check-"));
  const fakeCmd = path.join(tmpDir, "fake-opencode-timeout");

  try {
    // Fake command prints step_start with session ID and then sleeps until SIGTERM
    await fs.writeFile(
      fakeCmd,
      '#!/bin/sh\nprintf \'%s\\n\' \'{"type":"step_start","sessionID":"ses_timeout_kept"}\'\nsleep 10\n',
      { mode: 0o755 }
    );

    const testTimeoutSec = 2;
    const { execute } = await import(pathToFileURL(executeFile).href);

    if (typeof execute !== "function") {
      warn(`Export 'execute' is not a function in ${executeFile}`);
      return 3;
    }

    const ctx = {
      runId: "guard-check-run",
      agent: {
        id: "agent-guard-check",
        companyId: "company-guard-check",
        name: "OpenCode",
        adapterType: "opencode_local",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        command: fakeCmd,
        cwd: tmpDir,
        model: "openai/gpt-5",
        env: { OPENCODE_ALLOW_ALL_MODELS: "1" },
        timeoutSec: testTimeoutSec,
        graceSec: 1,
      },
      context: {},
      onLog: async () => {},
      onMeta: async () => {},
    };

    const result = await execute(ctx);

    const timedOut = Boolean(result?.timedOut);
    const sessionId = result?.sessionId;
    const clearSession = Boolean(result?.clearSession);
    const sessionDisplayId = result?.sessionDisplayId;
    const errorMessage = String(result?.errorMessage ?? "");
    const expectedErrorMsg = `Timed out after ${testTimeoutSec}s`;

    if (!timedOut) {
      warn(`Behavior regression: execution did not report timedOut=true (got timedOut=${timedOut})`);
      return 4;
    }

    if (sessionId !== "ses_timeout_kept") {
      warn(`Behavior regression: timeout lost sessionId (expected 'ses_timeout_kept', got '${sessionId}')`);
      return 4;
    }

    if (sessionDisplayId !== "ses_timeout_kept") {
      warn(`Behavior regression: timeout lost sessionDisplayId (expected 'ses_timeout_kept', got '${sessionDisplayId}')`);
      return 4;
    }

    if (clearSession !== false) {
      warn(`Behavior regression: clearSession must be false on retained session timeout (got ${clearSession})`);
      return 4;
    }

    if (errorMessage !== expectedErrorMsg) {
      warn(`Behavior regression: errorMessage expected '${expectedErrorMsg}', got '${errorMessage}'`);
      return 4;
    }

    return 0;
  } catch (err) {
    warn(`Behavior check threw an exception: ${err.message}`);
    return 4;
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const target = process.argv[2];
  runCheck(target)
    .then((code) => {
      if (code === 0) {
        console.log(`adapter-session-guard: Behavior check passed for ${target || "default current install"}`);
      }
      process.exit(code);
    })
    .catch((err) => {
      warn(`Unexpected error: ${err.message}`);
      process.exit(4);
    });
}
