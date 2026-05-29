const aiService = require('../services/aiService');
const { aiConfigRepository } = require('../repositories');

class ChatController {
  /**
   * 获取当前默认激活的模型名称及配置信息
   */
  async getChatModel(req, res) {
    try {
      const activeDbConfig = await aiConfigRepository.findActive();
      if (activeDbConfig) {
        return res.json({
          model: activeDbConfig.model,
          name: activeDbConfig.name,
          isReasoning: Boolean(activeDbConfig.is_reasoning),
          url: activeDbConfig.api_url
        });
      }

      // 如果数据库中没有激活的，则尝试从 aiService 的降级配置（环境变量）中获取
      const config = await aiService.getActiveConfig();
      res.json({
        model: config.model,
        name: '系统默认环境配置',
        isReasoning: config.isReasoning,
        url: config.url
      });
    } catch (error) {
      console.error('Failed to get chat model info:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * 进行 AI 聊天（支持 Server-Sent Events 流式响应）
   */
  async chat(req, res) {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages is required and must be an array' });
    }

    try {
      // 获取当前激活的模型配置并实例化 OpenAI 客户端
      const config = await aiService.getActiveConfig();
      const client = await aiService.getClient(config);

      // 设置 SSE 响应头，确保浏览器以流式接收
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // 禁用 Nginx 代理缓存

      const payload = {
        model: config.model,
        messages: messages,
        stream: true
      };

      // 如果模型是推理模型，我们可以尝试像 analyzeText 一样加入 thinking 设置，
      // 但对于普通聊天流式，一般很多服务商会自动生成并吐出 delta.reasoning_content。
      // 为保持跟 analyzeText 的兼容性，如果是 reasoning 且环境支持，我们可以添加配置：
      if (config.isReasoning) {
        // 部分官方 DeepSeek 或兼容渠道支持 payload.thinking 
        // 遇到不支持该参数的兼容渠道，客户端可能会报错。为兼容更多普通对话场景，我们可以让其支持但有弹性
        try {
          if (config.model.includes('deepseek') && !config.model.includes('siliconflow')) {
            payload.thinking = { type: 'enabled' };
          }
        } catch (e) {
          console.warn('Failed to parse thinking setup:', e.message);
        }
      }

      const responseStream = await client.chat.completions.create(payload);

      for await (const chunk of responseStream) {
        const choice = chunk.choices[0];
        const content = choice?.delta?.content || '';
        // 捕获可能由 DeepSeek-R1 等流式传输返回的思考内容
        const reasoningContent = choice?.delta?.reasoning_content || '';

        // 如果没有内容和推理内容，则跳过
        if (!content && !reasoningContent) continue;

        res.write(`data: ${JSON.stringify({ content, reasoningContent })}\n\n`);
      }

      // 输出结束标记
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      console.error('Error in AI Chat stream:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || 'AI Chat execution failed' });
      } else {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      }
    }
  }
}

module.exports = new ChatController();
