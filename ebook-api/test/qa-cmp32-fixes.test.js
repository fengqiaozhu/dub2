// CMP-32 independent verification of fixes #1, #2, #4, #5, #7.
// Run with: DATABASE_URL=postgres://ebook:ebook@localhost:5432/cmp32ebook node --test test/qa-cmp32-fixes.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const parserService = require('../src/services/parserService');
const aiService = require('../src/services/aiService');
const settingController = require('../src/controllers/settingController');
const fishAudioProvider = require('../src/services/tts/providers/fishAudioProvider');
const {
  bookRepository,
  chapterRepository,
  chapterCharacterRepository,
  dialogueRepository,
  aiConfigRepository,
  ttsConfigRepository
} = require('../src/repositories');
const db = require('../src/repositories/postgres/db');

const HAS_DB = Boolean(process.env.DATABASE_URL);
const dbTest = HAS_DB ? test : test.skip;

// ---------------------------------------------------------------- #1 MOBI
test('#1 buildChaptersFromMobi throws when no usable text/html is returned', () => {
  const noTextCases = [
    {},
    { text: '' },
    { text: '   \n  ' },
    { text: '', html: '' },
    { text: null, html: null },
    { html: '<p></p><div>  </div>' },
    { html: '<body><span></span></body>' },
    // legacy bug: parser object was JSON.stringify-ed into a fake chapter
    { text: 12345, html: undefined }
  ];
  for (const parsed of noTextCases) {
    assert.throws(
      () => parserService.buildChaptersFromMobi(parsed),
      /no usable text or html content/,
      `expected throw for ${JSON.stringify(parsed)}`
    );
  }
});

test('#1 buildChaptersFromMobi still yields chapters for usable text and usable html', () => {
  const fromText = parserService.buildChaptersFromMobi({
    text: 'Chapter 1\nhello world\nChapter 2\nsecond body'
  });
  assert.equal(fromText.length, 2);
  assert.equal(fromText[0].title, 'Chapter 1');
  assert.equal(fromText[0].content, 'hello world');

  const fromHtml = parserService.buildChaptersFromMobi({
    html: '<h1>Chapter 1</h1><p>hello</p>'
  });
  assert.ok(fromHtml.length >= 1);
  assert.match(fromHtml[0].content, /hello/);
});

test('#1 non-string parser object is rejected, not serialized into a fake chapter', () => {
  assert.throws(() => parserService.buildChaptersFromMobi({ text: { foo: 'bar' } }), /no usable text or html content/);
});

// ---------------------------------------------------------------- #5 retry
test('#5 isRetryableError: 4xx not retryable, 5xx/network/timeout retryable', () => {
  assert.equal(aiService.isRetryableError({ status: 400 }), false);
  assert.equal(aiService.isRetryableError({ status: 401 }), false);
  assert.equal(aiService.isRetryableError({ status: 404 }), false);
  assert.equal(aiService.isRetryableError({ status: 429 }), false);
  assert.equal(aiService.isRetryableError({ response: { status: 422 } }), false);

  assert.equal(aiService.isRetryableError({ status: 500 }), true);
  assert.equal(aiService.isRetryableError({ status: 502 }), true);
  assert.equal(aiService.isRetryableError({ response: { status: 503 } }), true);
  assert.equal(aiService.isRetryableError({ code: 'ECONNRESET' }), true);
  assert.equal(aiService.isRetryableError({ code: 'ETIMEDOUT' }), true);
  assert.equal(aiService.isRetryableError({ name: 'TimeoutError' }), true);
  assert.equal(aiService.isRetryableError({ name: 'AbortError' }), true);
  assert.equal(aiService.isRetryableError({ message: 'plain' }), false);
});

test('#5 retryableRequest does not retry 4xx (single attempt)', async () => {
  for (const status of [400, 401, 404, 429]) {
    let calls = 0;
    await assert.rejects(
      aiService.retryableRequest(async () => { calls++; throw { status, message: `http ${status}` }; }, 3, 1),
      (e) => e.status === status
    );
    assert.equal(calls, 1, `status ${status} was attempted ${calls} times`);
  }
});

test('#5 retryableRequest retries 5xx/network up to the cap then rethrows', async () => {
  let calls = 0;
  await assert.rejects(
    aiService.retryableRequest(async () => { calls++; throw { status: 503 }; }, 3, 1)
  );
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(
    aiService.retryableRequest(async () => { calls++; throw { code: 'ECONNRESET' }; }, 3, 1)
  );
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(
    aiService.retryableRequest(async () => { calls++; throw { code: 'ETIMEDOUT' }; }, 3, 1)
  );
  assert.equal(calls, 3);
});

test('#5 retryableRequest returns when a transient error later succeeds', async () => {
  let calls = 0;
  const value = await aiService.retryableRequest(async () => {
    calls++;
    if (calls < 3) throw { status: 503 };
    return 'ok';
  }, 3, 1);
  assert.equal(value, 'ok');
  assert.equal(calls, 3);
});

// ---------------------------------------------------------------- #7 fish
test('#7 Fish provider capability streaming is false across models', () => {
  const caps = fishAudioProvider.getCapabilities();
  assert.ok(Array.isArray(caps.models) && caps.models.length > 0);
  for (const model of caps.models) {
    assert.equal(model.capabilities.streaming, false, `model ${model.id} streaming`);
  }
});

// ---------------------------------------------------------------- #2 (DB)
dbTest('#2 re-analysis keeps manual/confirmed rows, skips overlapping AI, rewrites pure AI', async () => {
  const bookId = await bookRepository.create({ title: `cmp32-ann-${Date.now()}`, format: 'txt' });
  const content = '今天天气很好我们出去'; // 10 chars, indices 0..9
  const chapterId = await chapterRepository.create({
    book_id: bookId,
    title: 'ch',
    content,
    chapter_index: 0
  });
  const chapter = await chapterRepository.findById(chapterId);

  const ccManual = await chapterCharacterRepository.upsert(chapterId, bookId, '甲');
  const ccAi = await chapterCharacterRepository.upsert(chapterId, bookId, '乙');

  await dialogueRepository.createMany([
    { chapter_character_id: ccManual, chapter_id: chapterId, content: '今天', char_start: 0, char_end: 2, source: 'manual', annotation_status: 'manual', order_index: 0 },
    { chapter_character_id: ccManual, chapter_id: chapterId, content: '天气', char_start: 2, char_end: 4, source: 'ai', annotation_status: 'confirmed', order_index: 1 },
    { chapter_character_id: ccAi, chapter_id: chapterId, content: '很好', char_start: 4, char_end: 6, source: 'ai', annotation_status: 'ai', order_index: 2 }
  ]);

  const before = await dialogueRepository.findByChapterId(chapterId);
  const manualRow = before.find((d) => d.annotation_status === 'manual');
  const confirmedRow = before.find((d) => d.annotation_status === 'confirmed');
  const pureAiRow = before.find((d) => d.annotation_status === 'ai');

  const analysisResult = [
    {
      role: '甲',
      dialogues: [
        { content: '今天', char_index: [0, 2], emotion: '' },   // overlaps manual 0-2 -> skip
        { content: '天气', char_index: [3, 5], emotion: '' }     // overlaps confirmed 2-4 -> skip
      ]
    },
    {
      role: '乙',
      dialogues: [
        { content: '出去', char_index: [8, 10], emotion: '' }    // non-overlap -> insert
      ]
    }
  ];

  await aiService.persistAnalysisResult(chapter, analysisResult);

  const after = await dialogueRepository.findByChapterId(chapterId);
  const manualAfter = after.find((d) => Number(d.id) === Number(manualRow.id));
  const confirmedAfter = after.find((d) => Number(d.id) === Number(confirmedRow.id));

  assert.ok(manualAfter, 'manual row was deleted');
  assert.equal(manualAfter.annotation_status, 'manual');
  assert.equal(manualAfter.content, '今天');
  assert.equal(Number(manualAfter.char_start), 0);

  assert.ok(confirmedAfter, 'confirmed row was deleted');
  assert.equal(confirmedAfter.annotation_status, 'confirmed');
  assert.equal(confirmedAfter.content, '天气');

  assert.equal(after.find((d) => Number(d.id) === Number(pureAiRow.id)), undefined, 'pure AI row should be rewritten (deleted)');

  // exactly one non-protected row remains: the non-overlapping new AI line
  const newAi = after.filter((d) => d.annotation_status === 'ai');
  assert.equal(newAi.length, 1, 'expected exactly one new AI row, saw ' + JSON.stringify(newAi.map((d) => d.content)));
  assert.equal(newAi[0].content, '出去');
  assert.equal(newAi[0].source, 'ai');

  const overlapContent = after.filter((d) => d.content === '今天' || d.content === '天气');
  assert.equal(overlapContent.length, 2, 'overlapping new AI rows must not be inserted');

  await bookRepository.delete(bookId);
});

// ---------------------------------------------------------------- #4 (DB)
function captureRes() {
  const state = { status: 200, body: undefined };
  return {
    state,
    status(code) { state.status = code; return this; },
    json(body) { state.body = body; return this; }
  };
}

dbTest('#4 AI + TTS config list responses expose has_api_key but never api_key', async () => {
  const aiId = await aiConfigRepository.create({
    name: `cmp32-ai-${Date.now()}`, api_url: 'https://example.invalid', api_key: 'sk-secret-AI',
    model: 'm', is_reasoning: false, is_active: false
  });
  const ttsId = await ttsConfigRepository.create({
    name: `cmp32-tts-${Date.now()}`, provider: 'fish_audio', api_url: 'https://example.invalid',
    api_key: 'sk-secret-TTS', model: 's2.1-pro', is_active: false
  });

  const rawAi = await aiConfigRepository.findAll();
  const rawTts = await ttsConfigRepository.findAll();
  assert.equal('api_key' in rawAi.find((c) => Number(c.id) === Number(aiId)), false, 'raw AI query must not select api_key');
  assert.equal('api_key' in rawTts.find((c) => Number(c.id) === Number(ttsId)), false, 'raw TTS query must not select api_key');

  const resAi = captureRes();
  await settingController.getAiConfigs({}, resAi);
  const aiRow = resAi.state.body.data.find((c) => Number(c.id) === Number(aiId));
  assert.ok(aiRow, 'AI config missing from list');
  assert.equal(aiRow.has_api_key, true);
  assert.equal(JSON.stringify(aiRow).includes('sk-secret-AI'), false);
  assert.equal(JSON.stringify(aiRow).includes('"api_key"'), false);

  const resTts = captureRes();
  await settingController.getTtsConfigs({}, resTts);
  const ttsRow = resTts.state.body.data.find((c) => Number(c.id) === Number(ttsId));
  assert.ok(ttsRow, 'TTS config missing from list');
  assert.equal(ttsRow.has_api_key, true);
  assert.equal(JSON.stringify(ttsRow).includes('sk-secret-TTS'), false);
  assert.equal(JSON.stringify(ttsRow).includes('"api_key"'), false);

  await db.query('DELETE FROM ai_configs WHERE id = $1', [aiId]);
  await db.query('DELETE FROM tts_configs WHERE id = $1', [ttsId]);
});

test.after(async () => {
  if (HAS_DB) await db.close();
});
