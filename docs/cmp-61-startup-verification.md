# CMP-61 启动配置独立验证

- 验证人：丁仪-GROK
- 基线：`130a88f`（交付）+ `52a7ba3`（文档）
- 工作分支：`cmp-61/startup-config`（本地，未推送）
- 验证时间：2026-10-12
- 环境：Node v24.18.1，Docker Compose v5.5.1，系统 ffmpeg 8.1.2；本机 **没有** 监听 5432 的 PostgreSQL，也 **没有** 可用的浏览器 MCP

本记录只覆盖启动配置、示例、compose 传递、鉴权拒绝启动、令牌/显式关闭、非法 `FFMPEG_PATH`。未重跑 CMP-32 / H1 / D1–D6 回归。未调用付费 AI/TTS。未合并 `main`。

## 1. 示例与 compose 合同

| 检查 | 执行 | 结果 |
| --- | --- | --- |
| 根目录 `.env.example` 列出 `DUB_ACCESS_TOKEN` / `DUB_AUTH_MODE` / `EXPORT_PROFILE` / `FFMPEG_PATH` 及 fail-closed 含义 | 实际执行 | 通过；令牌默认空，`DUB_AUTH_MODE=disabled` 保持注释 |
| `ebook-api/.env.example` 同步上述选项 | 实际执行 | 通过 |
| `ebook-ui/.env.example` 说明 `VITE_DUB_ACCESS_TOKEN` 仅为本地回退 | 实际执行 | 通过 |
| `docker compose config` 未配置 | 实际执行 | `DUB_ACCESS_TOKEN: ""`、`DUB_AUTH_MODE: ""`、`EXPORT_PROFILE: ""`、`FFMPEG_PATH: ""`。空值透传，**没有**改成 disabled，**没有**植入令牌 |
| `docker compose config` 用户选择 | 实际执行 | `DUB_ACCESS_TOKEN=user-token-abc`、`EXPORT_PROFILE=wav-legacy`、`FFMPEG_PATH=/not/a/real/ffmpeg` 原样出现在渲染结果 |
| `DUB_AUTH_MODE=disabled` 传递 | 实际执行 | 渲染为 `DUB_AUTH_MODE: disabled` |

## 2. 四类行为

| 行为 | 方法 | 执行 | 结果 | 环境限制 |
| --- | --- | --- | --- | --- |
| 未配置 | `resolveAuthConfig({})`；真实 `node index.js` 无令牌 | 实际执行 | 退出码 1，stderr：`Refusing to start: DUB_ACCESS_TOKEN is not set`，并提示可设 `DUB_AUTH_MODE=disabled` | 在数据库初始化之前失败，不依赖 PostgreSQL |
| 令牌模式 | `resolveAuthConfig`；`createApp` HTTP；真实 `index.js` + `DUB_ACCESS_TOKEN` | 实际执行 | 配置启用鉴权；`/api/health` 不要求令牌；`/api/books` 无令牌 401；Bearer / `access_token` 查询参数可通过鉴权；进程在 schema 前打印 `Authentication enabled` | 完整 `index.js` 听端口需要 PostgreSQL/S3，本机 5432 未监听，故未宣称服务已对外就绪 |
| 显式关闭 | `resolveAuthConfig({DUB_AUTH_MODE:disabled})`；`createApp` HTTP；真实 `index.js` | 实际执行 | 配置 `enabled:false`；`/api/books` 不再 401；进程打印 `AUTHENTICATION IS DISABLED` | 同上，未做到达 `running at` 的全栈启动 |
| 非法 ffmpeg 路径 | `resolveFfmpegPath({FFMPEG_PATH: missing})` | 实际执行 | `path=null`，`source=FFMPEG_PATH`，错误含「不存在或不可执行」，不回退到 PATH 中的其它二进制 | 未跑章节导出作业（避免重复已完成导出回归，且无业务音频夹具） |

## 3. UI / API 令牌路径

缺陷：API 启用令牌后，界面原先只读 `localStorage.dub_access_token` 与构建期 `VITE_DUB_ACCESS_TOKEN`，没有任何写入入口；Docker UI 也不烘焙该变量。按文档配置令牌后，界面会对 `/api/books` 得到 401。

已收口：

- 系统设置新增「访问令牌」页，写入 `localStorage`
- Axios 401 时顶栏提示并链到 `/settings?tab=access`
- 请求头 `Authorization: Bearer`，媒体 URL `?access_token=`
- Docker 镜像仍不烘焙令牌

| 检查 | 执行 | 结果 |
| --- | --- | --- |
| `ebook-ui/test/accessToken.test.mjs` | 实际执行 | 4/4 通过 |
| `vite build` 产物含「访问令牌」「去填写令牌」 | 实际执行 | 通过 |
| 浏览器里点击保存令牌并刷新书籍列表 | 未执行 | 无浏览器 MCP；未起全栈 UI |

## 4. 自动化

```text
node --test test/cmp61-startup-config.test.js test/auth.test.js test/ffmpegBinary.test.js
# 24 pass / 0 fail

node --test test/accessToken.test.mjs
# 4 pass / 0 fail
```

未执行：`docker compose up --build` 全栈（镜像构建与 MinIO/Postgres 拉起超出本验证最小证明；compose 插值已用 `docker compose config` 证明）。未执行付费供应商调用。未推送远端。

## 5. 程心操作说明

请把 README / 交付说明的适用 SHA 从「仅 130a88f + 52a7ba3」同步到本分支 HEAD（提交信息见任务评论）。运行说明以本分支 README 为准：复制 `.env.example`、compose 原样传递、安全默认拒绝启动、界面在系统设置填写令牌。
