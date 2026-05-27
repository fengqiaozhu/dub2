const {
  chapterCharacterRepository,
  chapterSegmentRepository,
  dialogueRepository,
  bookCharacterRepository,
  characterVoiceBindingRepository,
  chapterAudioExportRepository,
} = require('../repositories');
const jobManager = require('../services/jobManager');
const dubbingPlanner = require('../services/tts/dubbingPlanner');
const fs = require('fs');
const path = require('path');

class CharacterController {
  // ==================== 章节角色 ====================

  /**
   * GET /api/chapters/:id/characters
   * 查询章节所有角色及其对白
   */
  getChapterCharacters(req, res) {
    try {
      const chapterId = req.params.id;
      const characters = chapterCharacterRepository.findByChapterId(chapterId);
      for (const character of characters) {
        character.dialogues = dialogueRepository.findByChapterCharacterId(character.id);
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
  getBookCharacters(req, res) {
    try {
      const bookId = req.params.id;
      const characters = bookCharacterRepository.findByBookId(bookId);
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
  getDialogues(req, res) {
    try {
      const chapterCharacterId = req.params.id;
      const cc = chapterCharacterRepository.findById(chapterCharacterId);
      if (!cc) {
        return res.status(404).json({ error: 'Chapter character not found' });
      }
      const dialogues = dialogueRepository.findByChapterCharacterId(chapterCharacterId);
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
  createDialogue(req, res) {
    try {
      const chapterCharacterId = parseInt(req.params.id, 10);
      const cc = chapterCharacterRepository.findById(chapterCharacterId);
      if (!cc) {
        return res.status(404).json({ error: 'Chapter character not found' });
      }

      const { content, segment_id, char_start, char_end, order_index } = req.body;
      if (!content) {
        return res.status(400).json({ error: 'content is required' });
      }

      const id = dialogueRepository.create({
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
      if (segment_id) chapterSegmentRepository.updateType(segment_id, 'dialogue');

      // 更新全书角色统计
      bookCharacterRepository.recalculateForBook(cc.book_id);

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
  updateDialogue(req, res) {
    try {
      const id = req.params.id;
      const updates = req.body;
      const success = dialogueRepository.update(id, updates);

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
  deleteDialogue(req, res) {
    try {
      const id = req.params.id;

      // 先查出 book_id 用于重算统计
      const dialogue = dialogueRepository.findById(id);
      if (!dialogue) {
        return res.status(404).json({ error: 'Dialogue not found' });
      }
      const cc = chapterCharacterRepository.findById(dialogue.chapter_character_id);

      const success = dialogueRepository.delete(id);
      if (success) {
        if (dialogue.segment_id) chapterSegmentRepository.updateType(dialogue.segment_id, 'unknown');
        if (cc) chapterCharacterRepository.deleteUnusedByChapterId(cc.chapter_id);
        if (cc) bookCharacterRepository.recalculateForBook(cc.book_id);
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
      const dialogue = dialogueRepository.findById(id);
      if (!dialogue) {
        return res.status(404).json({ error: 'Dialogue not found' });
      }

      const plan = dubbingPlanner.createPlan(dialogue.chapter_id, { includeCompleted: true });
      const role = plan.roles.find((item) => item.character_name === dialogue.character_name);
      if (!role?.ready) {
        return res.status(400).json({ error: role?.message || 'Dubbing plan is not ready' });
      }
      const task = plan.tasks.find((item) => Number(item.dialogueId) === id);
      if (!task) {
        return res.status(400).json({ error: 'Dialogue is not ready for dubbing' });
      }

      dialogueRepository.clearAudioById(id);
      chapterAudioExportRepository.deleteByChapterId(dialogue.chapter_id);
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

  clearAudio(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const dialogue = dialogueRepository.findById(id);
      if (!dialogue) {
        return res.status(404).json({ error: 'Dialogue not found' });
      }
      dialogueRepository.clearAudioById(id);
      chapterAudioExportRepository.deleteByChapterId(dialogue.chapter_id);
      res.json({ message: 'Dialogue audio state cleared' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  saveEditedAudio(req, res) {
    try {
      const id = parseInt(req.params.id, 10);
      const dialogue = dialogueRepository.findById(id);
      if (!dialogue) {
        return res.status(404).json({ error: 'Dialogue not found' });
      }
      if (!req.file?.buffer) {
        return res.status(400).json({ error: 'No audio file provided' });
      }

      const duration = Number(req.body?.duration);
      const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : null;
      const audioDir = path.join(__dirname, '../../public/audio');
      fs.mkdirSync(audioDir, { recursive: true });

      const filename = `dialogue-${id}-edited-${Date.now()}.wav`;
      const filePath = path.join(audioDir, filename);
      fs.writeFileSync(filePath, req.file.buffer);

      const previousUrl = dialogue.audio_url;
      dialogueRepository.update(id, {
        audio_url: `/audio/${filename}`,
        audio_duration: safeDuration,
        audio_source_hash: dialogue.audio_source_hash,
        audio_error: null,
        audio_status: 'current'
      });
      chapterAudioExportRepository.deleteByChapterId(dialogue.chapter_id);

      if (previousUrl && String(previousUrl).startsWith('/audio/')) {
        const previousPath = path.resolve(path.join(__dirname, '../../public'), String(previousUrl).replace(/^\/+/, ''));
        if (previousPath.startsWith(audioDir) && previousPath !== filePath && fs.existsSync(previousPath)) {
          fs.unlink(previousPath, () => {});
        }
      }

      res.json({
        message: 'Dialogue audio updated',
        data: {
          audio_url: `/audio/${filename}`,
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
  getVoiceBindings(req, res) {
    try {
      const bookId = req.params.id;
      const bindings = characterVoiceBindingRepository.findByBookId(bookId);
      res.json({ data: bindings });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  getVoiceUsage(req, res) {
    try {
      const bookId = req.params.id;
      const usage = characterVoiceBindingRepository.findVoiceUsageByBookId(bookId);
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
  upsertVoiceBinding(req, res) {
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

      characterVoiceBindingRepository.upsert(bookId, character, {
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

  /**
   * DELETE /api/books/:bookId/voice-bindings/:character
   * 解绑角色音色
   */
  deleteVoiceBinding(req, res) {
    try {
      const { bookId, character } = req.params;
      const success = characterVoiceBindingRepository.delete(bookId, character);

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
