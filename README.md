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

---

## 它解决什么

普通 TTS 把整章读成一条语音。**dub 把阅读变成制作。**

上传 EPUB / MOBI / TXT 之后，系统会切章、抽角色、标对白，再让你为每个角色选定音色。配音不是一次性黑盒：每一句都有波形、状态、跳过与重配；标注、音色或情绪一变，过期音频会立刻标出来。做完一章，可以听拼接音轨，也可以把结构化源包交给下游流水线。

适合有声书制作、小说改编、多角色朗读，以及需要把数据留在自己机器上的私有化部署。

```text
选择书籍 → 选择章节 → 解析配音 → 导出
```

| 步骤 | 你在做什么 | 系统在做什么 |
| --- | --- | --- |
| 选择书籍 | 入库、补封面与元数据 | 解析格式、切章、把源文件写入对象存储 |
| 选择章节 | 在多书标签间切换，锁定当前章 | 加载正文、角色、对白与音频状态 |
| 解析配音 | 审 AI 标注、改角色、调情绪、绑音色 | 异步分析、规划多平台 TTS、按句合成 |
| 导出 | 听全章、下单句、交下游 | 拼接音轨、打包源包、记录哈希以免过期 |

---

## 功能

### 1. 书籍管理 — 文本进入制作线

<p align="center">
  <img src="docs/screenshots/library.png" alt="书籍管理" width="920">
</p>

书籍库是工作流的入口。支持 **EPUB、MOBI、TXT** 拖拽或点击上传；也可以不依赖现成电子书，直接新建一本空白书并写入第一章。

上传后会自动：

- 解析目录与正文，按章落入 PostgreSQL
- 抽取封面（如有）并写入 S3
- 记录格式、作者、章数等元数据，供网格 / 列表两种视图浏览

库内能力包括书名与作者搜索、格式筛选、上传时间排序，以及封面、简介、标签、ISBN 等元数据编辑。点进一本书，就会在工作台打开一个独立标签。

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

源包面向下游：分镜、混音、播放器或另一条制作管线都可以消费同一份文本—声音对齐数据，而不必再解析 EPUB。

### 3. 音色库 — 资产、平台、克隆

<p align="center">
  <img src="docs/screenshots/voices.png" alt="音色管理" width="920">
</p>

音色不是「一个 API Key 加一个 ID」。dub 把 **音色资产** 和 **平台音色** 分开：

- **音色资产**：你上传的样本（音频 + 文本 + 语种 + 授权状态）。一份资产可以克隆到多个 provider
- **平台音色**：Mosi / Fish Audio / 自建 Fish 上的系统声与已克隆声
- **克隆任务**：异步跟踪训练进度
- **能力矩阵**：每个模型支不支持克隆、情绪、语速、流式、输出格式，一眼能看完

顶部的 provider 卡片会显示配置是否生效、额度 / 套餐、推荐模型。Fish Audio 可拉官方模型目录；自建实例单独激活，适合内网推理。资产支持搜索、按平台过滤、批量克隆、收藏与删除。配音工作台选声时，收藏会排在前面。

克隆前会检查样本是否完整（有音频、文本够长、授权已确认），避免把半成品推到远端训练。

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
- **Fish Audio**：官方 API，情绪提示、语速、流式，MP3 / WAV / Opus 等
- **Fish Audio Self-Hosted**：同一协议的自建端点

每个平台可保存多套配置，但同时只激活一条。Key 不会在界面明文回显。

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
    Parser[EPUB / MOBI / TXT 解析]
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
| 拼接 | ffmpeg-static |
| 数据 | PostgreSQL 16、S3 兼容对象存储 |

---

## 运行环境

- Node.js 20+
- npm
- PostgreSQL 16+
- S3 兼容存储（MinIO、AWS S3、R2、OSS 等）
- 可选：DeepSeek / OpenAI 兼容 Key、Mosi Key、Fish Audio Key 或自建 Fish 地址

---

## 用 Docker 启动

```bash
docker compose up --build
```

默认地址：

| 服务 | URL |
| --- | --- |
| 界面 | http://localhost:13001 |
| API | http://localhost:13000 |
| MinIO Console | http://localhost:9001 |

健康检查会同时探测 API、PostgreSQL 与对象存储：

```bash
curl http://localhost:13000/api/health
```

---

## 本地开发

先准备 PostgreSQL 和 S3，再配置 API：

```bash
cd ebook-api
cp .env.example .env
npm install
npm run schema:init
npm start
```

关键环境变量：

```dotenv
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
npm install
npm run dev
```

模型与 TTS 也可以不写在 `.env` 里，启动后到 **系统设置** 里添加并激活。环境变量只在数据库还没有激活配置时作为回退。

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
