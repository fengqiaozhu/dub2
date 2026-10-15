#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { runCheck, resolveTargets } from "./check.mjs";

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const MANIFEST_PATH = path.join(SCRIPT_DIR, "manifest.json");
const manifest = JSON.parse(fsSync.readFileSync(MANIFEST_PATH, "utf8"));

const ORIGINAL_SHIM_HASH = "02fee708333391d406dd71fe4e5731bab851b28a970ac356666312e6c457160c";
const SHIM_PATH = "/home/user/.local/bin/paperclipai";

function warn(msg) {
  console.error(`adapter-session-guard: ${msg}`);
}

const START_ANCHOR = "const toResult = (attempt, clearSessionOnMissingSession = false) => {\n";
const END_ANCHOR = "const parsedError = typeof attempt.parsed.errorMessage === \"string\"";

const PATCHED_SNIPPET =
`            // Resolve the session before the timeout return. A SIGTERM still has
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
                    errorMessage: \`Timed out after \${timeoutSec}s\`,
                    clearSession: Boolean(clearSessionOnMissingSession && !resolvedSessionId),
                    sessionId: resolvedSessionId,
                    sessionParams: resolvedSessionParams,
                    sessionDisplayId: resolvedSessionId,
                };
            }
`;

function isAlreadyPatched(content) {
  return (
    content.includes(manifest.marker) &&
    content.includes("Boolean(clearSessionOnMissingSession && !resolvedSessionId)") &&
    content.includes("sessionId: resolvedSessionId,") &&
    content.includes("sessionParams: resolvedSessionParams,") &&
    content.includes("sessionDisplayId: resolvedSessionId,")
  );
}

function hasUnpatchedAnchor(body) {
  return (
    body.includes("if (attempt.proc.timedOut)") &&
    body.includes("clearSession: clearSessionOnMissingSession") &&
    body.includes("const resolvedSessionId = attempt.parsed.sessionId ??") &&
    body.includes("const resolvedSessionParams = resolvedSessionId")
  );
}

export async function installShimHook() {
  if (!fsSync.existsSync(SHIM_PATH)) {
    warn(`Shim file not found at ${SHIM_PATH}`);
    return 3;
  }

  const currentContent = await fs.readFile(SHIM_PATH, "utf8");
  if (currentContent.includes("# paperclipai managed install shim with adapter-session-guard hook")) {
    console.log("adapter-session-guard: Hook is already installed in " + SHIM_PATH);
    return 0;
  }

  const currentHash = crypto.createHash("sha256").update(currentContent).digest("hex");
  if (currentHash !== ORIGINAL_SHIM_HASH) {
    warn(`Shim sha256 mismatch: expected ${ORIGINAL_SHIM_HASH}, got ${currentHash}. Refusing to overwrite.`);
    return 3;
  }

  const newShimContent = `#!/bin/sh
# paperclipai managed install shim with adapter-session-guard hook
set -eu
export PATH='/usr/bin':"\${PATH:-/usr/local/bin:/usr/bin:/bin}"

CLI_ENTRY='/home/user/.paperclip/cli/current/node_modules/paperclipai/dist/index.js'
GUARD_DIR='/home/user/.paperclip/instances/default/projects/eeb4c759-7895-41f8-b40f-ec06cf31fc7e/b3b3f65a-5aaa-4d12-98cf-8ca7751e5344/cmp85-adapter-guard/ops/paperclip-adapter-guard'
if [ ! -d "$GUARD_DIR" ]; then
  GUARD_DIR='/home/user/.paperclip/instances/default/projects/eeb4c759-7895-41f8-b40f-ec06cf31fc7e/b3b3f65a-5aaa-4d12-98cf-8ca7751e5344/dub2/ops/paperclip-adapter-guard'
fi

cmd="\${1:-}"
case "$cmd" in
  update|upgrade)
    has_check=0
    for arg in "$@"; do
      case "$arg" in
        --check|--dry-run)
          has_check=1
          break
          ;;
      esac
    done
    if [ "$has_check" -eq 1 ]; then
      exec '/usr/bin/node' "$CLI_ENTRY" "$@"
    fi

    '/usr/bin/node' "$CLI_ENTRY" "$@"
    status=$?
    if [ "$status" -ne 0 ]; then
      exit "$status"
    fi

    if [ -f "$GUARD_DIR/apply.mjs" ] && [ -f "$GUARD_DIR/check.mjs" ]; then
      if ! '/usr/bin/node' "$GUARD_DIR/apply.mjs"; then
        echo "adapter-session-guard: apply failed after $cmd" >&2
        exit 1
      fi
      if ! '/usr/bin/node' "$GUARD_DIR/check.mjs"; then
        echo "adapter-session-guard: check failed after $cmd" >&2
        exit 1
      fi
    else
      echo "adapter-session-guard: guard scripts not found in $GUARD_DIR" >&2
      exit 1
    fi
    ;;
  *)
    exec '/usr/bin/node' "$CLI_ENTRY" "$@"
    ;;
esac
`;

  await fs.writeFile(SHIM_PATH, newShimContent, { mode: 0o755 });
  console.log(`adapter-session-guard: Successfully installed hook in ${SHIM_PATH}`);
  return 0;
}

export async function rollbackTarget(targetInput) {
  const { executeFile } = resolveTargets(targetInput);
  if (!executeFile) {
    warn(`Target execute.js could not be resolved for ${targetInput || "default current install"}`);
    return 1;
  }

  const backupFile = path.join(path.dirname(executeFile), "execute.js.pre-session-guard");
  if (!fsSync.existsSync(backupFile)) {
    warn(`No backup file found at ${backupFile} to rollback.`);
    return 1;
  }

  const backupContent = await fs.readFile(backupFile, "utf8");
  await fs.writeFile(executeFile, backupContent, "utf8");
  console.log(`adapter-session-guard: Successfully rolled back ${executeFile} from ${backupFile}`);
  return 0;
}

export async function applyTarget(targetInput, options = {}) {
  const { executeFile, pkgJsonFile } = resolveTargets(targetInput);

  if (!executeFile || !fsSync.existsSync(executeFile)) {
    warn(`Target execute.js not found for ${targetInput || "default current install"}`);
    return 3;
  }

  // Version check
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

  const content = await fs.readFile(executeFile, "utf8");

  // Idempotency: if already patched, make no file changes and verify behavior
  if (isAlreadyPatched(content)) {
    console.log(`adapter-session-guard: Already target content in ${executeFile} (idempotent, 0 bytes modified).`);
    if (options.skipCheck) {
      return 0;
    }
    const checkCode = await runCheck(targetInput);
    if (checkCode !== 0) {
      warn(`Behavior check failed with code ${checkCode}`);
      return checkCode;
    }
    return 0;
  }

  const startIdx = content.indexOf(START_ANCHOR);
  const endIdx = content.indexOf(END_ANCHOR);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    warn(`Version is supported but anchor drifted in ${executeFile}; refusing rewrite.`);
    return 3;
  }

  const bodyBetween = content.slice(startIdx + START_ANCHOR.length, endIdx);
  if (!hasUnpatchedAnchor(bodyBetween)) {
    warn(`Anchor pattern not matched in ${executeFile}; refusing rewrite.`);
    return 3;
  }

  // Backup before first rewrite
  const backupFile = path.join(path.dirname(executeFile), "execute.js.pre-session-guard");
  if (!fsSync.existsSync(backupFile)) {
    await fs.writeFile(backupFile, content, "utf8");
  }

  const newContent = content.slice(0, startIdx + START_ANCHOR.length) + PATCHED_SNIPPET + content.slice(endIdx);
  await fs.writeFile(executeFile, newContent, "utf8");
  console.log(`adapter-session-guard: Successfully applied patch to ${executeFile}`);

  if (options.skipCheck) {
    return 0;
  }

  const checkCode = await runCheck(targetInput);
  if (checkCode !== 0) {
    warn(`Behavior check failed after patch with code ${checkCode}`);
    return checkCode;
  }

  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  let isRollback = false;
  let isInstallHook = false;
  const targets = [];

  for (const arg of args) {
    if (arg === "--rollback") {
      isRollback = true;
    } else if (arg === "--install-hook" || arg === "--install-shim") {
      isInstallHook = true;
    } else if (!arg.startsWith("-")) {
      targets.push(arg);
    }
  }

  if (isInstallHook) {
    const code = await installShimHook();
    process.exit(code);
  }

  if (targets.length === 0) {
    targets.push(null);
  }

  for (const target of targets) {
    let code;
    if (isRollback) {
      code = await rollbackTarget(target);
    } else {
      code = await applyTarget(target);
    }
    if (code !== 0) {
      process.exit(code);
    }
  }

  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((err) => {
    warn(`Fatal error: ${err.message}`);
    process.exit(1);
  });
}
