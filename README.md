<p align="center">
  <img src="ebook-ui/public/logo.png" alt="dub" width="220">
</p>

<h1 align="center">dub</h1>

<p align="center">
  <strong>电子书配音工作台</strong><br>
  把一本书拆成章节、角色、对白与旁白，再按句导演、按角色配音、按章导出。
</p>

<p align="center">
  <img alt="Vue 3" src="https://img.shields.io/badge/UI-Vue%203-42b883?style=flat-square">
  <img alt="Express" src="https://img.shields.io/badge/API-Express-000000?style=flat-square">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/DB-PostgreSQL%2016-4169E1?style=flat-square">
  <img alt="S3" src="https://img.shields.io/badge/Media-S3%20Compatible-FF9900?style=flat-square">
  <img alt="Docker" src="https://img.shields.io/badge/Deploy-Docker%20Compose-2496ED?style=flat-square">
</p>

<p align="center">
  <img src="docs/screenshots/workspace.png" alt="配音工作台" width="920">
</p>

<p align="center">
  <sub>工作台：章节、句级音轨、角色绑定、增量配音与章节拼接，全部发生在同一块画布上。</sub>
</p>

> [!IMPORTANT]
> **这份文档描述的是交付分支，不是默认分支。**
> 适用代码：`cmp-61/startup-config` @ `4d0b709`（完整 SHA `4d0b709049191e484285d6bd53eb8934eee71c3e`），基于交付提交 `130a88f` 与文档提交 `52a7ba3`。
> **该分支目前只在本地，尚未推送到远端**（`main` 同样仍指向 `604bc53`）。想按本文运行请先在本地检出该分支，不要假设远端已有。
> `main` 仍是升级前的 `604bc53`——在 `main` 上章节默认导出 WAV、没有访问控制，也没有角色档案与读音词典。
> 本阶段**不合并 main**，这是既定安排，不需要额外审批。若你从 `main` 运行，下文关于 MP3 导出、访问控制、角色档案的描述**都不成立**。

---

## 它解决什么

普通 TTS 把整章读成一条语音。**dub 把阅读变成制作。**

上传 EPUB / TXT 之后，系统会切章、抽角色、标对白，再让你为每个角色选定音色。配音不是一次性黑盒：每一句都有波形、状态、跳过与重配；标注、音色或情绪一变，过期音频会立刻标出来。做完一章，可以听拼接音轨，也可以把结构化源包交给下游流水线。

适合有声书制作、小说改编、多角色朗读，以及需要把数据留在自己机器上的私有化部署。访问控制是单操作者级别的共享密钥，**不是多用户账号体系**，详见[访问控制](#访问控制)与[已知限制](#已知限制)。

```text
选择书籍 → 选择章节 → 解析配音 → 导出
```

| 步骤 | 你在做什么 | 系统在做什么 |
| --- | --- | --- |
| 选择书籍 | 入库、手动补封面与元数据 | 解析格式、切章、把源文件写入对象存储 |
| 选择章节 | 在多书标签间切换，锁定当前章 | 加载正文、角色、对白与音频状态 |
| 解析配音 | 审 AI 标注、改角色、调情绪、绑音色 | 异步分析、规划多平台 TTS、按句合成 |
| 导出 | 听全章、下单句、交下游 | 拼接音轨、打包源包、记录哈希以免过期 |

---

## 功能

### 1. 书籍管理 — 文本进入制作线

<p align="center">
  <img src="docs/screenshots/library.png" alt="书籍管理" width="920">
</p>

书籍库是工作流的入口。支持 **EPUB、TXT** 拖拽或点击上传；也可以不依赖现成电子书，直接新建一本空白书并写入第一章。`.mobi` 仍出现在上传允许的扩展名里，但当前无法解析，见[已知限制](#已知限制)。

上传后会自动：

- 解析目录与正文，按章落入 PostgreSQL
- 把源文件写入对象存储
- 记录**格式**与**章数**

摄入**不会**自动读取以下内容，需要你在书籍详情里手动填写或上传：

| 字段 | 摄入时的实际值 |
| --- | --- |
| 书名 | 直接取上传的文件名（不含扩展名），不从书内元数据读取 |
| 作者、出版社、出版年、ISBN、简介、标签 | 留空 |
| 封面 | 留空。摄入链路不抽取内嵌封面，需用「上传封面」单独写入对象存储 |

库内能力包括书名与作者搜索、格式筛选、上传时间排序，以及封面、简介、标签、ISBN 等元数据编辑。由于作者字段不会被自动填充，按作者搜索需要先手动录入作者才有效。点进一本书，就会在工作台打开一个独立标签。

### 2. 配音工作台 — 章、句、角色、音轨

<p align="center">
  <img src="docs/screenshots/workspace.png" alt="配音工作台" width="920">
</p>

工作台是 dub 的核心。一次可以打开多本书，顶部标签保留各自的当前章节与后台任务；左侧是章节目录，中间是句级时间线，右侧是本章角色的音色绑定。

#### 章节与多书并行

- 左侧 **CHAPTERS** 列出全书目录，可新增、编辑、删除章节
- **VOICES** 汇总全书角色，并标记哪些角色出现在当前章
- 顶部书籍标签显示当前章号；配音或拼接进行中会显示「运行中」
- 刷新页面后，未完成的分析 / 配音 / 导出任务会自动接上轮询

#### AI 解析：角色、对白、语音提示

「AI 解析」把章节交给当前激活的大模型，做地毯式抽取，而不是摘要：

- 逐句提取对白，禁止概括或合并
- 被动作打断的一句对白会拆成连续两条
- 代词与无主语对白会回填到角色原名
- `emotion` 只保留能直接影响声音的提示（低声、急促、哽咽、冷笑……），动作和心理描写不会写进去

解析结果写入结构化表：章节角色、对白区间、全书角色汇总。旁白由正文中未标注为对白的部分自动生成，不必手工切完所有叙述。

#### 句级导演

中间画布把正文变成可编辑的时间线。你可以：

- **框选标注**：把一段原文标成某角色的对白，或改已有标注的范围
- **确认 / 手工修正**：区分 AI 草稿、手工标注与已确认
- **情绪**：为单句补上短促的语音表现提示，供支持情绪控制的 TTS 使用
- **跳过**：某句暂不配音，拼接时自动避开
- **筛选**：未标注 / 旁白 / 对白；问题 / 未配音 / 已过期 / 失败 / 已跳过 / 已完成

顶部计数会告诉你还剩多少段待标注、多少句待配音。每一句都有波形播放器，可单句试听、单句重配，或用顶部进度条按章顺序连播。

#### 音频状态，而不是「有文件就算完」

每句音频都带哈希。正文、音色、模型或情绪一变，状态会从「已完成」变成「已过期」，并提示需要重新配音。失败句、缺失句、跳过句分列统计，增量配音只处理变动与缺口，不必整章重来。

| 状态 | 含义 |
| --- | --- |
| 已完成 | 当前哈希匹配，可进入拼接 |
| 未配音 | 还没有音频 |
| 已过期 | 标注 / 音色 / 参数已变，旧音频作废 |
| 失败 | 合成出错，可单句或批量重试 |
| 已跳过 | 明确不进入音轨 |

#### 角色音色绑定

右侧是本章角色的快速绑定，左侧 VOICES 是全书绑定。旁白也是一个角色。每个角色可指定：

- 音色来源：系统音色、克隆音色或音色资产
- 所属平台：Mosi、Fish Audio、Fish Audio Self-Hosted
- 具体 `voice_id` / profile

同一章允许不同角色走不同平台。开始配音前会生成计划：每个 provider 负责多少句、哪些角色还没就绪。未绑音色的角色会拦住批量任务，避免合成到一半才发现缺声。

#### 配音与导出

底部操作条把「做」和「交」放在一起：

| 动作 | 行为 |
| --- | --- |
| 开始 AI 配音 | 按计划为待配句合成；未解析时也可先用旁白音色整章朗读 |
| 配音变动与缺失句 | 只重做过期、失败、新增句 |
| 重新配音全章 | 清空本章音频与拼接轨，全量重来 |
| 导出故事源包 | 下载结构化 JSON：正文段落、角色、speech unit、音频时间线、配音计划 |
| 导出本章单句 | 打包当前有效的单句音频 |
| 拼接本章 | 按阅读顺序用 ffmpeg 合成章节音轨，可在工作台直接播放和下载 |

默认导出 **MP3**：`mp3-192k` 档，CBR 192 kbps、44.1 kHz、立体声、`audio/mpeg`。设置 `EXPORT_PROFILE=wav-legacy` 可切回历史行为，产出 `pcm_s16le` / 44.1 kHz 立体声 WAV。当前**不提供** AAC，也**不做整书合并**。

导出文件写入 ID3 标签与封面附图，取值全部来自书籍上**已存在**的字段：

| 标签 | 取值 | 缺失时 |
| --- | --- | --- |
| `title` | 书名 + 章名 | 两者都为空则导出失败 |
| `album` | 书名 | 不写 |
| `artist` | `books.author` | 字段为空则不写 |
| `date` | `books.publish_year` | 非正数则不写 |
| 封面附图 | `books.cover_url` 指向的对象 | 对象读不到则跳过附图，导出照常完成 |

**响度**：`provisional-spoken-v1` 档，目标 -16 LUFS / -1.5 dBTP / LRA 11，由 ffmpeg `loudnorm` 两遍测量后线性归一。这是一个**可复现的技术档位**，不是听众听感标定，也不是任何平台的合规指标。独立测试用 `ebur128` 读到综合响度 -16.2 LUFS，**未做主观听感评估**。

以上都是标准媒体文件，**不构成对 ACX、Audible 或其他商业有声书分发平台的规格或审核合规承诺**。平台合规从未验证，请勿据此推断。

源包面向下游：分镜、混音、播放器或另一条制作管线都可以消费同一份文本—声音对齐数据，而不必再解析 EPUB。

### 3. 音色库 — 资产、平台、克隆

<p align="center">
  <img src="docs/screenshots/voices.png" alt="音色管理" width="920">
</p>

音色不是「一个 API Key 加一个 ID」。dub 把 **音色资产** 和 **平台音色** 分开：

- **音色资产**：你上传的样本（音频 + 文本 + 语种 + 授权状态）。一份资产可以克隆到多个 provider
- **平台音色**：Mosi / Fish Audio / 自建 Fish 上的系统声与已克隆声
- **克隆任务**：异步跟踪训练进度
- **能力矩阵**：逐模型展示系统音色、克隆、情绪、语速、音高、风格、时长与输出格式，一眼能看完

所有 provider 的 `streaming` 标志当前均为 `false`，dub2 **没有实现流式合成**：Fish Audio 返回的响应会被整段读入内存后再落盘。能力矩阵当前也不渲染这一列，因此不要把它当作已支持的能力。

顶部的 provider 卡片会显示配置是否生效、额度 / 套餐、推荐模型。Fish Audio 可拉官方模型目录；自建实例单独激活，适合内网推理。资产支持搜索、按平台过滤、批量克隆、收藏与删除。配音工作台选声时，收藏会排在前面。

克隆前会检查样本是否完整（有音频、文本够长、授权已确认），避免把半成品推到远端训练。

### 角色与读音词典

工作台左侧 **VOICES** 里，每个角色一行都写着「档案 · 别名 N · 规则 M」。点开就能管理这个角色的规范档案、别名与读音规则。

**角色档案（已实现）**

每个角色对应一条规范档案，记录规范名与首次出场章节。同一个角色在不同章节被写成不同叫法时，用别名把它们归到同一档案下：

| 操作 | 入口 |
| --- | --- |
| 查看档案与别名 | 工作台 VOICES → 展开角色 |
| 新增 / 删除别名 | 同上，档案面板内 |
| 接口 | `GET /api/books/{id}/character-profiles`、`POST /api/books/{id}/character-profiles/{profileId}/aliases`、`DELETE /api/books/{id}/aliases/{aliasId}` |

`alias` 规则会**替换送给 TTS 的朗读文本**：同一角色的别名在合成时被统一成规范名，跨章不再各念各的。

**读音规则（两类必须分清）**

| 规则类型 | 是否生效 |
| --- | --- |
| `alias` | **生效**。替换朗读文本 |
| `phoneme` | **不生效**。可保存，但 Mosi、Fish Audio、Fish Audio 自建都不支持 phoneme 标注，replacement 不会进入请求文本 |

新增规则前可以先看影响面：工作台会显示这条规则会影响本章多少句；规划阶段若命中无法执行的 phoneme 规则，会给出 `phoneme_skipped` 警告并继续。

**档案不等于全书一致性。** 档案提供的是稳定身份与别名关联。系统**不会**自动保证同一角色在全书所有章节的音色、情绪与读法一致——那需要你逐章检查。

接口：`GET/POST /api/books/{id}/pronunciation-rules`、`POST /api/books/{id}/pronunciation-rules/preview-impact`。

### 4. 系统配置 — 模型与 TTS 插槽

<p align="center">
  <img src="docs/screenshots/settings.png" alt="系统配置" width="920">
</p>

解析用的大模型和发音用的 TTS 都在设置里管理，互不绑死。

**AI 大模型配置**

- 兼容 OpenAI Chat Completions 的服务都能接：DeepSeek、SiliconFlow、Ollama、MiniMax 等
- 每套配置独立保存名称、API URL、Key、模型名
- 可标记为「推理模型」：分析时开启 thinking / 高推理力度，适合长章抽取；常规模型则走更快的直出
- 任意时刻只有一套处于「已激活」，工作台解析和 AI 对话都读这一套
- 环境变量作为数据库未配置时的回退

**TTS 语音平台配置**

- **Mosi**：Moss TTS，系统声 + 克隆，输出 WAV
- **Fish Audio**：官方 API，情绪提示、语速，单句输出可选 MP3 / WAV / Opus / PCM（**非流式**，响应整段缓冲）
- **Fish Audio Self-Hosted**：同一协议的自建端点

单句音频的格式由供应商与所选模型决定；章节拼接产物的格式由[导出档位](#导出档位)决定，默认 MP3。

每个平台可保存多套配置，但同时只激活一条。

**Key 的暴露范围**：设置界面不回显明文 Key，配置列表接口也不再返回密钥——`GET /api/settings/ai` 与 `GET /api/settings/tts` 只给出 `has_api_key` 布尔值。**但密钥在数据库里仍是明文存储，没有做静态加密**；因此一旦有人能连上数据库或读到数据卷，供应商密钥就会直接暴露。数据层访问控制不在本项目范围内。

### 5. AI 对话

侧栏的「AI 对话」直接使用当前激活的大模型，用来试 prompt、核对角色设定、或在配音前讨论文本处理策略。多会话保存在浏览器本地，推理模型会展示思考过程。它不替代工作台，只是把同一套模型配置拿到聊天里用。

### 6. 后台任务、存储与备份

耗时操作全部异步：

| 任务 | 典型触发 |
| --- | --- |
| `analyze_chapter` | 工作台「AI 解析」 |
| 批量 TTS | 「开始 AI 配音」/ 增量 / 全章重配 |
| 音色克隆 | 音色库上传并克隆 |
| `export_chapter_audio` | 「拼接本章」 |

任务带进度、可去重、可在页面刷新后恢复。进程重启时，遗留的 PENDING / RUNNING 会被标记失败，避免假死循环。

数据分层：

- **PostgreSQL**：书、章、角色、对白、绑定、任务、配置、对象索引
- **S3 兼容存储**（MinIO / AWS S3 / R2 / OSS）：源书、封面、音色样本、句级音频、章节导出
- 媒体访问走私有代理 `/media/{encoded-object-key}`，浏览器不直接拿存储凭据

备份是一份自包含目录：PostgreSQL custom dump + 镜像的对象文件 + manifest。恢复顺序是库 → 对象 → `doctor` 巡检。

---

## 架构

```mermaid
flowchart LR
  subgraph UI["ebook-ui · Vue 3"]
    Books[书籍库]
    Voices[音色库]
    Studio[配音工作台]
    Settings[模型 / TTS 配置]
  end

  subgraph API["ebook-api · Express"]
    Parser[EPUB / TXT 解析]
    AI[OpenAI 兼容分析]
    Planner[配音规划]
    Jobs[Bree 异步任务]
    TTS[TTS Provider 适配]
  end

  subgraph Data["数据层"]
    PG[(PostgreSQL)]
    S3[(S3 / MinIO)]
  end

  subgraph Providers["外部能力"]
    LLM[DeepSeek / MiniMax / Ollama ...]
    Mosi[Mosi]
    Fish[Fish Audio]
    FishLocal[Fish Self-Hosted]
  end

  Books --> Parser
  Parser --> PG
  Parser --> S3
  Studio --> AI
  AI --> LLM
  AI --> PG
  Studio --> Planner
  Voices --> TTS
  Planner --> Jobs
  Jobs --> TTS
  TTS --> Mosi
  TTS --> Fish
  TTS --> FishLocal
  TTS --> S3
  Settings --> PG
  Jobs --> PG
```

```text
.
├── ebook-api/    Express API · PostgreSQL · S3 · 解析 / AI / TTS / Job
└── ebook-ui/     Vue 3 + Vite · Pinia · wavesurfer.js
```

| 层 | 选型 |
| --- | --- |
| 界面 | Vue 3、Vite、Pinia、Vue Router |
| 波形 | wavesurfer.js |
| API | Express 5、Bree worker |
| 解析 | epub2、@lingo-reader/mobi-parser |
| 模型 | OpenAI SDK，指向任意兼容端点 |
| 语音 | Mosi、Fish Audio 官方、Fish 自建 |
| 拼接 | ffmpeg-static（缺失时回退 FFMPEG_PATH / 系统 ffmpeg） |
| 数据 | PostgreSQL 16、S3 兼容对象存储 |

---

## 运行环境

- Node.js 20+
- npm
- ffmpeg（章节拼接必需，解析顺序见下方[回退与排错](#回退与排错)）
- PostgreSQL 16+
- S3 兼容存储（MinIO、AWS S3、R2、OSS 等）
- 可选：DeepSeek / OpenAI 兼容 Key、Mosi Key、Fish Audio Key 或自建 Fish 地址

---

## 用 Docker 启动

API **必须**先决定访问控制方式，两项都不设会直接拒绝启动（见[访问控制](#访问控制)）。这是安全默认，不是漏配。先从示例生成仓库根目录 `.env`：

```bash
cp .env.example .env

# 方式一：启用共享密钥（推荐）
# 编辑 .env，把 DUB_ACCESS_TOKEN= 改成你自己生成的值：
#   openssl rand -hex 24

# 方式二：明确关闭鉴权，仅限本机试用
# 在 .env 里取消注释 DUB_AUTH_MODE=disabled
```

不要把示例改成默认关闭鉴权，也不要提交真实令牌或植入固定共享密钥。`docker-compose.yml` 会把你在 `.env` 里填写的 `DUB_ACCESS_TOKEN`、`DUB_AUTH_MODE`、`EXPORT_PROFILE`、`FFMPEG_PATH` 原样传给 API；空值也原样传递，因此未填写时启动失败并给出配置指引。

然后启动：

```bash
docker compose up --build
```

默认地址：

| 服务 | URL |
| --- | --- |
| 界面 | http://localhost:13001 |
| API | http://localhost:13000 |
| MinIO Console | http://localhost:9001 |

健康检查会同时探测 API、PostgreSQL 与对象存储，**且不需要令牌**（`/api/health` 是唯一的公开路径）：

```bash
curl http://localhost:13000/api/health
```

其余接口需要带上令牌：

```bash
curl -H "Authorization: Bearer $DUB_ACCESS_TOKEN" http://localhost:13000/api/books
```

界面不会从 Docker 镜像读取令牌。打开 http://localhost:13001 ，到 **系统设置 → 访问令牌** 填入与 `.env` 中相同的值。浏览器把它写进 `localStorage`（键 `dub_access_token`），之后 API 请求带 `Authorization: Bearer`，媒体地址带 `?access_token=`。

**回退**：如果 API 反复重启并打印 `Refusing to start: DUB_ACCESS_TOKEN is not set`，就是上面两项都没配。按 `.env.example` 的注释补上后重新 `docker compose up -d` 即可，无需重建镜像。

---

## 本地开发

先准备 PostgreSQL 和 S3，再配置 API：

```bash
cd ebook-api
cp .env.example .env
# 编辑 .env：填写 DUB_ACCESS_TOKEN，或取消注释 DUB_AUTH_MODE=disabled
npm install
npm run schema:init
npm start
```

`ebook-api/.env.example` 已列出 `DUB_ACCESS_TOKEN`、`DUB_AUTH_MODE`、`EXPORT_PROFILE`、`FFMPEG_PATH`、`DUB_CORS_ORIGIN` 及其安全含义。复制后若两项访问控制都留空，`npm start` 会打印 `Refusing to start` 并退出。

关键环境变量：

```dotenv
# 访问控制：两者必填其一，否则 API 拒绝启动
DUB_ACCESS_TOKEN=
# DUB_AUTH_MODE=disabled

# 章节导出档位：留空 = mp3-192k；填 wav-legacy 产出 WAV
EXPORT_PROFILE=

# ffmpeg：显式指定时若不可用会直接报错，不会静默回退
FFMPEG_PATH=

PORT=13000
DATABASE_URL=postgres://ebook:ebook@localhost:5432/ebook
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=ebook
S3_ACCESS_KEY_ID=ebook
S3_SECRET_ACCESS_KEY=ebook-secret
S3_FORCE_PATH_STYLE=true

OPEN_AI_API_KEY=
OPEN_AI_API_URL=https://api.deepseek.com
OPEN_AI_MODEL=deepseek-v4-pro

MOSI_API_KEY=
MOSI_BASE_URL=https://studio.mosi.cn

FISH_API_KEY=
FISH_DEFAULT_MODEL=s2.1-pro
FISH_SELF_HOSTED_BASE_URL=http://localhost:8080
```

另一个终端启动界面。Vite 会把 `/api` 与 `/media` 代理到 API：

```bash
cd ebook-ui
cp .env.example .env   # 可选：VITE_DUB_ACCESS_TOKEN 仅作本地回退
npm install
npm run dev
```

更稳妥的做法是启动后到 **系统设置 → 访问令牌** 填写，与 API 的 `DUB_ACCESS_TOKEN` 保持一致。

模型与 TTS 也可以不写在 `.env` 里，启动后到 **系统设置** 里添加并激活。环境变量只在数据库还没有激活配置时作为回退。

---

## 访问控制

dub 是**单操作者**工具。访问控制是共享密钥级别，不是账号体系。

启动时必须二选一，否则 API **拒绝启动**：

| 配置 | 行为 |
| --- | --- |
| `DUB_ACCESS_TOKEN=<任意非空字符串>` | 启用鉴权。除 `/api/health` 外，`/api/*` 与 `/media/*` 都需要 `Authorization: Bearer <token>` |
| `DUB_AUTH_MODE=disabled` | 显式关闭鉴权。启动日志会打印警告，`/api/*` 与 `/media/*` 对任何能连上的人开放 |

令牌也可以用查询参数传：`?access_token=<token>`（`<audio>`、`<img>` 等无法带请求头的场景需要它）。

界面路径与 API 一致：

| 位置 | 行为 |
| --- | --- |
| 系统设置 → 访问令牌 | 写入浏览器 `localStorage` 键 `dub_access_token` |
| Axios / `fetch` | `Authorization: Bearer <token>` |
| `<audio>` / `<img>` 等媒体 URL | `toMediaUrl` 附加 `?access_token=<token>` |
| 本地 Vite `VITE_DUB_ACCESS_TOKEN` | 仅当 localStorage 为空时回退；Docker UI **不**烘焙此值 |

```bash
curl -H "Authorization: Bearer $DUB_ACCESS_TOKEN" http://localhost:13000/api/books
```

未设置任何一项时进程会直接退出并报错，不会退化成「默认无认证」运行。**即使启用了鉴权，供应商 Key 在数据库中仍是明文存储**，请一并保护数据库与备份。

---

## 导出档位

| 配置 | 输出 |
| --- | --- |
| 不设（默认） | `mp3-192k`：CBR 192 kbps、44.1 kHz、立体声、`audio/mpeg`，带 ID3 与封面附图，响度目标 `provisional-spoken-v1`（-16 LUFS / -1.5 dBTP / LRA 11） |
| `EXPORT_PROFILE=wav-legacy` | `pcm_s16le` / 44.1 kHz 立体声 WAV，不做响度归一 |

档位只影响章节拼接产物的封装与响度处理，不影响单句合成。

**回退**：把 `EXPORT_PROFILE=wav-legacy` 写进 `.env` 后重启 API 即可，**不需要重建数据库、不需要重跑配音**，已生成的 MP3 也不受影响——每次导出按当前档位重新合成。

---

## 回退与排错

**ffmpeg 解析顺序**（`resolveFfmpegPath`）：

1. `FFMPEG_PATH` —— 显式指定。**注意：一旦设置，若指向的文件不存在或不可执行就直接报错，不做静默回退。**
2. `ffmpeg-static` 附带的二进制 —— `npm ci --ignore-scripts` 会跳过它的 postinstall 下载，此时这一档会解析失败。
3. 系统 `PATH` 中的 ffmpeg。

三个来源都拿不到时，章节导出会失败并给出提示，**不会把「没合成」报成成功**。修复方式：装系统 ffmpeg、执行 `npm rebuild ffmpeg-static`（或改用保留 postinstall 的 `npm ci`）、或设置 `FFMPEG_PATH`。

`npm run doctor` 的 `ok` 结果里包含 `ffmpeg.ok`，启动前排查可以先跑它。

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| API 反复重启，日志 `Refusing to start: DUB_ACCESS_TOKEN is not set` | 访问控制两项都没配 | 按 `.env.example` 设置 `DUB_ACCESS_TOKEN` 或 `DUB_AUTH_MODE=disabled` |
| 界面能开但书籍列表 401 | API 已启用令牌，浏览器未填写 | 系统设置 → 访问令牌，填入与 `.env` 相同的值 |
| 章节导出失败，提示找不到 ffmpeg | 三档都没解析到 | 见上 |
| `FFMPEG_PATH=... 指向的文件不存在或不可执行` | 显式指定的路径不可用 | 修正路径或改用系统 ffmpeg |
| 需要退回 WAV 交付 | 兼容性或工具链问题 | `EXPORT_PROFILE=wav-legacy` |
| 需要退回升级前行为 | 交付分支与 `main` 行为不同 | 切回 `main`（`604bc53`），此时无 MP3、无访问控制、无角色档案 |

### 启动配置的验证状态

下面的「已验证」是**实际执行**过的结果，不是推断。哪些没做、为什么没做，一并写明：

| 行为 | 验证方式 | 是否实际执行 | 结论 |
| --- | --- | --- | --- |
| 未配置时拒绝启动 | `resolveAuthConfig({})` + 真实 `node index.js` | **已执行** | 退出码 1，`Refusing to start: DUB_ACCESS_TOKEN is not set…`。失败发生在数据库初始化之前 |
| 令牌模式 | `resolveAuthConfig`、`createApp` HTTP、真实 `index.js` + 令牌 | **已执行** | 启用鉴权；`/api/health` 免令牌；`/api/books` 无令牌 401；Bearer 与 `?access_token=` 均可通过 |
| 显式关闭鉴权 | `resolveAuthConfig({DUB_AUTH_MODE:disabled})`、`createApp` HTTP | **已执行** | `enabled:false`；`/api/books` 不再 401 |
| 非法 `FFMPEG_PATH` | `resolveFfmpegPath({FFMPEG_PATH: missing})` | **已执行** | `path=null`、`source=FFMPEG_PATH`，不回退到其它二进制 |
| compose 插值 | `docker compose config`（空值 / 令牌 / `wav-legacy` / 非法路径 / `disabled`） | **已执行** | 原样透传；**未**改成 disabled，**未**植入固定令牌 |
| 全栈 `docker compose up --build` | 镜像构建 + MinIO/Postgres 拉起 | **未执行** | 环境限制：验证机没有监听 5432 的 PostgreSQL。compose 插值已由 `docker compose config` 证明 |
| 浏览器里点选保存令牌并刷新列表 | 人工点选 | **未执行** | 环境限制：无浏览器 MCP，且未起全栈 UI。UI 令牌存取与 401 分支有自动化测试覆盖 |

**未验证的完整启动路径**：以上四类行为都验到了「进程与鉴权层」这一级，但**没有**跑通「镜像构建 → 全栈起来 → 浏览器实际使用」这条完整链路。首次部署请预留排错时间。

自动化：`cmp61-startup-config` + `auth` + `ffmpegBinary` 24 项通过，UI `accessToken` 4 项通过。

---

## 备份与恢复

生成一份自包含备份：

```bash
cd ebook-api
npm run backup -- ./backups/backup-name
```

恢复到新环境：

```bash
cd ebook-api
npm run restore -- ./backups/backup-name
npm run doctor
```

备份目录包含 PostgreSQL custom dump、镜像后的 S3 对象，以及 manifest。恢复顺序固定为：数据库 → 对象 → doctor 校验。

---

## 数据怎么放

- PostgreSQL：书籍、章节、角色、对白、任务、音色资产、平台音色、角色绑定、导出记录、`storage_objects`
- S3：源电子书、封面、音色样本、句级音频、章节拼接结果
- 媒体 URL 形态为 `/media/{encoded-object-key}`，由 API 代理读写

更细的接口约定见 [`ebook-api/docs/api.md`](ebook-api/docs/api.md)。

---

## 已知限制

以下是当前版本**尚未实现或尚未验证**的部分。写在这里是为了避免把规划当成已交付能力。

**尚未验证的链路**

- 未调用任何付费 AI / TTS 服务。真实供应商响应、合成音质、延迟与计费行为均未经端到端验证。
- 未做浏览器端到端回归，也未验证生产数据规模下的表现。
- 未做主观听感评估。响度只有 `ebur128` 的仪器读数，**不能**据此声称成品听起来合格。
- **未跑通完整启动链路**：验证机没有本地 PostgreSQL，也没有浏览器 MCP，因此没有执行过「`docker compose up --build` 起全栈 + 浏览器实际使用」。鉴权四类行为在进程与鉴权层已实际验证（见[回退与排错](#回退与排错)），但镜像构建、MinIO/Postgres 拉起、浏览器点选令牌这条完整路径**未被证明**。
- 界面未在真实浏览器里人工点选验证过，令牌存取与 401 分支只有自动化测试覆盖。

**已经过独立测试的部分**

- MP3 导出链路已由独立测试实际执行 ffmpeg：`ffprobe` 能读出格式、目标码率与写入的 `title` / `artist` / `album`，`ebur128` 综合响度读到 -16.2 LUFS（目标 ±1 LU 内）。`EXPORT_PROFILE=wav-legacy` 仍产出 WAV。

**当前缺少的功能**

- **访问控制是单操作者级别**：已实现共享密钥校验（`DUB_ACCESS_TOKEN`，见[访问控制](#访问控制)），但**没有多用户、没有账号体系、没有按资源授权**。令牌泄露即全站失守，轮换需要重启。
- **密钥静态加密**：数据库中的供应商 `api_key` 仍是明文。
- **音频交付**：无 AAC、无整书合并、无逐章多格式可选。
- **角色档案**：已实现规范角色档案与别名关联，管理入口见[角色与读音词典](#角色与读音词典)。
- **全书一致性**：**不做任何自动全书一致性保证**。角色档案提供的是稳定身份与别名关联，不是「同一角色在全书自动对齐音色与读法」的承诺；跨章仍需你逐章检查。
- **发音词典**：**只有 `alias` 规则可执行**——它会替换送给 TTS 的朗读文本。`phoneme` 规则可以保存，但 Mosi、Fish Audio、Fish Audio 自建都不支持 phoneme 标注，**其 replacement 永远不会出现在请求文本中**；规划器会在跳过时给出 `phoneme_skipped` 警告。不要把 phoneme 当作可用的读音控制手段。
- **成本可见性**：不提供费用预估。
- **PDF**：没有排期，也不支持。

**摄入格式**

- `.txt` 与 `.epub` 可用。`.mobi` 目前无法解析：摄入调用了依赖包中不存在的 `parseMobi`，上传会以 HTTP 500 失败，既不会生成书籍，也不会生成占位章节。请使用 EPUB 或 TXT。

---

## 建议的使用顺序

1. 在 **系统设置** 激活一套分析模型和至少一个 TTS 平台
2. 在 **音色管理** 上传样本或同步平台音色，确认配置已生效
3. 在 **书籍管理** 上传或新建一本书
4. 进入 **工作台**，选章 → AI 解析 → 校对标注 → 为旁白和角色绑音色
5. 预览配音计划，开始合成；用增量更新消化过期句
6. 试听全章，拼接音轨，需要下游时再导出故事源包

---

<p align="center">
  <sub>dub · 把电子书做成可以导演的声音。</sub>
</p>
