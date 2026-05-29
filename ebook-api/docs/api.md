# Ebook API 接口文档

本文档提供 Ebook API 的所有前后端交互接口，包含基础资源的增删改查以及基于 Bree 实现的后台异步任务（AI 分析、TTS）的调用方式。

> **变更记录 (2026-05-08)**
> - [NEW] 新增数据库表：`chapter_characters`、`dialogues`、`book_characters`、`character_voice_bindings`
> - [UPDATED] `GET /api/chapters/:id` 响应结构：不再返回 `ai_analysis` 字段，改为返回结构化的 `characters` 数组
> - [NEW] 新增章节角色查询接口：`GET /api/chapters/:id/characters`
> - [NEW] 新增全书角色汇总接口：`GET /api/books/:id/characters`
> - [NEW] 新增对白 CRUD 接口：`/api/chapter-characters/:id/dialogues`、`/api/dialogues/:id`
> - [NEW] 新增音色绑定接口：`/api/books/:id/voice-bindings`
> - [NEW] 新增批量配音接口：`POST /api/chapters/:id/batch-dub`
> - [UPDATED] `dialogues` 表新增字段：`audio_url`、`audio_duration`

---

## 1. 任务管理 (Jobs API)
当前系统对于耗时较长的操作（如 AI 分析、TTS 音色克隆、TTS 语音合成）都采用了异步非阻塞架构。
触发任务后会立刻返回一个 `jobId`，你需要通过以下接口轮询进度。

### 1.1 查询特定任务进度
**GET** `/api/jobs/:id`

- **参数**: `id` - (String) 任务 ID
- **响应示例**:
  ```json
  {
    "data": {
      "id": "f7784466-1ab8-4e26-9867-3c0c9a854b10",
      "job_name": "analyze_chapter-f778...",
      "type": "analyze_chapter",
      "target_id": "7",
      "status": "DONE",        // PENDING | RUNNING | DONE | FAILED
      "progress": 100,         // 当前进度 0~100
      "result": { ... },       // 执行完毕后返回的结果对象
      "error": null
    }
  }
  ```

### 1.2 条件查询/找回任务
**GET** `/api/jobs`

如果前端刷新导致丢失了 `jobId`，可通过此接口按照目标业务 ID 来找回对应的任务。
- **Query 参数**:
  - `type` (可选): 任务类型（例如：`analyze_chapter`, `mosi_clone`, `mosi_tts`）
  - `target_id` (可选): 业务关联ID（如 `chapter_id`, `voice_id`）
  - `status` (可选): `PENDING`, `RUNNING`, `DONE`, `FAILED`
- **请求示例**: `GET /api/jobs?type=analyze_chapter&target_id=7`
- **响应示例**:
  ```json
  {
    "data": [
      {
        "id": "f778...",
        "type": "analyze_chapter",
        "status": "RUNNING",
        "progress": 50
      }
    ]
  }
  ```

---

## 2. 电子书与章节管理 (Books & Chapters)

### 2.1 上传并解析电子书
**POST** `/api/books/upload`

支持上传 `.txt`, `.epub`, `.mobi` 文件。上传后服务器会解析书籍并将章节自动存入数据库。
- **请求格式**: `multipart/form-data`
  - `file`: (File) 电子书文件
- **响应**:
  ```json
  {
    "message": "File parsed and saved to database successfully",
    "bookId": 1
  }
  ```

### 2.2 获取电子书列表
**GET** `/api/books`
- **Query 参数**: `limit`, `offset`
- **响应**:
  ```json
  {
    "data": [
      { "id": 1, "title": "西游记", "format": "epub" }
    ]
  }
  ```

### 2.3 获取单个电子书及其章节目录
**GET** `/api/books/:id`
- **响应**:
  ```json
  {
    "data": {
      "id": 1,
      "title": "西游记",
      "format": "epub",
      "chapters": [
        { "id": 1, "title": "第一回 灵根育孕源流出...", "chapter_index": 1 }
      ]
    }
  }
  ```

### 2.4 获取/更新单个章节内容 [UPDATED]
**GET** `/api/chapters/:id`  
**PUT** `/api/chapters/:id`

> **[UPDATED]** `GET` 响应不再包含 `ai_analysis` 原始字段，改为返回结构化的 `characters` 数组（含每个角色的对白列表）。

- **GET 响应**:
  ```json
  {
    "data": {
      "id": 7,
      "book_id": 1,
      "title": "第一回",
      "content": "...",
      "chapter_index": 0,
      "created_at": "2026-05-06 06:05:19",
      "characters": [
        {
          "id": 1,
          "chapter_id": 7,
          "book_id": 1,
          "character_name": "孙悟空",
          "dialogue_count": 5,
          "dialogues": [
            {
              "id": 1,
              "content": "俺老孙来也！",
              "char_start": 120,
              "char_end": 128,
              "source": "ai",
              "order_index": 120,
              "audio_url": "/audio/tts_xxx.wav",
              "audio_duration": 2.5
            }
          ]
        }
      ]
    }
  }
  ```
- **PUT Body**:
  ```json
  {
    "title": "新标题",
    "content": "新正文内容"
  }
  ```

### 2.5 删除电子书/章节
**DELETE** `/api/books/:id` (级联删除旗下所有章节、角色、对白)  
**DELETE** `/api/chapters/:id`

---

## 3. AI 分析引擎

### 3.1 提取章节角色与对白（异步任务）
**POST** `/api/chapters/:id/analyze`
- **说明**: 触发 AI 大模型，对指定章节进行角色提取和对话抽离。分析结果写入结构化表（`chapter_characters`、`dialogues`），同时自动更新全书角色汇总（`book_characters`）。
- **响应**:
  ```json
  {
    "message": "Analysis job started",
    "data": {
      "jobId": "f778...uuid",
      "status": "PENDING"
    }
  }
  ```
- **获取结果**: 通过 `GET /api/jobs/{jobId}` 轮询，当 `status` 变为 `DONE` 时代表写入完成。之后调用 `GET /api/chapters/:id/characters` 或 `GET /api/chapters/:id` 获取结构化结果。
- **注意**: 对同一章节重复分析时，旧的角色和对白数据会被自动清除后重写。

---

## 4. 角色与对白管理 [NEW]

### 4.1 查询章节角色列表（含对白） [NEW]
**GET** `/api/chapters/:id/characters`
- **说明**: 返回指定章节所有角色及其对白列表。
- **响应**:
  ```json
  {
    "data": [
      {
        "id": 1,
        "chapter_id": 7,
        "book_id": 1,
        "character_name": "孙悟空",
        "dialogue_count": 5,
        "dialogues": [
          {
            "id": 1,
            "content": "俺老孙来也！",
            "char_start": 120,
            "char_end": 128,
            "source": "ai",       // ai | manual | narrator
            "order_index": 120,
            "audio_url": "/audio/tts_xxx.wav",
            "audio_duration": 2.5,
            "created_at": "...",
            "updated_at": "..."
          }
        ]
      }
    ]
  }
  ```

### 4.2 查询全书角色汇总 [NEW]
**GET** `/api/books/:id/characters`
- **说明**: 跨章节聚合，返回整本书去重后的角色列表，附带对白总数、出现章节数以及已绑定的音色信息。
- **响应**:
  ```json
  {
    "data": [
      {
        "id": 1,
        "book_id": 1,
        "character_name": "孙悟空",
        "dialogue_count": 42,
        "chapter_count": 8,
        "voice_id": "v_xxx",        // 已绑定音色，未绑定则为 null
        "voice_source": "system"    // clone | system，未绑定则为 null
      }
    ]
  }
  ```

### 4.3 查询某角色的对白列表 [NEW]
**GET** `/api/chapter-characters/:id/dialogues`
- **参数**: `id` - chapter_characters 表的行 ID
- **响应**:
  ```json
  {
    "data": [
      {
        "id": 1,
        "chapter_character_id": 1,
        "chapter_id": 7,
        "content": "俺老孙来也！",
        "char_start": 120,
        "char_end": 128,
        "source": "ai",
        "order_index": 120,
        "audio_url": "/audio/tts_xxx.wav",
        "audio_duration": 2.5
      }
    ]
  }
  ```

### 4.4 手动新增对白 [NEW]
**POST** `/api/chapter-characters/:id/dialogues`
- **说明**: 对 AI 漏识别的对白进行手动补充，`source` 自动标记为 `manual`。
- **Body**:
  ```json
  {
    "content": "这是一句手动添加的对白",
    "char_start": 200,
    "char_end": 215,
    "order_index": 200
  }
  ```
- **响应**:
  ```json
  { "message": "Dialogue created", "id": 42 }
  ```

### 4.5 编辑对白 [NEW]
**PUT** `/api/dialogues/:id`
- **说明**: 修改单条对白的内容或位置信息，AI 生成的对白和手动对白均可编辑。
- **Body** (所有字段均可选):
  ```json
  {
    "content": "修改后的对白内容",
    "char_start": 120,
    "char_end": 135,
    "order_index": 120
  }
  ```
- **响应**:
  ```json
  { "message": "Dialogue updated successfully" }
  ```

### 4.6 删除对白 [NEW]
**DELETE** `/api/dialogues/:id`
- **响应**:
  ```json
  { "message": "Dialogue deleted successfully" }
  ```

### 4.7 批量配音 (异步任务) [NEW]
**POST** `/api/chapters/:id/batch-dub`
- **说明**: 提交该章节进行批量离线配音。调用此接口时，系统会自动清理旧的旁白记录，根据当前最新的对白计算出中间的“缝隙”，将其作为新的旁白（`source: 'narrator'`）保存，随后开启 Bree 离线任务进行逐句语音合成。
- **Body**: 
  ```json
  {
    "items": [] // (可选) 若不传，则后端自动从数据库读取该章节的所有对白及角色绑定的音色进行合成
  }
  ```
- **响应**: 返回 `jobId` 供轮询。
  ```json
  {
    "message": "Batch dubbing job started",
    "data": {
      "jobId": "f778...uuid",
      "status": "PENDING"
    }
  }
  ```
- **工作流**: 任务会自动跳过已经存在 `audio_url` 的对白。如果中断，只需再次请求此接口即可继续未完成的合成（秒级快进）。

---

## 5. 音色绑定管理 [NEW]

角色与音色的绑定关系以 `book_id + character_name` 为唯一键，同一角色在同一本书中只能绑定一个音色。

### 5.1 查询全书音色绑定 [NEW]
**GET** `/api/books/:id/voice-bindings`
- **响应**:
  ```json
  {
    "data": [
      {
        "id": 1,
        "book_id": 1,
        "character_name": "孙悟空",
        "voice_id": "v_xxx",
        "voice_source": "system",   // clone | system
        "created_at": "...",
        "updated_at": "..."
      }
    ]
  }
  ```

### 5.2 绑定或更新音色 [NEW]
**PUT** `/api/books/:bookId/voice-bindings/:character`
- **参数**: `character` - 角色名（URL 编码，如"孙悟空"编码为 `%E5%AD%99%E6%82%9F%E7%A9%BA`）
- **Body**:
  ```json
  {
    "voice_id": "v_xxx",
    "voice_source": "system"   // clone | system，默认 system
  }
  ```
- **响应**:
  ```json
  { "message": "Voice binding updated successfully" }
  ```

### 5.3 解绑音色 [NEW]
**DELETE** `/api/books/:bookId/voice-bindings/:character`
- **响应**:
  ```json
  { "message": "Voice binding deleted successfully" }
  ```

---

## 6. Mosi 语音克隆与 TTS (异步任务)

### 6.1 获取音色列表 (用户克隆音色)
**GET** `/api/mosi/voices`
- **Query 参数**: `limit` (默认 50), `offset` (默认 0), `status` (默认全部，可传 `ACTIVE`)
- **响应**:
  ```json
  {
    "data": {
      "voices": [
        { "voice_id": "v_123", "status": "ACTIVE", "name": "..." }
      ]
    }
  }
  ```

### 6.2 获取系统预置音色列表
**GET** `/api/mosi/system-voices`
- **说明**: 获取 Mosi 官方平台内置的高质量音色库（不同于用户自己克隆的音色）。
- **响应示例**:
  ```json
  {
    "data": {
      "voices": [
        {
          "voiceId": "2052192423102124032",
          "voiceName": "张世豪",
          "gender": "male",
          "previewAudioUrl": "https://cdn.mosi.cn/...wav",
          "language": "zh-CN",
          "status": "active"
        }
      ]
    }
  }
  ```

### 6.3 创建音色克隆 (异步任务)
**POST** `/api/mosi/create-voice`
- **说明**: 提交本地音频进行干声克隆。
- **请求格式**: `multipart/form-data`
  - `file`: (File) 音频样本文件
  - `text`: (String, 可选) 音频对应的朗读文本
- **响应**: 返回 `jobId` 供轮询。任务 `DONE` 时代表音色状态已成为 `ACTIVE`，可用于合成。

### 6.4 语音合成 TTS (异步任务)
**POST** `/api/mosi/tts`
- **说明**: 调用魔音 TTS 接口生成对应角色的语音，合成音频文件会持久化到本地 `public/audio` 目录。
- **请求 Body (JSON)**:
  ```json
  {
    "text": "悟空，休得无礼！",
    "voice_id": "v_xxx_xxx",
    "options": {
      "speed": 1.0,
      "pitch": 1.0
    }
  }
  ```
- **响应**: 返回 `jobId` 供轮询。
- **获取结果**: 轮询 `GET /api/jobs/{jobId}`。当 `status` 为 `DONE` 时，`result` 会包含音频文件的可访问链接：
  ```json
  {
    "data": {
      "status": "DONE",
      "result": {
        "url": "/audio/mosi_tts_168...001.wav",
        "audio_id": "..."
      }
    }
  }
  ```

---

## 附录：数据表结构

| 表名 | 说明 |
|---|---|
| `books` | 电子书基本信息 |
| `chapters` | 章节内容，`ai_analysis` 字段保留原始 AI 输出作为备份 |
| `chapter_characters` | 每章节的角色行，`UNIQUE(chapter_id, character_name)` |
| `dialogues` | 每条对白独立一行，`source` 区分 `ai`/`manual`/`narrator`，包含 `audio_url` |
| `book_characters` | 全书角色聚合统计，`UNIQUE(book_id, character_name)` |
| `character_voice_bindings` | 角色-音色绑定，`UNIQUE(book_id, character_name)` |
| `jobs` | 异步任务记录 |
