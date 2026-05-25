const OpenAI = require('openai');
const {
  chapterRepository,
  chapterCharacterRepository,
  dialogueRepository,
  bookCharacterRepository
} = require('../repositories');

class AiService {
  constructor() {
    this.chatAiModel = {
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
      url: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com',
      apiKey: process.env.DEEPSEEK_API_KEY,
      timeout: parseInt(process.env.DEEPSEEK_TIMEOUT) || 60000,
    };

    this.openai = new OpenAI({
      baseURL: this.chatAiModel.url,
      apiKey: this.chatAiModel.apiKey,
      timeout: this.chatAiModel.timeout
    });
  }

  async retryableRequest(fn, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === retries - 1) throw error;
        console.warn(`Request failed, retrying (${i + 1}/${retries})...`, error.message);
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // Exponential-ish backoff
      }
    }
  }

  parseDeepseekResponse(data) {
    try {
      const content = data.choices[0].message.content;
      const cleanContent = content
        // Some reasoning models may include an explicit thinking block before
        // the JSON payload. It is not part of the contract we persist.
        .replace(/<\s*thinking\s*>[\s\S]*?<\s*\/\s*thinking\s*>/gi, '')
        .trim();
      // Some models might wrap JSON in markdown block like ```json ... ```
      const jsonMatch = cleanContent.match(/```json\s*([\s\S]*?)\s*```/) || cleanContent.match(/```\s*([\s\S]*?)\s*```/);
      let jsonText;
      if (jsonMatch) {
        jsonText = jsonMatch[1].trim();
      } else {
        jsonText = cleanContent;
      }

      try {
        return JSON.parse(jsonText);
      } catch {
        const startIndex = jsonText.search(/[\[{]/);
        const endIndex = Math.max(jsonText.lastIndexOf(']'), jsonText.lastIndexOf('}'));
        if (startIndex >= 0 && endIndex > startIndex) {
          return JSON.parse(jsonText.slice(startIndex, endIndex + 1));
        }
        throw new Error('No JSON payload found');
      }
    } catch (err) {
      console.error('Failed to parse DeepSeek response as JSON:', err.message, data.choices?.[0]?.message?.content);
      throw new Error('AI response is not valid JSON');
    }
  }

  normalizeAnalysisResult(analysisResult) {
    const groups = Array.isArray(analysisResult)
      ? analysisResult
      : (
        Array.isArray(analysisResult?.dialogues) ? analysisResult.dialogues :
          Array.isArray(analysisResult?.characters) ? analysisResult.characters :
            Array.isArray(analysisResult?.roles) ? analysisResult.roles :
              []
      );

    return groups
      .map((character) => {
        const role = character.role || character.character || character.character_name || character.name || character.speaker;
        const dialogues = Array.isArray(character.dialogues)
          ? character.dialogues
          : (
            Array.isArray(character.lines) ? character.lines :
              Array.isArray(character.quotes) ? character.quotes :
                []
          );

        return {
          role,
          dialogues: dialogues
            .map((dialogue) => {
              if (typeof dialogue === 'string') {
                return { content: dialogue, emotion: '' };
              }
              return {
                ...dialogue,
                content: dialogue.content || dialogue.text || dialogue.dialogue || dialogue.quote || '',
                emotion: dialogue.emotion || dialogue.action || dialogue.tone || ''
              };
            })
            .filter((dialogue) => dialogue.content)
        };
      })
      .filter((character) => character.role && character.dialogues.length > 0);
  }

  persistAnalysisResult(chapter, analysisResult) {
    const normalizedResult = this.normalizeAnalysisResult(analysisResult);

    // 重新分析是强重置：清空本章既有标注，再用新的 AI 结果重建。
    dialogueRepository.deleteByChapterId(chapter.id);
    chapterCharacterRepository.deleteByChapterId(chapter.id);
    const usedRanges = [];

    for (let i = 0; i < normalizedResult.length; i++) {
      const character = normalizedResult[i];
      const chapterCharacterId = chapterCharacterRepository.upsert(
        chapter.id,
        chapter.book_id,
        character.role
      );

      const dialoguesToInsert = character.dialogues.map((d, idx) => {
        const charStart = d.char_index ? d.char_index[0] : -1;
        const charEnd = d.char_index ? d.char_index[1] : -1;
        const validRange = charStart >= 0 && charEnd > charStart &&
          !usedRanges.some((range) => charStart < range.end && range.start < charEnd);
        if (validRange) usedRanges.push({ start: charStart, end: charEnd });
        return {
          chapter_character_id: chapterCharacterId,
          segment_id: null,
          chapter_id: chapter.id,
          content: validRange ? chapter.content.slice(charStart, charEnd) : d.content,
          emotion: d.emotion ?? '',
          char_start: validRange ? charStart : -1,
          char_end: validRange ? charEnd : -1,
          source: 'ai',
          annotation_status: 'ai',
          updated_by: 'ai',
          order_index: validRange ? charStart : idx,
        };
      });
      dialogueRepository.createMany(dialoguesToInsert);
    }

    bookCharacterRepository.recalculateForBook(chapter.book_id);
    return normalizedResult;
  }

  /**
   * 文本分析（使用 DeepSeek，带重试）
   */
  async analyzeText(text) {
    const endpoint = this.chatAiModel;
    if (!endpoint.apiKey) {
      throw new Error("DeepSeek API Key is missing in environment variables.");
    }

    return this.retryableRequest(async () => {
      const completion = await this.openai.chat.completions.create({
        model: endpoint.model,
        messages: [
          {
            role: "system",
            // content: `你是一个专业文本分析助手，需要将输入的文本分离出文本中的人物和对白。
            // 严格按以下JSON格式输出，禁止解释，确保字段名和引号完全一致,确保对白严格按照原文中顺序展示，比如：‘“你看看你这个人！”史强大声说，“我们说它不合法了吗？我们说不让你接触了吗？”’要被解析成两句对白，不能合并。并且结果中对白的标点符号严格与原文一致。注意角色名称不要重复：
            //           [
            //           {
            //             "role": "角色名称",
            //             "dialogues": [
            //               {"content":"XXXXX"},
            //               {"content":"XXXXX"}
            //             ]
            //           }
            //          ]`
            content: `# Role
你是一个极度严谨的文本分析工程师，你的任务是进行“地毯式”的信息提取，将输入文本中的人物、对白以及伴随的情绪动作完全分离。

# Rules
1. **零遗漏原则**：你必须逐行扫描输入文本，提取出**每一句**对白。禁止任何形式的概括、省略或总结。
2. **打断对白的拆分**：如果一句完整的对白被人物动作或神态描写打断，必须将其解析为连续的两条独立对白。
   - 示例输入：‘“你看看你这个人！”史强大声说，“我们说它不合法了吗？”’
   - 必须解析为两条 \`content\`，第一条的 emotion 提取为“大声说”。严禁合并这两句话。
3. **情绪与动作剥离**：仔细识别对白前后的提示语（如：大声说、冷笑、犹豫地、咬牙切齿）。将其提取到 \`emotion\` 字段。如果没有，则输出空字符串 ""。
4. **精准消除歧义**：遇到代词（如“他说”）或连续无主语对话时，必须根据上下文精确推断出对应的角色原名。角色名称严禁重复或使用代词。
5. **标点与原文一致**：提取的 \`content\` 必须与原文一字不差，包括标点符号。

# Output Workflow
为了确保绝无遗漏，请你严格按照以下两步执行：

**第一步：全局扫描与梳理（思考过程）**
请在 \`< thinking > \` 标签内，按时间顺序简单列出文本中所有的对白及说话人，核对是否把每一个引号内的句子都找出来了。

**第二步：输出结构化数据**
梳理无误后，严格按照下面的JSON结构输出。确保字段名、引号完全合法。

[
  {
    "role": "角色名称",
    "dialogues": [
      {
        "emotion": "提取的情绪或动作(如无则为空)",
        "content": "完整的原话1"
      },
      {
        "emotion": "提取的情绪或动作(如无则为空)",
        "content": "完整的原话2"
      }
    ]
  }
]`
          },
          {
            role: "user",
            content: text
          }
        ],
        thinking: { type: "enabled" },
        reasoning_effort: "high",
        stream: false,
      });

      return this.parseDeepseekResponse(completion);
    });
  }

  async analyzeChapter(chapterId) {
    const chapter = chapterRepository.findById(chapterId);
    if (!chapter) {
      throw new Error(`Chapter with ID ${chapterId} not found.`);
    }

    if (!chapter.content) {
      throw new Error(`Chapter ${chapterId} has no content to analyze.`);
    }

    const analysisResult = await this.analyzeText(chapter.content);

    // Calculate char_index locally using Regex
    const escapeRegExp = (string) => {
      return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    // 支持的引号字符集（中英文、全半角、书名号等均包含）
    const QUOTE_CHARS = new Set([
      '"', "'",           // ASCII 半角
      '\u201C', '\u201D', // " "  左右双引号
      '\u2018', '\u2019', // ' '  左右单引号
      '\u300C', '\u300D', // 「 」 日式角引号
      '\u300E', '\u300F', // 『 』 日式双角引号
      '\u3010', '\u3011', // 【 】 方头括号
    ]);

    const normalizedResult = this.normalizeAnalysisResult(analysisResult);

    if (Array.isArray(normalizedResult)) {
      for (const character of normalizedResult) {
        if (Array.isArray(character.dialogues)) {
          for (const dialogue of character.dialogues) {
            const escapedText = escapeRegExp(dialogue.content);

            // 先尝试带引号匹配，再 fallback 到无引号匹配
            const patterns = [
              new RegExp(`["'"']${escapedText}["'"']`),
              new RegExp(escapedText)
            ];

            dialogue.char_index = [-1, -1]; // Default if not found
            for (const regex of patterns) {
              const match = chapter.content.match(regex);
              if (match) {
                let start = match.index;
                let end = match.index + match[0].length;

                // 向两侧探查引号，将遗漏的引号纳入范围
                // （当 AI content 不含引号、fallback pattern 命中时起作用）
                if (start > 0 && QUOTE_CHARS.has(chapter.content[start - 1])) start--;
                if (end < chapter.content.length && QUOTE_CHARS.has(chapter.content[end])) end++;

                dialogue.char_index = [start, end];
                break;
              }
            }
          }
        }
      }
    }

    // === 写入结构化新表 ===
    this.persistAnalysisResult(chapter, normalizedResult);

    // 5. 保留原始 ai_analysis 字段作为备份（不再是主要数据源）
    chapterRepository.update(chapterId, {
      ai_analysis: JSON.stringify(analysisResult)
    });

    return normalizedResult;
  }
}

module.exports = new AiService();
