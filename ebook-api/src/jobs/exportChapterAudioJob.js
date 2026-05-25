const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const SqliteChapterRepository = require('../repositories/sqlite/SqliteChapterRepository');
const SqliteDialogueRepository = require('../repositories/sqlite/SqliteDialogueRepository');
const SqliteChapterAudioExportRepository = require('../repositories/sqlite/SqliteChapterAudioExportRepository');
const {
  publicDir,
  buildChapterAudioItems,
  getChapterAudioItems,
  computeChapterAudioHash
} = require('../services/chapterAudioState');
const dubbingPlanner = require('../services/tts/dubbingPlanner');

const chapterRepository = new SqliteChapterRepository();
const dialogueRepository = new SqliteDialogueRepository();
const chapterAudioExportRepository = new SqliteChapterAudioExportRepository();

const { jobId, jobName, params } = workerData;
const { chapterId } = params;

const exportsDir = path.join(publicDir, 'exports');

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

  try {
    const chapter = chapterRepository.findById(chapterId);
    if (!chapter) {
      throw new Error(`Chapter ${chapterId} not found`);
    }

    parentPort.postMessage({ type: 'PROGRESS', jobId, value: 10 });

    const dialogues = dialogueRepository.findByChapterId(chapterId);
    const plan = dubbingPlanner.createPlan(chapterId, { includeCompleted: true });
    const taskMap = new Map((plan.tasks || []).map((task) => [String(task.dialogueId), task]));
    const currentIds = new Set(
      buildChapterAudioItems(chapter, dialogues, taskMap)
        .filter((item) => item.audio_status === 'current')
        .map((item) => String(item.id))
    );
    const audioItems = getChapterAudioItems(dialogues.filter((dialogue) => currentIds.has(String(dialogue.id))));

    if (audioItems.length === 0) {
      throw new Error('No current synthesized audio found for this chapter');
    }

    const sourceHash = computeChapterAudioHash(audioItems);

    fs.mkdirSync(exportsDir, { recursive: true });
    const outputName = `chapter_${chapterId}_${Date.now()}.wav`;
    const outputPath = path.join(exportsDir, outputName);
    listPath = path.join(os.tmpdir(), `ebook_concat_${jobId}.txt`);

    const listContent = audioItems
      .map((item) => `file '${escapeConcatPath(item.audioPath)}'`)
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

    chapterAudioExportRepository.create({
      chapter_id: chapterId,
      audio_url: `/exports/${outputName}`,
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
        url: `/exports/${outputName}`,
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
  }
})();
