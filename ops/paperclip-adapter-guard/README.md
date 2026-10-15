# OpenCode 超时会话补丁版本守护 (Adapter Session Guard)

针对 `@paperclipai/adapter-opencode-local` 的超时保留会话特性提供版本受控、可重复应用、带版本匹配的防护体系。当依赖升级重写 `node_modules` 时，自动防止会话保留逻辑丢失与行为回退。

## 目标与行为保持

目标包：`@paperclipai/adapter-opencode-local`
目标文件：`dist/server/execute.js` 的 `toResult` 函数

保留行为：
1. 进程在超时 (`attempt.proc.timedOut === true`) 分支返回保留的会话信息：
   - `sessionId`: `resolvedSessionId`
   - `sessionParams`: `resolvedSessionParams`
   - `sessionDisplayId`: `resolvedSessionId`
2. 会话清除逻辑保持受控：`clearSession` 为 `Boolean(clearSessionOnMissingSession && !resolvedSessionId)`。
3. 错误文案保持有界：``Timed out after ${timeoutSec}s``。
4. 识别标记注释：`Resolve the session before the timeout return.`。

## 版本支持范围

仅支持 `@paperclipai/adapter-opencode-local` 的以下版本：
- `2026.1005.0`
- `2026.1012.0`

其他版本拒绝修改并以退出码 2 退出。

## 退出码规范

| 退出码 | 含义 |
| :---: | :--- |
| `0` | 已是目标内容，或本次应用成功且行为检查通过 |
| `2` | 版本不在支持范围，打印实际版本和支持范围，不修改文件 |
| `3` | 版本受支持但锚点漂移，拒绝改写；或目标文件缺失 |
| `4` | 行为回退（超时结果丢掉会话 id，或超时不再有界） |

所有标准错误输出均带有前缀 `adapter-session-guard:`。

## 幂等性 (Idempotency)

- 对已打补丁的文件再次执行 `apply.mjs`，目标文件字节完全不变，退出码为 `0`。
- 不会产生多重补丁或重复标记。

## 回滚机制 (Rollback)

- 首次改写前，会自动将原始文件备份到同目录的 `execute.js.pre-session-guard`。
- 运行 `node ops/paperclip-adapter-guard/apply.mjs --rollback [path]` 可恢复备份。
- 若没有备份文件，退出非 0 并输出告警前缀。
- 回滚操作不会删除仓库代码。

## 升级钩子 (Upgrade Hook)

通过 `/home/user/.local/bin/paperclipai` 用户态入口拦截升级操作：
- `run` 以及 `update`/`upgrade` 以外的命令直接 `exec` Node 入口，保证 systemd `Type=notify` 主进程不丢失。
- 仅当运行 `update` 或 `upgrade` 且不包含 `--check` 或 `--dry-run` 时，在 CLI 完成后自动运行 `apply.mjs` 与 `check.mjs`。
- 守护校验失败时输出 `adapter-session-guard:` 并返回非 0。

## 禁止事项 (Prohibited Actions)

1. **禁止修改 npx 缓存**：不要修改 `~/.npm/_npx/43414d9b790239bb`。
2. **禁止重启服务**：不要重启 `paperclipai.service`。
3. **禁止修改 systemd 单元**：不得修改任何 systemd unit 配置文件。
4. **禁止放宽超时或增加重试**：禁止将生产超时改为无限，禁止增加自动重试次数。生产环境 OpenCode 保持 900 秒有界超时。
5. **禁止敏感凭证入库**：禁止将 token、Authorization 头、keyring 或 API key 写入代码库、提交信息或评论日志。
6. **禁止直接修改共享检出**：使用独立 Git worktree 进行开发，不得破坏共享检出的状态。
