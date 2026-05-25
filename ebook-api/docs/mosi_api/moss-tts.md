> 语音合成


# MOSS-TTS


---


**POST**
`https://studio.mosi.cn/api/v1/audio/speech`


MOSS-TTS 是强大的 TTS（文本转语音）模型。输入文本和参考音频，即可合成模仿参考音色特征的高质量语音。


**模型亮点**


SOTA
在 Seed-TTS-Eval、Seed-TTS-Eval Hard、CV3 及自建 Arena 平台上达到 SOTA。


- Token 级别时长控制

- 可扩展码率（RVQ 层数可调）

- 超短音频：最短一个字/词

- 超长音频：最长 1 小时

- 生僻字/词、成语典故精准读音

- 多语言支持

- 中英混杂

- 拼音/音素级发音控制

- 纯拼音/IPA/混合输入


---


## 请求参数


### 请求头


| 参数 | 类型 | 必填 | 说明 | | | `Authorization` | String | 是 | Bearer `<YOUR_API_KEY>` | | ### 请求体


| 参数 | 类型 | 必填 | 说明 | | | `model` | String | 是 | 模型名称，使用 `moss-tts` | | | `text` | String | 是 | 待合成的文本内容。 | | | `voice_id` | String | 是 | 参考音色 ID，决定合成语音的音色风格。可使用公共音色库中的 ID，或通过 Voice Clone 创建自定义音色后获取。


👉 查看公共音色库


🎙 创建音色

| | | `expected_duration_sec` | Float | 否 | 期望的输出音频时长（秒），可选参数。最佳实践：设置为文本正常朗读时间的 0.5 ~ 1.5 倍。超出此范围可能导致质量下降。 | | | `sampling_params` | Object | 否 | 采样配置。
- `max_new_tokens`: 最大 Token 数（默认 512）
- `temperature`: 采样温度（默认 1.7）
- `top_p`: 核采样（默认 0.8）
- `top_k`: Top-K 采样（默认 25） | | | `meta_info` | Boolean | 否 | 是否返回性能指标，默认 false | | 


---


## 采样参数详情


这些参数位于请求体中的 `sampling_params` 对象内。


默认值适用于大多数场景。调整 `temperature` 可增加或减少输出变化。
推荐参数：中文最佳 `temperature=1.7`, `top_p=0.8`, `top_k=25`；英文最佳 `temperature=1.5`, `top_p=0.8`, `top_k=50`。


| 参数名 | 类型 | 默认值 | 描述与建议 | | | `` | | | | | 


---


## 调用示例


### Python 示例


Python


```

```


### cURL 示例


cURL


```

```


---


## 响应参数


返回包含 Base64 音频数据、时长和使用量统计的 JSON。


| 参数 | 类型 | 说明 | | | `` | | | | ### 响应示例


JSON


```

```


---


## 状态码与错误说明


HTTP 200 表示成功。错误返回 4xx/5xx，JSON Body 中包含 `code`。


| 错误码 | 描述 | 处理建议 | | | `` | | | | 


---


## 性能指标与配额


RPM
5


每分钟请求限制


单个账户每分钟最大请求数。超限返回 `429`。


输出
24kHz


输出音频质量


24kHz WAV 格式输出音频。


超时
600s


请求超时时间


默认 600 秒，可通过 API 设置调整。


联系我们

邮箱: mosi@mosi.cn


---


## Snapshots


可以快速确定模型版本，确保调用一致。以下是 MOSS-TTS 所有可用的快照和版本列表。


moss-tts


↳
moss-tts-20260207


moss-tts-20260207


---


## 下载 Skill


下载此 Skill 的 .zip 压缩包，可直接导入 ClawHub 使用。


moss-tts-skill.zip


ClawHub Skill Package


下载 .zip


### Sampling Parameters (from script data)

| 参数名 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `max_new_tokens` | Int | 20000 | 最大生成 Token 数。控制输出音频的长度。 |
| `temperature` | Float | 1.7 | 采样温度。较高值增加输出多样性。 |
| `top_p` | Float | 0.8 | 核采样概率阈值。推荐 0.8。 |
| `top_k` | Int | 25 | Top-K 采样。限制每步选择的候选词数量。 |

### Response Fields (from script data)

| 字段 | 类型 | 说明 |
|---|---|---|
| `audio_data` | String | 生成音频的 Base64 编码数据。 |
| `duration_s` | Float | 生成音频的时长（秒）。 |
| `usage` | Object | Token 用量统计。
• `prompt_tokens`：提示词 token 数
• `completion_tokens`：生成 token 数
• `total_tokens`：总 token 数
• `credit_cost`：消耗的积分/费用 |
| `meta_info` | Object | 性能指标（meta_info: true 时返回）。
• `request_id`：请求唯一标识
• `latency_ms`：推理延迟（毫秒）
• `e2e_latency_sec`：端到端延迟（秒）
• `prompt_tokens`：提示词 token 数
• `completion_tokens`：生成 token 数
• `total_tokens`：总 token 数
• `cost`：消耗的积分 |

### Error Codes (from script data)

| 错误码 | 说明 | 处理建议 |
|---|---|---|
| `4000` | **Invalid Request**
请求格式无效 | 检查请求参数格式是否正确 |
| `4002` | **Invalid Audio**
参考音频格式无效 | 检查参考音频格式，支持 16-48kHz WAV |
| `4010` | **Unauthorized**
未授权 | 检查 API Key 是否已添加到请求头 |
| `4011` | **Invalid API Key**
API Key 无效 | 检查 API Key 是否正确 |
| `4020` | **Insufficient Credits**
余额不足 | 请充值后再试 |
| `4029` | **Rate Limit**
频率超限 | 降低请求频率或实施退避重试 |
| `5000` | **Internal Error**
内部异常 | 请稍后重试，如持续出现请联系客服 |
| `5002` | **Voice Not Found**
Voice音频不可用 | 确认 voice_id 对应的 Voice 状态为 ACTIVE |
| `5004` | **Timeout**
请求超时 | 检查文本长度，减少单次请求内容 |

### Code Examples (from script data)


**codeExample1**
```
import requests
import base64

def tts(api_key: str, text: str, voice_id: str, output_path: str = "output.wav",
        base_url: str = "https://studio.mosi.cn"):
    resp = requests.post(
        f"{base_url}/api/v1/audio/speech",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": "moss-tts",
            "text": text,
            "voice_id": voice_id,
            "expected_duration_sec": 3.2,
            "meta_info": True,
            "sampling_params": {
                "max_new_tokens": 20000,
                "temperature": 1.7,
                "top_p": 0.8,
                "top_k": 25
            }
        },
        timeout=1800,
    )
    resp.raise_for_status()
    audio_bytes = base64.b64decode(resp.json()["audio_data"])
    with open(output_path, "wb") as f:
        f.write(audio_bytes)
    return output_path

if __name__ == "__main__":
    path = tts("YOUR_API_KEY", "今天天气真好，阳光明媚。", "2001257729754140672")
    print(f"Audio saved to {path}")
```


**codeExample2**
```
curl -X POST "https://studio.mosi.cn/api/v1/audio/speech" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "moss-tts",
    "text": "今天天气真好",
    "voice_id": "2001257729754140672",
    "expected_duration_sec": 3.2,
    "meta_info": true,
    "sampling_params": {
      "max_new_tokens": 20000,
      "temperature": 1.7,
      "top_p": 0.8,
      "top_k": 25
    }
  }' | jq -r '.audio_data' | base64 -d -i > output.wav

# macOS 用户请使用:
# ... | jq -r '.audio_data' | base64 -d > output.wav
```
