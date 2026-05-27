require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { parentPort, workerData } = require('worker_threads');
const ttsService = require('../services/tts');
const SqliteDialogueRepository = require('../repositories/sqlite/SqliteDialogueRepository');
const SqliteChapterAudioSkipRangeRepository = require('../repositories/sqlite/SqliteChapterAudioSkipRangeRepository');
const dubbingPlanner = require('../services/tts/dubbingPlanner');
const { isAudioSkipped, normalizeDialogueContent } = require('../services/chapterAudioState');

const dialogueRepository = new SqliteDialogueRepository();
const chapterAudioSkipRangeRepository = new SqliteChapterAudioSkipRangeRepository();

const { jobId, jobName, params } = workerData;
const { chapterId, items, force = false } = params;

(async () => {
  try {
    console.log(`[batchDubbingJob] Start batch dubbing for job ${jobId}, chapter: ${chapterId}`);

    let taskItems = items;
    if (!taskItems || taskItems.length === 0) {
      const plan = dubbingPlanner.createPlan(chapterId, { includeCompleted: force });
      if (!plan.ready) {
        const blocked = plan.roles
          .filter((role) => !role.ready)
          .map((role) => `${role.character_name}: ${role.message || role.status}`)
          .join('; ');
        throw new Error(`Dubbing plan is not ready. ${blocked}`);
      }
      taskItems = plan.tasks;
    }

    const total = taskItems.length;
    console.log(`[batchDubbingJob] Found ${total} tasks to dub.`);

    if (total === 0) {
      parentPort.postMessage({ type: 'PROGRESS', jobId, value: 100 });
      parentPort.postMessage({ type: 'DONE', jobId, jobName, result: { dubbed: 0, skipped: 0, errors: 0 } });
      parentPort.postMessage('done');
      return;
    }

    let dubbedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const skipRanges = chapterAudioSkipRangeRepository.findByChapterId(chapterId);

    for (let i = 0; i < total; i++) {
      const item = taskItems[i];
      const { dialogueId, text, voiceId, provider = 'mosi', model, options, intent, sourceHash } = item;
      const speakableText = normalizeDialogueContent(text);

      // Ensure idempotency: Double check DB right before synthesis just in case
      const currentDialogue = dialogueRepository.findById(dialogueId);
      if (!speakableText) {
        console.log(`[batchDubbingJob] Dialogue ${dialogueId} has blank text, skipping.`);
        skippedCount++;
        const progress = Math.floor(((i + 1) / total) * 100);
        parentPort.postMessage({ type: 'PROGRESS', jobId, value: progress });
        continue;
      }
      if (isAudioSkipped(currentDialogue, skipRanges)) {
        console.log(`[batchDubbingJob] Dialogue ${dialogueId} is marked skipped, skipping.`);
        skippedCount++;
        const progress = Math.floor(((i + 1) / total) * 100);
        parentPort.postMessage({ type: 'PROGRESS', jobId, value: progress });
        continue;
      }
      if (!force && currentDialogue?.audio_url && currentDialogue.audio_source_hash === sourceHash && currentDialogue.audio_status === 'current') {
        console.log(`[batchDubbingJob] Dialogue ${dialogueId} already has current audio, skipping.`);
        // Already dubbed
        const progress = Math.floor(((i + 1) / total) * 100);
        parentPort.postMessage({ type: 'PROGRESS', jobId, value: progress });
        continue;
      }

      console.log(`[batchDubbingJob] Synthesizing ${dialogueId}... (${i+1}/${total})`);
      try {
        const result = await ttsService.synthesize({
          provider,
          text: speakableText,
          voice_id: voiceId,
          model,
          options: options || {},
          intent
        });
        
        // Save to DB
        dialogueRepository.update(dialogueId, {
          audio_url: result.url,
          audio_duration: result.duration_s,
          audio_source_hash: sourceHash,
          audio_error: null,
          audio_status: 'current'
        });
        dubbedCount++;
      } catch (err) {
        console.error(`[batchDubbingJob] Error synthesizing dialogue ${dialogueId}:`, err.message);
        errorCount++;
        dialogueRepository.update(dialogueId, {
          audio_error: err.message,
          audio_status: 'failed'
        });
        // Continue to next item without throwing
      }

      // Update progress
      const progress = Math.floor(((i + 1) / total) * 100);
      parentPort.postMessage({ type: 'PROGRESS', jobId, value: progress });
    }

    parentPort.postMessage({
      type: 'DONE',
      jobId,
      jobName,
      result: { dubbed: dubbedCount, skipped: skippedCount, errors: errorCount, total }
    });

    parentPort.postMessage('done');
  } catch (error) {
    console.error(`[batchDubbingJob] Fatal error:`, error);
    parentPort.postMessage({
      type: 'ERROR',
      jobId,
      jobName,
      error: error.message
    });
    parentPort.postMessage('done');
  }
})();
