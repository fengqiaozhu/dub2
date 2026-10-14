const {
  chapterCharacterRepository,
  chapterSegmentRepository,
  dialogueRepository,
  bookCharacterRepository,
  characterVoiceBindingRepository,
  chapterAudioExportRepository,
  bookCharacterProfileRepository,
  bookCharacterAliasRepository,
  pronunciationRuleRepository,
} = require('../repositories');
const pronunciationService = require('../services/tts/pronunciationService');
const { backfillCharacterProfiles } = require('../repositories/postgres/schema');
const jobManager = require('../services/jobManager');
const dubbingPlanner = require('../services/tts/dubbingPlanner');
const fs = require('fs');
const path = require('path');
const storageService = require('../services/storage/storageService');
const { dialogueAudioKey, keyFromMediaUrl, mediaUrlForKey } = require('../services/storage/keyBuilder');

class CharacterController {
  // ==================== 章节角色 ====================

  /**
   * GET /api/chapters/:id/characters
   * 查询章节所有角色及其对白
   */
  async getChapterCharacters(req, res) {
    try {
      const chapterId = req.params.id;
      const characters = await chapterCharacterRepository.findByChapterId(chapterId);
      for (const character of characters) {
        character.dialogues = await dialogueRepository.findByChapterCharacterId(character.id);
      }
      res.json({ data: characters });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /api/books/:id/characters
   * 查询全书角色汇总（含音色绑定信息）
   */
  async getBookCharacters(req, res) {
    try {
      const bookId = req.params.id;
      const characters = await bookCharacterRepository.findByBookId(bookId);
      res.json({ data: characters });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // ==================== 对白 CRUD ====================

  /**
   * GET /api/chapter-characters/:id/dialogues
   * 查询某角色的所有对白
   */
  async getDialogues(req, res) {
    try {
      const chapterCharacterId = req.params.id;
      const cc = await chapterCharacterRepository.findById(chapterCharacterId);
      if (!cc) {
        return res.status(404).json({ error: 'Chapter character not found' });
      }
      const dialogues = await dialogueRepository.findByChapterCharacterId(chapterCharacterId);
      res.json({ data: dialogues });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * POST /api/chapter-characters/:id/dialogues
   * 手动新增对白
   * Body: { content, segment_id?, char_start?, char_end?, order_index? }
   */
  async createDialogue(req, res) {
    try {
      const chapterCharacterId = parseInt(req.params.id, 10);
      const cc = await chapterCharacterRepository.findById(chapterCharacterId);
      if (!cc) {
        return res.status(404).json({ error: 'Chapter character not found' });
      }

      const { content, segment_id, char_start, char_end, order_index } = req.body;
      if (!content) {
        return res.status(400).json({ error: 'content is required' });
      }

      const id = await dialogueRepository.create({
        chapter_character_id: chapterCharacterId,
        segment_id: segment_id ?? null,
        chapter_id: cc.chapter_id,
        content,
        char_start: char_start ?? -1,
        char_end: char_end ?? -1,
        source: 'manual',
        annotation_status: 'manual',
        updated_by: 'user',
        order_index: order_index ?? 0,
      });
      if (segment_id) await chapterSegmentRepository.updateType(segment_id, 'dialogue');

      // 更新全书角色统计
      await bookCharacterRepository.recalculateForBook(cc.book_id);

      res.status(201).json({ message: 'Dialogue created', id });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * PUT /api/dialogues/:id
   * 编辑对白内容
   * Body: { content?, char_start?, char_end?, order_index? }
   */
  async updateDialogue(req, res) {
    try {
      const id = req.params.id;
      const updates = req.body;
      const success = await dialogueRepository.update(id, updates);

      if (success) {
        res.json({ message: 'Dialogue updated successfully' });
      } else {
        res.status(404).json({ error: 'Dialogue not found' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * DELETE /api/dialogues/:id
   * 删除对白
   */
  async deleteDialogue(req, res) {
    try {
      const id = req.params.id;

      // 先查出 book_id 用于重算统计
      const dialogue = await dialogueRepository.findById(id);
      if (!dialogue) {
        return res.status(404).json({ error: 'Dialogue not found' });
      }
      const cc = await chapterCharacterRepository.findById(dialogue.chapter_character_id);

      const success = await dialogueRepository.delete(id);
      if (success) {
        if (dialogue.segment_id) await chapterSegmentRepository.updateType(dialogue.segment_id, 'unknown');
        if (cc) await chapterCharacterRepository.deleteUnusedByChapterId(cc.chapter_id);
        if (cc) await bookCharacterRepository.recalculateForBook(cc.book_id);
        res.json({ message: 'Dialogue deleted successfully' });
      } else {
        res.status(404).json({ error: 'Dialogue not found' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async redubDialogue(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const dialogue = await dialogueRepository.findById(id);
      if (!dialogue) {
        return res.status(404).json({ error: 'Dialogue not found' });
      }

      const plan = await dubbingPlanner.createPlan(dialogue.chapter_id, { includeCompleted: true });
      const role = plan.roles.find((item) => item.character_name === dialogue.character_name);
      if (!role?.ready) {
        return res.status(400).json({ error: role?.message || 'Dubbing plan is not ready' });
      }
      const task = plan.tasks.find((item) => Number(item.dialogueId) === id);
      if (!task) {
        return res.status(400).json({ error: 'Dialogue is not ready for dubbing' });
      }

      await dialogueRepository.clearAudioById(id);
      await chapterAudioExportRepository.deleteByChapterId(dialogue.chapter_id);
      const jobId = await jobManager.startJob(
        'redub_dialogue',
        id.toString(),
        'batchDubbingJob.js',
        { chapterId: dialogue.chapter_id, items: [task], force: true }
      );

      res.status(202).json({
        message: 'Dialogue redub job started',
        data: { jobId, status: 'PENDING' }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async clearAudio(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const dialogue = await dialogueRepository.findById(id);
      if (!dialogue) {
        return res.status(404).json({ error: 'Dialogue not found' });
      }
      await dialogueRepository.clearAudioById(id);
      await chapterAudioExportRepository.deleteByChapterId(dialogue.chapter_id);
      res.json({ message: 'Dialogue audio state cleared' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async saveEditedAudio(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const dialogue = await dialogueRepository.findById(id);
      if (!dialogue) {
        return res.status(404).json({ error: 'Dialogue not found' });
      }
      if (!req.file?.buffer) {
        return res.status(400).json({ error: 'No audio file provided' });
      }

      const duration = Number(req.body?.duration);
      const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : null;
      const key = dialogueAudioKey(dialogue.book_id, dialogue.chapter_id, id, '.wav');
      await storageService.putObject(key, req.file.buffer, {
        contentType: req.file.mimetype || 'audio/wav',
        entityType: 'dialogue_audio',
        entityId: String(id),
        metadata: { edited: 'true' }
      });
      const audioUrl = mediaUrlForKey(key);

      const previousUrl = dialogue.audio_url;
      await dialogueRepository.update(id, {
        audio_url: audioUrl,
        audio_duration: safeDuration,
        audio_source_hash: dialogue.audio_source_hash,
        audio_error: null,
        audio_status: 'current'
      });
      await chapterAudioExportRepository.deleteByChapterId(dialogue.chapter_id);

      const previousKey = keyFromMediaUrl(previousUrl);
      if (previousKey && previousKey !== key) {
        await storageService.deleteObject(previousKey);
      }

      res.json({
        message: 'Dialogue audio updated',
        data: {
          audio_url: audioUrl,
          audio_duration: safeDuration
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // ==================== 音色绑定 ====================

  /**
   * GET /api/books/:id/voice-bindings
   * 查全书所有角色的音色绑定
   */
  async getVoiceBindings(req, res) {
    try {
      const bookId = req.params.id;
      const bindings = await characterVoiceBindingRepository.findByBookId(bookId);
      res.json({ data: bindings });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getVoiceUsage(req, res) {
    try {
      const bookId = req.params.id;
      const usage = await characterVoiceBindingRepository.findVoiceUsageByBookId(bookId);
      res.json({ data: usage });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * PUT /api/books/:bookId/voice-bindings/:character
   * 绑定或更新角色音色
   * Body: { voice_id, provider?, provider_voice_id?, voice_source?, voice_profile_id?, tts_model?, intent_defaults? }
   */
  async upsertVoiceBinding(req, res) {
    try {
      const { bookId, character } = req.params;
      const {
        voice_id,
        provider = 'mosi',
        provider_voice_id,
        voice_source = 'system',
        voice_profile_id,
        tts_model,
        intent_defaults
      } = req.body;
      const resolvedVoiceId = provider_voice_id || voice_id || (voice_profile_id ? `profile:${voice_profile_id}` : null);

      if (!resolvedVoiceId && !voice_profile_id) {
        return res.status(400).json({ error: 'voice_id or voice_profile_id is required' });
      }

      await characterVoiceBindingRepository.upsert(bookId, character, {
        voice_id: resolvedVoiceId,
        provider,
        provider_voice_id: provider_voice_id || (voice_id && !String(voice_id).startsWith('profile:') ? voice_id : null),
        voice_source,
        voice_profile_id,
        tts_model,
        intent_defaults
      });
      res.json({ message: 'Voice binding updated successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // ==================== 角色档案 / 别名 / 词典 ====================

  /**
   * GET /api/books/:id/character-profiles
   * 全书角色档案与别名（含影响范围统计）
   */
  async getCharacterProfiles(req, res) {
    try {
      const bookId = req.params.id;
      await backfillCharacterProfiles(bookId);
      const profiles = await bookCharacterProfileRepository.findByBookId(bookId);
      const data = [];
      for (const profile of profiles) {
        const aliases = await bookCharacterAliasRepository.findByProfileId(profile.id);
        const diff = await pronunciationService.voiceDiffersByProfile(bookId, profile);
        data.push({
          ...profile,
          aliases: aliases.filter((alias) => String(alias.alias) !== String(profile.canonical_name)),
          voice_change_aliases: diff.voiceChangeAliases.map((item) => item.alias_name)
        });
      }
      res.json({ data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * POST /api/books/:id/character-profiles/:profileId/aliases
   * 新增别名
   */
   async addAlias(req, res) {
     try {
       const bookId = req.params.id;
       const profileId = req.params.profileId;
       const alias = String(req.body.alias ?? '').trim();
      if (!alias) return res.status(400).json({ error: 'alias is required' });
      const profile = await bookCharacterProfileRepository.findById(profileId);
      if (!profile || String(profile.book_id) !== String(bookId)) {
        return res.status(404).json({ error: 'Profile not found' });
      }
      const aliasId = await bookCharacterAliasRepository.create(profile.id, profile.book_id, alias);
      if (aliasId == null) {
        return res.status(409).json({ error: '该别名已存在' });
      }
      const impact = await pronunciationService.computeImpact(profile.book_id, { profileId: profile.id });
      const created = await bookCharacterAliasRepository.findById(aliasId);
      res.status(201).json({ data: { ...created, impact } });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * DELETE /api/books/:id/aliases/:aliasId
   * 删除别名（不删除音频）
   */
  async deleteAlias(req, res) {
    try {
      const { aliasId } = req.params;
      const alias = await bookCharacterAliasRepository.findById(aliasId);
      if (!alias) return res.status(404).json({ error: 'Alias not found' });
      const success = await bookCharacterAliasRepository.delete(aliasId);
      if (!success) return res.status(404).json({ error: 'Alias not found' });
      res.json({ message: 'Alias deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /api/books/:id/pronunciation-rules
   * 词典规则列表（含影响统计）
   */
  async getPronunciationRules(req, res) {
    try {
      const bookId = req.params.id;
      const rules = await pronunciationRuleRepository.findByBookId(bookId);
      const data = [];
      for (const rule of rules) {
        const impact = await pronunciationService.computeImpact(bookId, { ruleId: rule.id });
        data.push({ ...rule, impact });
      }
      res.json({ data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * POST /api/books/:id/pronunciation-rules
   * 新建词典规则；rule_type=phoneme 仅入库，请求文本不发送
   */
  async createPronunciationRule(req, res) {
    try {
      const bookId = req.params.id;
      const {
        profile_id = null,
        rule_type = 'alias',
        match_text,
        replacement = '',
        priority = 0,
        enabled = true
      } = req.body;
      if (!String(match_text ?? '').trim()) {
        return res.status(400).json({ error: 'match_text is required' });
      }
      if (!['alias', 'phoneme'].includes(String(rule_type))) {
        return res.status(400).json({ error: "rule_type must be 'alias' or 'phoneme'" });
      }
      if (profile_id != null) {
        const profile = await bookCharacterProfileRepository.findById(profile_id);
        if (!profile || String(profile.book_id) !== String(bookId)) {
          return res.status(404).json({ error: 'Profile not found' });
        }
      }
      const ruleId = await pronunciationRuleRepository.create({
        book_id: bookId,
        profile_id,
        rule_type,
        match_text,
        replacement,
        priority,
        enabled
      });
      const rule = await pronunciationRuleRepository.findById(ruleId);
      const impact = await pronunciationService.computeImpact(bookId, { ruleId });
      res.status(201).json({ data: { ...rule, impact } });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * PATCH /api/books/:id/pronunciation-rules/:ruleId
   * 更新替换内容、优先级或停用规则
   */
   async updatePronunciationRule(req, res) {
     try {
       const bookId = req.params.id;
       const ruleId = req.params.ruleId;
      const rule = await pronunciationRuleRepository.findById(ruleId);
      if (!rule || String(rule.book_id) !== String(bookId)) {
        return res.status(404).json({ error: 'Rule not found' });
      }
      const updates = {};
      for (const key of ['replacement', 'priority', 'enabled', 'profile_id']) {
        if (key in req.body) updates[key] = req.body[key];
      }
      const success = await pronunciationRuleRepository.update(ruleId, updates);
      if (!success) return res.status(400).json({ error: 'Nothing to update' });
      const updated = await pronunciationRuleRepository.findById(ruleId);
      res.json({ data: updated });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /api/books/:id/pronunciation-rules/:ruleId/impact
   * 只读影响面查询：会改变朗读文本或音色的对白/章 id
   */
   async getPronunciationRuleImpact(req, res) {
     try {
       const bookId = req.params.id;
       const ruleId = req.params.ruleId;
      const rule = await pronunciationRuleRepository.findById(ruleId);
      if (!rule || String(rule.book_id) !== String(bookId)) {
        return res.status(404).json({ error: 'Rule not found' });
      }
      const impact = await pronunciationService.computeImpact(bookId, { ruleId });
      res.json({ data: impact });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * POST /api/books/:id/pronunciation-rules/preview-impact
   * affects-count preview for an unsaved rule payload
   */
  async previewPronunciationRuleImpact(req, res) {
    try {
      const bookId = req.params.id;
      const rule = req.body.rule || null;
      const profileId = req.body.profile_id ?? null;
      const disableRuleId = req.body.disable_rule_id ?? null;
      const impact = await pronunciationService.computeImpact(bookId, { rule, profileId, disableRuleId });
      res.json({ data: impact });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * DELETE /api/books/:id/pronunciation-rules/:ruleId
   */
  async deletePronunciationRule(req, res) {
    try {
      const { ruleId } = req.params;
      const rule = await pronunciationRuleRepository.findById(ruleId);
      if (!rule) return res.status(404).json({ error: 'Rule not found' });
      const success = await pronunciationRuleRepository.delete(ruleId);
      if (!success) return res.status(404).json({ error: 'Rule not found' });
      res.json({ message: 'Rule deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * DELETE /api/books/:bookId/voice-bindings/:character
   * 解绑角色音色
   */
  async deleteVoiceBinding(req, res) {
    try {
      const { bookId, character } = req.params;
      const success = await characterVoiceBindingRepository.delete(bookId, character);

      if (success) {
        res.json({ message: 'Voice binding deleted successfully' });
      } else {
        res.status(404).json({ error: 'Binding not found' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new CharacterController();
