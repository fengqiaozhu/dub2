const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpegBinary = require('../services/ffmpegBinary');
const exportFfmpeg = require('../services/exportFfmpeg');
const {
  chapterRepository,
  bookRepository,
  dialogueRepository,
  chapterAudioExportRepository,
  chapterAudioSkipRangeRepository
} = require('../repositories');
const { resolveExportProfile } = require('../services/exportProfile');
const {
  buildChapterAudioItems,
  getChapterExportReadiness,
  getChapterAudioItems,
  computeChapterAudioHash,
  computeChapterSourceHash
} = require('../services/chapterAudioState');
const dubbingPlanner = require('../services/tts/dubbingPlanner');
const storageService = require('../services/storage/storageService');
const { chapterExportKey, keyFromMediaUrl, mediaUrlForKey } = require('../services/storage/keyBuilder');

const { jobId, jobName, params } = workerData;
const { chapterId } = params;

const registerCancelHandler = require('./cancelSignal');
const isCancelled = registerCancelHandler();

const escapeConcatPath = (filePath) => filePath.replace(/'/g, "'\\''");

const resolveFfmpegOrFail = () => {
  const resolved = ffmpegBinary.resolveFfmpegPath();
  if (!resolved.path) {
    throw new Error(`ffmpeg 不可用，无法拼接章节音频：${resolved.error}`);
  }
  return resolved.path;
};

const runFfmpeg = exportFfmpeg.runFfmpeg;

const postProgress = (value) => parentPort.postMessage({ type: 'PROGRESS', jobId, value });

// CMP-38 export tests need to exercise the per-segment probe path before the
// readiness gate; production default (unset/false) keeps the gate exactly as before.
const SHOULD_PROBE_EARLY = ['1', 'true', 'yes', 'on'].includes(String(process.env.EXPORT_EARLY_PROBE || '').trim().toLowerCase());

(async () => {
  let listPath = null;
  let tempDir = null;

  try {
    const profile = resolveExportProfile();
    const chapter = await chapterRepository.findById(chapterId);
    if (!chapter) {
      throw new Error(`Chapter ${chapterId} not found`);
    }

    postProgress(10);

    const dialogues = await dialogueRepository.findByChapterId(chapterId);
    const skipRanges = await chapterAudioSkipRangeRepository.findByChapterId(chapterId);
    const plan = await dubbingPlanner.createPlan(chapterId, { includeCompleted: true });
    const taskMap = new Map((plan.tasks || []).map((task) => [String(task.dialogueId), task]));
    const chapterItems = buildChapterAudioItems(chapter, dialogues, taskMap, skipRanges);
    const readiness = getChapterExportReadiness(chapterItems);
    if (!readiness.ready) {
      throw new Error(`章节无法拼接：${readiness.pending} 句未完成（缺失 ${readiness.missing}，过期 ${readiness.stale}，失败 ${readiness.failed}）。请先配音或明确跳过；空章节无法拼接。`);
    }
    const currentIds = new Set(
      chapterItems
        .filter((item) => item.audio_status === 'current')
        .map((item) => String(item.id))
    );
    const audioItems = getChapterAudioItems(dialogues.filter((dialogue) => currentIds.has(String(dialogue.id))));

    if (audioItems.length === 0) {
      throw new Error('No current synthesized audio found for this chapter');
    }
    const ffmpegPath = resolveFfmpegOrFail();
    if (profile.format === 'mp3') {
      await exportFfmpeg.verifyMp3Capabilities(ffmpegPath);
    }
    if (SHOULD_PROBE_EARLY) {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ebook-export-${jobId}-`));
      for (let index = 0; index < audioItems.length; index += 1) {
        const item = audioItems[index];
        const buffer = await storageService.getObjectBuffer(item.objectKey);
        const ext = path.extname(item.objectKey) || '.wav';
        const filePath = path.join(tempDir, `probe-${String(index + 1).padStart(4, '0')}${ext}`);
        fs.writeFileSync(filePath, buffer);
        await exportFfmpeg.probeSegment(ffmpegPath, filePath, index, runFfmpeg);
        item.localPath = filePath;
      }
    }

    // Export identity is separate from sentence hashes: profile id, format,
    // bitrate and loudness profile ride on top of the sentence hash list.
    const sourceHash = computeChapterSourceHash(audioItems, profile);

    tempDir = tempDir || fs.mkdtempSync(path.join(os.tmpdir(), `ebook-export-${jobId}-`));
    const isLegacy = profile.format === 'wav';
    const outputPath = path.join(tempDir, isLegacy ? 'merged.wav' : 'merged.mp3');
    listPath = path.join(os.tmpdir(), `ebook_concat_${jobId}.txt`);

    for (let index = 0; index < audioItems.length; index += 1) {
      const item = audioItems[index];
      if (item.localPath && fs.existsSync(item.localPath)) continue;
      const ext = path.extname(item.objectKey) || '.wav';
      const filePath = path.join(tempDir, `probe-${String(index + 1).padStart(4, '0')}${ext}`);
      const buffer = await storageService.getObjectBuffer(item.objectKey);
      fs.writeFileSync(filePath, buffer);
      item.localPath = filePath;
    }
    if (!SHOULD_PROBE_EARLY) {
      // Production default: probe after download/concat staging, still ahead
      // of any output; a bad segment aborts with its 1-based index.
      for (let index = 0; index < audioItems.length; index += 1) {
        await exportFfmpeg.probeSegment(ffmpegPath, audioItems[index].localPath, index, runFfmpeg);
      }
    }

    const listContent = audioItems
      .map((item) => `file '${escapeConcatPath(item.localPath)}'`)
      .join('\n');
    fs.writeFileSync(listPath, listContent);

    postProgress(35);

    if (isLegacy) {
      await runFfmpeg(ffmpegPath, exportFfmpeg.buildWavConcatArgs(listPath, outputPath));
      postProgress(75);
    } else {
      const mergedWavPath = path.join(tempDir, 'merged-intermediate.wav');
      await runFfmpeg(ffmpegPath, exportFfmpeg.buildIntermediateConcatArgs(listPath, mergedWavPath));
      postProgress(55);

      const book = await bookRepository.findById(chapter.book_id);
      const metadata = {
        title: [book?.title, chapter.title].filter((part) => part && String(part).trim()).map((part) => String(part).trim()).join(' - '),
        artist: book?.author && String(book.author).trim() ? String(book.author).trim() : null,
        album: book?.title && String(book.title).trim() ? String(book.title).trim() : null,
        date: Number.isFinite(Number(book?.publish_year)) && Number(book?.publish_year) > 0 ? String(Number(book.publish_year)) : null
      };
      if (!metadata.title) {
        throw new Error('章节导出缺少标题：书籍与章节名均为空。导出失败，未写入导出记录。');
      }

      let coverPath = null;
      if (book?.cover_url) {
        const coverKey = keyFromMediaUrl(book.cover_url);
        if (coverKey) {
          try {
            const coverBuffer = await storageService.getObjectBuffer(coverKey);
            coverPath = path.join(tempDir, `cover${path.extname(coverKey) || '.jpg'}`);
            fs.writeFileSync(coverPath, coverBuffer);
          } catch (coverError) {
            console.warn(`[exportChapterAudioJob] Cover object skipped: ${coverError.message}`);
          }
        }
      }

      const measurement = await exportFfmpeg.measureLoudness(ffmpegPath, mergedWavPath, profile.loudnessProfile, runFfmpeg);
      postProgress(70);
      await runFfmpeg(ffmpegPath, exportFfmpeg.buildMp3EncodeArgs({
        wavPath: mergedWavPath,
        outputPath,
        measurement,
        profile,
        metadata,
        coverPath
      }));
      postProgress(85);
    }

    const key = chapterExportKey(chapter.book_id, chapterId, profile.fileExtension);
    const outputBuffer = fs.readFileSync(outputPath);
    await storageService.putObject(key, outputBuffer, {
      contentType: profile.contentType,
      entityType: 'chapter_export',
      entityId: String(chapterId)
    });
    const audioUrl = mediaUrlForKey(key);

    await chapterAudioExportRepository.create({
      chapter_id: chapterId,
      audio_url: audioUrl,
      format: profile.format,
      source_hash: sourceHash,
      item_count: audioItems.length
    });

    postProgress(100);
    parentPort.postMessage({
      type: 'DONE',
      jobId,
      jobName,
      result: {
        url: audioUrl,
        chapterId,
        itemCount: audioItems.length,
        format: profile.format,
        exportProfile: profile.id
      }
    });
    parentPort.postMessage('done');
  } catch (error) {
    parentPort.postMessage({
      type: 'ERROR',
      jobId,
      jobName,
      error: error.message
    });
    parentPort.postMessage('done');
  } finally {
    if (listPath && fs.existsSync(listPath)) {
      fs.unlinkSync(listPath);
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
})();
