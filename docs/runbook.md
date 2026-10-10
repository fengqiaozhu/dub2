# dub2 运行与运维说明 (Runbook)

本文档归档于任务 [CMP-27](/CMP/issues/CMP-27)，作为 dub2 项目本地开发、容器部署、CI 校验、健康检查与运维脚本的标准操作指南。

---

## 1. 系统架构与端口定义

dub2 包含前后端分离架构与基础设施依赖：

- **`ebook-api`**：Node.js Express 5 服务，集成 Bree 任务队列、PostgreSQL 连接池与 S3/MinIO 对象存储。
- **`ebook-ui`**：Vue 3 + Vite 前端应用（生产环境通过 Nginx 托管）。
- **PostgreSQL 16**：存储书籍、章节、对话、声音配置与任务状态。
- **MinIO / AWS S3**：存储封面图片、角色声音样本与章节合成音频。

### 标准端口矩阵

| 服务 | 端口 | 协议 / 路径 | 说明 |
| --- | --- | --- | --- |
| **API 服务** | `13000` | HTTP (`/api/*`, `/media/*`) | 后端核心 API 与媒体资源访问端口 |
| **UI 页面 (Docker)** | `13001` | HTTP (`/`) | 生产容器映射端口（容器内 80） |
| **UI 开发 (Vite)** | `5173` | HTTP (`/`) | 本地 Vite 开发调试端口（反向代理至 13000） |
| **PostgreSQL** | `5432` | TCP | 关系型数据库 |
| **MinIO API** | `9000` | HTTP / S3 API | 对象存储 S3 兼容 API 端口 |
| **MinIO 控制台** | `9001` | HTTP Web UI | MinIO 对象存储管理控制台 |

---

## 2. 启动路径指南

dub2 支持**本地独立启动**与 **Docker Compose 容器化启动**两条路径。

### 路径 A：本地独立运行 (Node.js + Vite)

适合日常调试与单元测试。

#### 前置要求
- Node.js 20+ 及 npm
- 本地或远程可访问的 PostgreSQL 数据库与 S3/MinIO 实例
- 系统已安装 `ffmpeg`（用于音频合成与导出）

#### 必要环境变量 (`.env` 或系统环境变量)

```bash
# 核心端口与存储配置
PORT=13000
DATABASE_URL=postgres://ebook:ebook@localhost:5432/ebook

# 对象存储 (MinIO / S3)
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=ebook
S3_ACCESS_KEY_ID=ebook
S3_SECRET_ACCESS_KEY=ebook-secret
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true

# FFmpeg 二进制路径：跳过安装脚本时必须设置 FFMPEG_BIN 指向真实 ffmpeg；Docker 镜像已经设置。装不上二进制时，导出应失败而不是报成功。
FFMPEG_BIN=/usr/bin/ffmpeg

# AI / TTS 供应商配置 (可选，按需配置)
OPEN_AI_API_KEY=
OPEN_AI_API_URL=https://api.deepseek.com
OPEN_AI_MODEL=deepseek-v4-pro
MOSI_API_KEY=
MOSI_BASE_URL=https://studio.mosi.cn
FISH_API_KEY=
FISH_DEFAULT_MODEL=
FISH_SELF_HOSTED_BASE_URL=
```

#### 启动步骤

1. **数据库初始化**：
   ```bash
   cd ebook-api
   npm ci --ignore-scripts
   npm run schema:init
   ```

2. **启动 API 服务**：
   ```bash
   npm start
   # 服务将监听在 http://localhost:13000
   ```

3. **启动 UI 前端**：
   ```bash
   cd ../ebook-ui
   npm ci --ignore-scripts
   npm run dev
   # 前端开发服务监听在 http://localhost:5173
   ```

---

### 路径 B：Docker Compose 容器化运行

适合一体化集成部署与演示。

#### 启动命令
```bash
# 在项目根目录下执行
docker compose up -d
```

Compose 将自动编排启动：
1. `postgres` (健康检查通过后放行 `api`)
2. `minio` (健康检查通过后放行 `api`)
3. `api` (构建 `ebook-api/Dockerfile` 并监听 `13000`)
4. `ui` (构建 `ebook-ui/Dockerfile` Nginx 容器并监听 `13001`)

#### 停止命令
```bash
docker compose down
```

---

## 3. 健康检查规范 (`GET /api/health`)

API 服务在端口 `13000` 暴露 `/api/health` 端点，对关键基础设施组件执行探测。

### 接口定义
- **请求方式**：`GET /api/health`
- **响应格式**：`application/json`

### 正常响应 (HTTP 200 OK)
当 API 自身正常且 PostgreSQL 与 S3 探测均成功时：
```json
{
  "data": {
    "ok": true,
    "checks": {
      "api": {
        "ok": true
      },
      "postgres": {
        "ok": true
      },
      "s3": {
        "ok": true,
        "bucket": "ebook"
      }
    }
  }
}
```

### 异常响应 (HTTP 503 Service Unavailable)
若任何一项下游依赖探测失败（例如数据库断开或 S3 凭据缺失）：
```json
{
  "data": {
    "ok": false,
    "checks": {
      "api": {
        "ok": true
      },
      "postgres": {
        "ok": true
      },
      "s3": {
        "ok": false,
        "error": "Could not load credentials from any providers"
      }
    }
  }
}
```

---

## 4. 本次环境实测与限制记录 (真实记录)

在本次任务执行环境中（运行于 Linux aarch64 `oneplus-enchilada` postmarketOS edge，Docker v29.8.1，Compose v5.5.1），实测结论如下：

1. **Docker 引擎状态**：Docker daemon 与 Compose 插件均正常可用。
2. **镜像缓存状态**：`postgres:16-alpine` 已存在本地缓存。
3. **镜像拉取限制**：拉取 `minio/minio:RELEASE.2025-04-22T22-12-26Z` 提示 `pull access denied for minio/minio, repository does not exist or may require 'docker login'`。因 MinIO 官方 Docker Hub 镜像分发策略调整，未配置专用私有凭据或镜像源时无法直接在线下载该镜像。
4. **实测结论**：
   - **不能假称 Compose 已联通**：由于缺少 MinIO 镜像，当前测试沙箱无法端到端启动完整 Compose 容器栈。
   - **本地代码校验 100% 通过**：
     - `ebook-api`：`npm run check` 语法校验通过；全量 40 项单元与集成测试（包含新增的 `doctor.test.js`）全部通过 (`pass 40, fail 0`)。
     - `ebook-ui`：全量 6 项单元测试全部通过 (`pass 6, fail 0`)；`vue-tsc -b && vite build` 生产构建完整成功。

---

## 5. 生命周期脚本策略对齐 (CI 与 Dockerfile)

### 策略原则
项目对依赖安装生命周期脚本（如 `postinstall`、`preinstall`）实施严格管控：
1. **CI 流程**（`.github/workflows/verify.yml`）：使用 `npm ci --ignore-scripts --no-audit --no-fund`，防止依赖安装阶段执行未经审计的外部二进制下载或脚本，保障 CI 执行速度、安全性与幂等性。CI 测试均采用逻辑模拟或 mock，不依赖宿主机器原生 ffmpeg。
2. **API Dockerfile**（`ebook-api/Dockerfile`）：对齐 CI 策略，使用 `RUN npm ci --ignore-scripts --no-audit --no-fund`。
3. **FFmpeg 支持**：在 Dockerfile 中通过 Debian 官方软件包源安装可靠的原生 ffmpeg (`apt-get install -y --no-install-recommends ffmpeg`)，并显式注入环境变量 `ENV FFMPEG_BIN=/usr/bin/ffmpeg`。`ffmpeg-static` 在运行时直接识别该环境变量指向系统二进制，无需在 `npm install` 阶段通过不可控脚本从 GitHub Release 动态下载二进制文件。跳过安装脚本时必须设置 `FFMPEG_BIN` 指向真实 ffmpeg；Docker 镜像已经设置。装不上二进制时，导出应失败而不是报成功。

---

## 6. 服务重启与任务安全策略 (H2)

### 安全恢复策略说明
在 `ebook-api/src/services/jobManager.js` 的 `start()` 启动序列中：
```javascript
// 1. 修复重启前遗留的未完成僵尸任务（将所有 PENDING 或 RUNNING 状态的任务直接安全标记为 FAILED）
const staleCount = await jobRepository.markStaleJobsAsFailed();

// 2. 清理超过 7 天的历史任务
await jobRepository.cleanupOldJobs(7);
```

### 设计决策理由
1. **防止重复计费与冲突**：配音与导出任务涉及调用第三方大模型/TTS 付费接口及状态哈希变更。当 API 进程意外中断或重启时，内存中的 Bree worker 已经销毁。若盲目自动恢复 (auto-resume) 正在执行的任务，可能导致二次付费请求、音频片段竞争或写入冲突。
2. **明确状态终态**：将未完成的任务确切置为 `FAILED`，消除前端一直显示轮询 `PENDING`/`RUNNING` 的假死现象。
3. **运维与用户行为指南**：重启后被置为 `FAILED` 的任务属于**预期安全保护机制**，非程序崩溃遗留未解 Bug。操作人员或前端用户应按需在控制台或界面上重新触发相应章节的配音或导出任务。

---

## 7. 运维脚本与诊断说明 (T3)

运维脚本位于 `ebook-api/scripts/` 目录下，支持数据巡检、备份与恢复。

### 7.1 数据库与存储一致性检查 (`doctor.js`)

#### 功能
检查数据库中引用的所有媒体资源（涵盖 `books.cover_url`、`dialogues.audio_url`、`voice_profiles.sample_audio_url`、`chapter_audio_exports.audio_url`）是否在对象存储中真实存在，以及是否被 `storage_objects` 元数据表正确索引。

#### 运行方式
```bash
cd ebook-api
npm run doctor
```

#### 输出格式示例
```json
{
  "referenced": 42,
  "storage_records": 42,
  "missing_objects": [],
  "untracked_references": [],
  "ok": true
}
```

#### 失败路径与说明
- **数据库连接失败**：脚本捕获异常，打印错误详情，退出码为 `1`。
- **存储对象缺失 (`missing_objects`)**：数据库记录了某媒体 URL，但 S3 中 `headObject` 返回 404（文件不存在）。`ok` 为 `false`，退出码为 `1`。排查方向：检查 S3 Bucket 是否被手动清理或数据丢失。
- **元数据未跟踪 (`untracked_references`)**：S3 文件存在，但 `storage_objects` 表缺少记录。`ok` 为 `false`，退出码为 `1`。
- **自动化测试保障**：已在 `ebook-api/test/doctor.test.js` 中构建可重复的单元测试矩阵，全面覆盖对象存在、对象缺失、元数据漏记、无效 URL 忽略及数据库断连分支，无需依赖生产真实数据即可验证脚本逻辑的正确性。

---

### 7.2 数据全量备份 (`backup.js`)

#### 功能
导出 PostgreSQL 数据库转储与 S3 Bucket 内全量对象文件，并生成备份清单。

#### 运行方式
```bash
cd ebook-api
npm run backup [可选指定输出目录]
# 默认输出至 ebook-api/backups/backup-<ISO时间戳>/
```

#### 生成结构
```
backups/backup-2026-10-10T07-00-00-000Z/
├── database.dump            # pg_dump 二进制自定义格式转储
├── objects/                 # S3 对象镜像树
│   ├── books/...
│   └── audio/...
├── objects.manifest.json    # 对象元数据清单 (key, size, lastModified)
├── manifest.json            # 备份主清单 (引擎、bucket、时间)
└── env.example              # 配置模板副本
```

#### 失败路径与说明
- 若缺少 `DATABASE_URL`，抛出 `DATABASE_URL is required` 异常退出。
- 若系统缺少 `pg_dump` 命令或数据库连接认证失败，`spawnSync` 退出码非 0 并终止备份。
- 若 S3 凭据无效或网络阻断，`storageService.listObjects` 报错退出。

---

### 7.3 数据全量恢复 (`restore.js`)

#### 功能
从备份目录恢复 PostgreSQL 数据并同步上传文件至 S3。

#### 运行方式
```bash
cd ebook-api
npm run restore -- /path/to/backup-dir
```

#### 失败路径与说明
- 若指定的备份目录不存在，报错 `Usage: npm run restore -- /path/to/backup-dir`。
- 若备份目录中缺少 `database.dump`，报错 `database.dump not found`。
- 若恢复目标缺少 `DATABASE_URL`，报错退出。
- 恢复采用 `pg_restore --clean --if-exists --no-owner` 机制，幂等清空现有旧数据并重建；恢复后自动调用 `storageService.ensureBucket()` 确保目标 Bucket 存在。

---

## 8. 回退策略 (Rollback Guide)

若升级或变更在生产或联调中发生异常，按以下方案回退：

### 8.1 代码与分支回退
回退至本次治理前的稳定基线提交（`main` 分支）：
```bash
git checkout 604bc53a38a6097541a3e3e15dd98d2980bd5352
```

### 8.2 Docker Compose 回退
1. 停止当前运行容器：
   ```bash
   docker compose down
   ```
2. 检出目标提交版本代码。
3. 重新无缓存构建并启动：
   ```bash
   docker compose build --no-cache
   docker compose up -d
   ```

### 8.3 数据库回退原则
- **非破坏性变更保障**：dub2 所有数据库架构定义（`ebook-api/src/repositories/postgres/schema.js`）均采用 `CREATE TABLE IF NOT EXISTS` 与增量字段扩展机制，未引入不可逆的 `DROP` 破坏性变更。
- **数据快照恢复**：若需完全恢复至升级前的某一业务数据快照，直接执行恢复脚本：
  ```bash
  npm run restore -- /path/to/pre-upgrade-backup
  ```
