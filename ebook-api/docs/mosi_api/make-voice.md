> 音色管理


# 创建音色


---


## 概述


Voice Clone API用于将音频文件转换为可复用的声音模型，供后续TTS服务使用。


### 基础信息


| Base URL | `https://studio.mosi.cn` | | | 认证方式 | Bearer Token | | | 内容类型 | application/json (除文件上传外) | | ---


## 使用流程


使用克隆音色进行语音合成，需要先通过以下步骤获取 voice_id，再传入 TTS 接口。


1


上传音频文件


将参考音频上传到服务器，返回 file_id

POST /api/v1/files/upload`


↓


2


创建 Voice Clone


使用 file_id 创建音色，成功后获取 voice_id，状态自动变为 ACTIVE

POST /api/v1/voice/clone`


↓


3


使用 voice_id 生成语音


将 voice_id 传入 TTS（MOSS-TTS）或 TTSD（MOSS-TTSD）接口

POST /api/v1/audio/speech`


Voice 创建成功（status: SUCCESS）后自动激活变为 ACTIVE，无需额外操作，可直接用于语音合成。


---


## 1. 上传音频文件


**POST**
`https://studio.mosi.cn/api/v1/files/upload`


上传音频文件到服务器，返回file_id供后续使用。


### 请求头


| 参数名 | 类型 | 必填 | 说明 | | | `Authorization` | String | 是 | Bearer {api_key} | | | `Content-Type` | String | 是 | multipart/form-data | | ### 请求参数


| 参数名 | 类型 | 位置 | 必填 | 说明 | | | `file` | File | Body | 是 | 音频文件 | | ### 请求示例


cURL


```
curl -X POST https://studio.mosi.cn/api/v1/files/upload \
-H "Authorization: Bearer YOUR_API_KEY" \
-F "file=@/path/to/your/audio.wav"
```


**文件限制**


- 支持格式: WAV, MP3, M4A, FLAC

- 最大100MB

- 推荐时长：5秒-5分钟

- 推荐采样率：16kHz或更高


### 响应示例


JSON


```
{
"file_id": "1234567890",
"filename": "speaker_audio.wav",
"size": 1048576,
"content_type": "audio/wav",
"created_at": "2026-01-31T12:00:00+08:00"
}
```


---


## 2. 创建Voice Clone


**POST**
`https://studio.mosi.cn/api/v1/voice/clone`


基于上传的音频文件创建voice clone，自动进行语音转写。


### 请求头


| 参数名 | 类型 | 必填 | 说明 | | | `Authorization` | String | 是 | Bearer {api_key} | | | `Content-Type` | String | 是 | application/json | | ### 请求参数


| 参数名 | 类型 | 必填 | 默认值 | 说明 | | | `file_id` | String | 否 | - | 与 url 二选一 | | | `url` | String | 否 | - | 与 file_id 二选一 | | | `text` | String | 否 | - | 音频内容的转写文本。不传时自动调用 ASR 转写；提供准确文本可提升音色克隆质量。
| | 

**参数约束**


- file_id 和 url 不能都为空

- file_id 和 url 不能同时传


### 请求示例


JSON


```
{
"file_id": "1234567890123456789",
"text": "可选的转写文本"
}
```


### cURL 示例


cURL


```
curl -X POST https://studio.mosi.cn/api/v1/voice/clone \
-H "Authorization: Bearer YOUR_API_KEY" \
-H "Content-Type: application/json" \
-d '{
"file_id": "1234567890123456789",
"text": "可选的转写文本"
}'
```


### 响应示例


JSON


```
{
"job_id": "user_123_1234567890",
"voice_id": "08219ad1",
"status": "PENDING",
"created_at": "2026-01-31T12:00:00+08:00"
}
```


### 状态说明


| 状态 | 说明 | | | `PENDING` | 任务已提交，正在处理中。轮询 GET /api/v1/voices/{voice_id} 直到状态变为 ACTIVE 或 FAILED | | ---


## 3. 查询Voice列表


**GET**
`https://studio.mosi.cn/api/v1/voices`


获取当前用户的所有voice列表。


### 请求头


| 参数名 | 类型 | 必填 | 说明 | | | `Authorization` | String | 是 | Bearer {api_key} | | ### 查询参数


| 参数名 | 类型 | 必填 | 默认值 | 说明 | | | `limit` | Integer | 否 | 50 | 每页数量（1-100） | | | `offset` | Integer | 否 | 0 | 偏移量 | | | `status` | String | 否 | - | 过滤状态：ACTIVE / FAILED / PENDING | | ### cURL 示例


cURL


```
curl -X GET "https://studio.mosi.cn/api/v1/voices?limit=20&offset=0&status=ACTIVE" \
-H "Authorization: Bearer YOUR_API_KEY"
```


### 响应示例


JSON


```
{
"voices": [
{
"voice_id": "08219ad1",
"voice_name": "Voice 08219ad1",
"status": "ACTIVE",
"source_type": "VOICE_CLONE",
"transcription_text": "你好，我是张三。",
"created_at": "2026-01-31T12:00:00+08:00",
"updated_at": "2026-01-31T12:01:00+08:00"
}
],
"count": 1,
"limit": 20,
"offset": 0
}
```


---


## 4. 查询单个Voice


**GET**
`https://studio.mosi.cn/api/v1/voices/{voice_id}`


获取指定voice的详细信息。


### 请求头


| 参数名 | 类型 | 必填 | 说明 | | | `Authorization` | String | 是 | Bearer {api_key} | | ### cURL 示例


cURL


```
curl -X GET https://studio.mosi.cn/api/v1/voices/{voice_id} \
-H "Authorization: Bearer YOUR_API_KEY"
```


### 响应示例


JSON


```
{
"voice_id": "08219ad1",
"voice_name": "Voice 08219ad1",
"status": "ACTIVE",
"source_type": "VOICE_CLONE",
"transcription_text": "你好，我是张三。今天天气真不错。",
"created_at": "2026-01-31T12:00:00+08:00",
"updated_at": "2026-01-31T12:01:00+08:00"
}
```


### Voice状态


| 状态 | 说明 | | | `PENDING` | 初始状态，任务创建后等待处理 | | | `ACTIVE` | 可用，已激活，可用于语音合成 | | | `FAILED` | 创建失败，请重新提交 | | ---


## 错误响应


### 错误格式


JSON


```
{
"code": 4001,
"error": "Invalid request: missing file_id"
}
```


### 错误码说明


HTTP 200 表示成功。错误返回 4xx/5xx，JSON Body 中包含 code。


| 错误码 | 描述 | 处理建议 | | | `` | | | | ---


## 公共音色 (Public Voice ID)


以下是系统预置的公共音色，可直接使用 voice_id 进行 TTS 合成，无需创建 Voice Clone。完整列表可通过 GET /api/v1/voices 接口查询。


| Voice ID | 声音名称 | 声音描述 | 标签 | | | `` | | | 
| |