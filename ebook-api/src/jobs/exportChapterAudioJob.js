const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const {
  chapterRepository,
  dialogueRepository,
  chapterAudioExportRepository,
  chapterAudioSkipRangeRepository
} = require('../repositories');
const {
  buildChapterAudioItems,
  getChapterAudioItems,
  computeChapterAudioHash
} = require('../services/chapterAudioState');
const dubbingPlanner = require('../services/tts/dubbingPlanner');
const storageService = require('../services/storage/storageService');
const { chapterExportKey, mediaUrlForKey } = require('../services/storage/keyBuilder');

const { jobId, jobName, params } = workerData;
const { chapterId } = params;

const escapeConcatPath = (filePath) => filePath.replace(/'/g, "'\\''");

const runFfmpeg = (args) => new Promise((resolve, reject) => {
  const child = spawn(ffmpegPath, args);
  let stderr = '';

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) {
      resolve();
      return;
    }
    reject(new Error(stderr || `ffmpeg exited with code ${code}`));
  });
});

(async () => {
  let listPath = null;
  let tempDir = null;

  try {
    const chapter = await chapterRepository.findById(chapterId);
    if (!chapter) {
      throw new Error(`Chapter ${chapterId} not found`);
    }

    parentPort.postMessage({ type: 'PROGRESS', jobId, value: 10 });

    const dialogues = await dialogueRepository.findByChapterId(chapterId);
    const skipRanges = await chapterAudioSkipRangeRepository.findByChapterId(chapterId);
    const plan = await dubbingPlanner.createPlan(chapterId, { includeCompleted: true });
    const taskMap = new Map((plan.tasks || []).map((task) => [String(task.dialogueId), task]));
    const currentIds = new Set(
      buildChapterAudioItems(chapter, dialogues, taskMap, skipRanges)
        .filter((item) => item.audio_status === 'current')
        .map((item) => String(item.id))
    );
    const audioItems = getChapterAudioItems(dialogues.filter((dialogue) => currentIds.has(String(dialogue.id))));

    if (audioItems.length === 0) {
      throw new Error('No current synthesized audio found for this chapter');
    }

    const sourceHash = computeChapterAudioHash(audioItems);

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ebook-export-${jobId}-`));
    const outputPath = path.join(tempDir, 'merged.wav');
    listPath = path.join(os.tmpdir(), `ebook_concat_${jobId}.txt`);

    for (let index = 0; index < audioItems.length; index += 1) {
      const item = audioItems[index];
      const ext = path.extname(item.objectKey) || '.wav';
      const filePath = path.join(tempDir, `${String(index + 1).padStart(4, '0')}${ext}`);
      const buffer = await storageService.getObjectBuffer(item.objectKey);
      fs.writeFileSync(filePath, buffer);
      item.localPath = filePath;
    }

    const listContent = audioItems
      .map((item) => `file '${escapeConcatPath(item.localPath)}'`)
      .join('\n');
    fs.writeFileSync(listPath, listContent);

    parentPort.postMessage({ type: 'PROGRESS', jobId, value: 35 });

    await runFfmpeg([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-acodec', 'pcm_s16le',
      '-ar', '44100',
      '-ac', '2',
      outputPath
    ]);

    const key = chapterExportKey(chapter.book_id, chapterId);
    const outputBuffer = fs.readFileSync(outputPath);
    await storageService.putObject(key, outputBuffer, {
      contentType: 'audio/wav',
      entityType: 'chapter_export',
      entityId: String(chapterId)
    });
    const audioUrl = mediaUrlForKey(key);

    await chapterAudioExportRepository.create({
      chapter_id: chapterId,
      audio_url: audioUrl,
      format: 'wav',
      source_hash: sourceHash,
      item_count: audioItems.length
    });

    parentPort.postMessage({ type: 'PROGRESS', jobId, value: 100 });
    parentPort.postMessage({
      type: 'DONE',
      jobId,
      jobName,
      result: {
        url: audioUrl,
        chapterId,
        itemCount: audioItems.length,
        format: 'wav'
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
