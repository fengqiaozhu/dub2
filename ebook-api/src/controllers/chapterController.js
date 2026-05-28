const aiService = require('../services/aiService');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const storageService = require('../services/storage/storageService');
const { keyFromMediaUrl } = require('../services/storage/keyBuilder');
const {
  bookRepository,
  chapterRepository,
  chapterCharacterRepository,
  dialogueRepository,
  chapterAudioExportRepository,
  chapterAudioSkipRangeRepository
} = require('../repositories');
const annotationService = require('../services/annotationService');
const jobManager = require('../services/jobManager');
const {
  publicDir,
  buildChapterAudioItems,
  buildNarratorRanges,
  getChapterAudioItems,
  computeChapterAudioHash
} = require('../services/chapterAudioState');
const dubbingPlanner = require('../services/tts/dubbingPlanner');
const { createStorySourcePackage } = require('../services/storySourcePackageService');

const rangeOverlaps = (aStart, aEnd, bStart, bEnd) => (
  Number(aStart) < Number(bEnd) && Number(bStart) < Number(aEnd)
);

const validateSkipRange = (chapter, payload) => {
  const charStart = Number(payload.char_start);
  const charEnd = Number(payload.char_end);
  if (!Number.isInteger(charStart) || !Number.isInteger(charEnd)) {
    throw new Error('char_start and char_end must be integers');
  }
  if (charStart < 0 || charEnd <= charStart || charEnd > String(chapter.content || '').length) {
    throw new Error('Invalid skip range');
  }
  return { charStart, charEnd };
};

const createZipArchive = (options) => {
  if (typeof archiver === 'function') {
    return archiver('zip', options);
  }
  return new archiver.ZipArchive(options);
};

class ChapterController {
  async getChapter(req, res) {
    try {
      const id = req.params.id;
      const chapter = await chapterRepository.findById(id);
      if (!chapter) {
        return res.status(404).json({ error: 'Chapter not found' });
      }
      const rawAiAnalysis = chapter.ai_analysis;

      // 附加结构化角色和对白数据
      let characters = await chapterCharacterRepository.findByChapterId(id);
      if (characters.length === 0 && rawAiAnalysis) {
        try {
          await aiService.persistAnalysisResult(chapter, JSON.parse(rawAiAnalysis));
          characters = await chapterCharacterRepository.findByChapterId(id);
        } catch (repairError) {
          console.warn(`[ChapterController] Failed to repair analysis tables for chapter ${id}:`, repairError.message);
        }
      }
      const refreshedDialogues = await dialogueRepository.findByChapterId(id);
      const skipRanges = await chapterAudioSkipRangeRepository.findByChapterId(id);

      for (const character of characters) {
        character.dialogues = await dialogueRepository.findByChapterCharacterId(character.id);
      }
      chapter.characters = characters;
      chapter.paragraphs = annotationService.buildParagraphs(chapter.content || '').map((paragraph) => ({
        ...paragraph,
        skip_audio: skipRanges.some((range) => rangeOverlaps(
          paragraph.char_start,
          paragraph.char_end,
          range.char_start,
          range.char_end
        ))
      }));
      chapter.annotations = refreshedDialogues.filter((dialogue) => (
        dialogue.source !== 'narrator' && dialogue.char_start >= 0 && dialogue.char_end > dialogue.char_start
      ));
      chapter.unlocated_dialogues = refreshedDialogues.filter((dialogue) => (
        dialogue.source !== 'narrator' && (dialogue.char_start < 0 || dialogue.char_end <= dialogue.char_start)
      ));

      // 删除原始 ai_analysis 字段（体积大，不对外暴露）
      delete chapter.ai_analysis;

      let plan = { tasks: [] };
      try {
        plan = await dubbingPlanner.createPlan(id, { includeCompleted: true });
      } catch (planError) {
        console.warn(`[ChapterController] Failed to build audio state for chapter ${id}:`, planError.message);
      }
      const taskMap = new Map((plan.tasks || []).map((task) => [String(task.dialogueId), task]));
      chapter.audio_items = buildChapterAudioItems(chapter, refreshedDialogues, taskMap, skipRanges);

      const totalAudioTargets = chapter.audio_items.length;
      const completedAudioTargets = chapter.audio_items.filter((item) => item.audio_status === 'current').length;
      const skippedAudioTargets = chapter.audio_items.filter((item) => item.audio_status === 'skipped').length;
      const pendingAudioTargets = chapter.audio_items.filter((item) => (
        item.audio_status !== 'current' && item.audio_status !== 'skipped'
      )).length;
      chapter.dubbing_stats = {
        total: totalAudioTargets,
        completed: completedAudioTargets,
        pending: pendingAudioTargets,
        missing: chapter.audio_items.filter((item) => item.audio_status === 'missing').length,
        stale: chapter.audio_items.filter((item) => item.audio_status === 'stale').length,
        failed: chapter.audio_items.filter((item) => item.audio_status === 'failed').length,
        skipped: skippedAudioTargets
      };

      const currentDialogueIds = new Set(chapter.audio_items.filter((item) => item.audio_status === 'current').map((item) => String(item.id)));
      const audioItems = getChapterAudioItems(refreshedDialogues.filter((dialogue) => currentDialogueIds.has(String(dialogue.id))));
      const exportRecord = await chapterAudioExportRepository.findLatestByChapterId(id);
      if (exportRecord) {
        const currentHash = computeChapterAudioHash(audioItems);
        chapter.merged_audio_export = {
          ...exportRecord,
          is_current: exportRecord.source_hash === currentHash,
          current_source_hash: currentHash
        };
      } else {
        chapter.merged_audio_export = null;
      }

      res.json({ data: chapter });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async createChapter(req, res) {
    try {
      const { book_id, title, content, chapter_index } = req.body;
      if (!book_id || !content) {
        return res.status(400).json({ error: 'book_id and content are required' });
      }

      const id = await chapterRepository.create({ book_id, title, content, chapter_index });
      res.status(201).json({ message: 'Chapter created', id });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async updateChapter(req, res) {
    try {
      const id = req.params.id;
      const updates = req.body;
      const success = await chapterRepository.update(id, updates);
      
      if (success) {
        if (updates.content !== undefined) {
          await dialogueRepository.deleteByChapterId(id);
          await chapterCharacterRepository.deleteByChapterId(id);
          await chapterAudioSkipRangeRepository.deleteByChapterId(id);
        }
        await chapterAudioExportRepository.deleteByChapterId(id);
        res.json({ message: 'Chapter updated successfully' });
      } else {
        res.status(404).json({ error: 'Chapter not found' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async deleteChapter(req, res) {
    try {
      const id = req.params.id;
      const success = await chapterRepository.delete(id);
      
      if (success) {
        res.json({ message: 'Chapter deleted successfully' });
      } else {
        res.status(404).json({ error: 'Chapter not found' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async analyzeChapter(req, res) {
    try {
      const chapterId = parseInt(req.params.id, 10);
      
      const chapter = await chapterRepository.findById(chapterId);
      if (!chapter) {
        return res.status(404).json({ error: 'Chapter not found' });
      }

      if (!chapter.content) {
        return res.status(400).json({ error: 'Chapter has no content to analyze' });
      }

      // Start the background job
      const jobId = await jobManager.startJob(
        'analyze_chapter', 
        chapterId.toString(), 
        'analyzeChapterJob.js', 
        { chapterId },
        { dedupe: true }
      );

      res.status(202).json({
        message: 'Analysis job started',
        data: {
          jobId,
          status: 'PENDING'
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async createAnnotation(req, res) {
    try {
      const chapterId = parseInt(req.params.id, 10);
      const annotation = await annotationService.createAnnotation(chapterId, req.body || {});
      res.status(201).json({ message: 'Annotation created', data: annotation });
    } catch (error) {
      const status = error.message === 'Chapter not found'
        ? 404
        : ([
          'Invalid annotation range',
          'character_name is required',
          'Annotation range cannot be empty',
          'char_start and char_end must be integers',
          'Only dialogue annotations are supported'
        ].includes(error.message) ? 400 : 500);
      res.status(status).json({ error: error.message });
    }
  }

  async updateAnnotation(req, res) {
    try {
      const annotation = await annotationService.updateAnnotation(parseInt(req.params.id, 10), req.body || {});
      res.json({ message: 'Annotation updated', data: annotation });
    } catch (error) {
      const status = error.message === 'Annotation not found' ? 404 : 400;
      res.status(status).json({ error: error.message });
    }
  }

  async deleteAnnotation(req, res) {
    try {
      await annotationService.deleteAnnotation(parseInt(req.params.id, 10));
      res.json({ message: 'Annotation deleted' });
    } catch (error) {
      const status = error.message === 'Annotation not found' ? 404 : 500;
      res.status(status).json({ error: error.message });
    }
  }

  async updateAudioSkipRange(req, res) {
    try {
      const chapterId = parseInt(req.params.id, 10);
      const chapter = await chapterRepository.findById(chapterId);
      if (!chapter) {
        return res.status(404).json({ error: 'Chapter not found' });
      }
      const { charStart, charEnd } = validateSkipRange(chapter, req.body || {});
      const skipAudio = req.body?.skip_audio === true;

      if (skipAudio) {
        await chapterAudioSkipRangeRepository.upsert(chapterId, charStart, charEnd);
      } else {
        await chapterAudioSkipRangeRepository.deleteRange(chapterId, charStart, charEnd);
      }
      await chapterAudioExportRepository.deleteByChapterId(chapterId);
      res.json({
        message: skipAudio ? 'Audio skip range saved' : 'Audio skip range removed',
        data: { chapter_id: chapterId, char_start: charStart, char_end: charEnd, skip_audio: skipAudio }
      });
    } catch (error) {
      const status = [
        'char_start and char_end must be integers',
        'Invalid skip range'
      ].includes(error.message) ? 400 : 500;
      res.status(status).json({ error: error.message });
    }
  }

  async batchDub(req, res) {
    try {
      const chapterId = parseInt(req.params.id, 10);
      const items = req.body?.items || []; // Optional override
      const force = req.body?.force === true;

      const chapter = await chapterRepository.findById(chapterId);
      if (!chapter) {
        return res.status(404).json({ error: 'Chapter not found' });
      }

      if (force) {
        await dialogueRepository.clearAudioByChapterId(chapterId);
        await chapterAudioExportRepository.deleteByChapterId(chapterId);
        await dialogueRepository.deleteByChapterIdAndSource(chapterId, 'narrator');
      }

      // 2. Fetch current range annotations and rebuild narrator gaps from source text.
      const currentDialogues = await dialogueRepository.findByChapterId(chapterId);
      const skipRanges = await chapterAudioSkipRangeRepository.findByChapterId(chapterId);
      // Ensure "旁白" character exists
      const narratorCharId = await chapterCharacterRepository.upsert(chapterId, chapter.book_id, '旁白');

      // 3. Compute narrator gaps
      const hasNarratorRows = currentDialogues.some((dialogue) => dialogue.source === 'narrator');
      const baseDialogues = currentDialogues.filter(d => d.source !== 'narrator');
      const narratorDialogues = hasNarratorRows ? [] : buildNarratorRanges(chapter, baseDialogues)
        .filter((dialogue) => !skipRanges.some((range) => rangeOverlaps(
          dialogue.char_start,
          dialogue.char_end,
          range.char_start,
          range.char_end
        )))
        .map((dialogue) => ({
        chapter_character_id: narratorCharId,
        chapter_id: chapterId,
        content: dialogue.content,
        emotion: dialogue.emotion || '',
        char_start: dialogue.char_start,
        char_end: dialogue.char_end,
        source: 'narrator',
        order_index: dialogue.order_index
      }));

      // 4. Insert new narrators
      if (narratorDialogues.length > 0) {
        await dialogueRepository.createMany(narratorDialogues);
      }

      // 5. Start batch dubbing job
      const jobId = await jobManager.startJob(
        'batch_dub',
        chapterId.toString(),
        'batchDubbingJob.js',
        { chapterId, items, force },
        { dedupe: true }
      );

      res.status(202).json({
        message: 'Batch dubbing job started',
        data: {
          jobId,
          status: 'PENDING'
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async dubbingPreview(req, res) {
    try {
      const chapterId = parseInt(req.params.id, 10);
      const plan = await dubbingPlanner.createPlan(chapterId);
      res.json({ data: plan });
    } catch (error) {
      if (error.message === 'Chapter not found') {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  }

  async exportStorySourcePackage(req, res) {
    try {
      const chapterId = parseInt(req.params.id, 10);
      const storyPackage = await createStorySourcePackage(chapterId);
      const filename = `chapter-${chapterId}-story-source-package.json`;

      res.attachment(filename);
      res.type('json');
      res.send(JSON.stringify(storyPackage, null, 2));
    } catch (error) {
      if (error.message === 'Chapter not found') {
        return res.status(404).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  }

  async exportAudioArchive(req, res) {
    try {
      const chapterId = parseInt(req.params.id, 10);
      const chapter = await chapterRepository.findById(chapterId);
      if (!chapter) {
        return res.status(404).json({ error: 'Chapter not found' });
      }

      const book = await bookRepository.findById(chapter.book_id);
      const storedDialogues = await dialogueRepository.findByChapterId(chapterId);
      const skipRanges = await chapterAudioSkipRangeRepository.findByChapterId(chapterId);
      let plan = { tasks: [] };
      try {
        plan = await dubbingPlanner.createPlan(chapterId, { includeCompleted: true });
      } catch (planError) {
        console.warn(`[ChapterController] Failed to build archive audio state for chapter ${chapterId}:`, planError.message);
      }
      const taskMap = new Map((plan.tasks || []).map((task) => [String(task.dialogueId), task]));
      const currentIds = new Set(
        buildChapterAudioItems(chapter, storedDialogues, taskMap, skipRanges)
          .filter((item) => item.audio_status === 'current')
          .map((item) => String(item.id))
      );
      const dialogues = storedDialogues.filter((dialogue) => dialogue.audio_url && currentIds.has(String(dialogue.id)));

      if (dialogues.length === 0) {
        return res.status(400).json({ error: 'No synthesized audio found for this chapter' });
      }

      const safeName = (value) => String(value || '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 48) || 'untitled';
      const zipName = `chapter-${chapterId}-audio.zip`;

      const manifest = {
        book: book ? { id: book.id, title: book.title } : null,
        chapter: { id: chapter.id, title: chapter.title, chapter_index: chapter.chapter_index },
        exported_at: new Date().toISOString(),
        items: []
      };

      const exportItems = [];
      for (let index = 0; index < dialogues.length; index += 1) {
        const dialogue = dialogues[index];
        const objectKey = keyFromMediaUrl(dialogue.audio_url);
        if (!objectKey || !(await storageService.headObject(objectKey))) continue;

        const ext = path.extname(objectKey) || '.wav';
        const filename = [
          String(index + 1).padStart(3, '0'),
          safeName(dialogue.character_name || dialogue.source),
          `dialogue-${dialogue.id}`
        ].join('-') + ext;

        manifest.items.push({
          index: index + 1,
          id: dialogue.id,
          character_name: dialogue.character_name,
          source: dialogue.source,
          content: dialogue.content,
          audio_file: filename,
          audio_url: dialogue.audio_url,
          duration: dialogue.audio_duration
        });

        exportItems.push({ objectKey, filename });
      }

      if (exportItems.length === 0) {
        return res.status(400).json({ error: 'Synthesized audio records exist, but the files are missing on disk' });
      }

      res.attachment(zipName);
      res.type('zip');

      const archive = createZipArchive({ zlib: { level: 9 } });
      archive.on('error', (error) => {
        if (!res.headersSent) {
          res.status(500).json({ error: error.message });
        } else {
          res.end();
        }
      });
      archive.pipe(res);

      for (const item of exportItems) {
        const object = await storageService.getObjectStream(item.objectKey);
        archive.append(object.stream, { name: item.filename });
      }

      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
      archive.finalize();
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async exportMergedAudio(req, res) {
    try {
      const chapterId = parseInt(req.params.id, 10);
      const chapter = await chapterRepository.findById(chapterId);
      if (!chapter) {
        return res.status(404).json({ error: 'Chapter not found' });
      }

      const jobId = await jobManager.startJob(
        'export_chapter_audio',
        chapterId.toString(),
        'exportChapterAudioJob.js',
        { chapterId },
        { dedupe: true }
      );

      res.status(202).json({
        message: 'Chapter audio export job started',
        data: {
          jobId,
          status: 'PENDING'
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new ChapterController();
