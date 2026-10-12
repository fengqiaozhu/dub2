// CMP-38 database-backed tests: repeatable backfill, annotation retention,
// and read-only impact queries. Uses the existing DATABASE_URL setup.
// Run with: DATABASE_URL=postgres://ebook:ebook@localhost:5432/ebook node --test test/cmp38-db.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const HAS_DB = Boolean(process.env.DATABASE_URL);
const dbTest = HAS_DB ? test : test.skip;

const db = require('../src/repositories/postgres/db');
const { initSchema } = require('../src/repositories/postgres/schema');
const {
  bookRepository,
  chapterRepository,
  bookCharacterRepository,
  chapterCharacterRepository,
  characterVoiceBindingRepository,
  dialogueRepository,
  bookCharacterProfileRepository,
  bookCharacterAliasRepository,
  pronunciationRuleRepository,
  ttsConfigRepository
} = require('../src/repositories');
const pronunciationService = require('../src/services/tts/pronunciationService');
const dubbingPlanner = require('../src/services/tts/dubbingPlanner');
const characterController = require('../src/controllers/characterController');

function captureRes() {
  const state = { status: 200, body: undefined };
  return {
    state,
    status(code) { state.status = code; return this; },
    json(body) { state.body = body; return this; }
  };
}

async function seedBook() {
  const slug = `cmp38-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const bookId = await bookRepository.create({ title: `CMP-38 书 ${slug}`, format: 'txt' });
  const chapterId = await chapterRepository.create({
    book_id: bookId, title: '第一章', content: '罗辑说：“你好”', chapter_index: 0
  });
  await bookCharacterRepository.upsert(bookId, '罗辑', 0, 1);
  await chapterCharacterRepository.upsert(chapterId, bookId, '罗辑');
  return { bookId, chapterId };
}


dbTest('backfill is repeatable: second initSchema run does not duplicate profiles or aliases', async () => {
  const { bookId } = await seedBook();
  try {
    await initSchema();
    const firstProfiles = await bookCharacterProfileRepository.findByBookId(bookId);
    const firstAliases = await bookCharacterAliasRepository.findByBookId(bookId);
    assert.equal(firstProfiles.length, 1, 'one profile per distinct character name');
    assert.equal(firstProfiles[0].canonical_name, '罗辑');
    const sameNameAliases = firstAliases.filter((a) => a.alias === '罗辑');
    assert.equal(sameNameAliases.length, 1, 'same-name alias written once');

    await initSchema();
    const secondProfiles = await bookCharacterProfileRepository.findByBookId(bookId);
    const secondAliases = await bookCharacterAliasRepository.findByBookId(bookId);
    assert.deepEqual(secondProfiles.map((p) => p.id), firstProfiles.map((p) => p.id));
    assert.deepEqual(secondAliases.map((a) => a.id), firstAliases.map((a) => a.id));
  } finally {
    await bookRepository.delete(bookId);
  }
});

dbTest('migration keeps manual/confirmed annotations and dialogues.audio_source_hash untouched', async () => {
  const { bookId, chapterId } = await seedBook();
  try {
    const characters = await chapterCharacterRepository.findByChapterId(chapterId);
    const dialogueId = await dialogueRepository.create({
      chapter_character_id: characters[0].id,
      chapter_id: chapterId,
      content: '你好(world)',
      source: 'manual',
      annotation_status: 'confirmed'
    });
    await dialogueRepository.update(dialogueId, {
      audio_url: 'audio/keep.wav',
      audio_duration: 1.2,
      audio_source_hash: 'preserve-me-hash',
      audio_status: 'current'
    });
    await initSchema();
    const after = await dialogueRepository.findById(dialogueId);
    assert.equal(after.source, 'manual');
    assert.equal(after.annotation_status, 'confirmed');
    assert.equal(after.audio_source_hash, 'preserve-me-hash');
    assert.equal(after.audio_url, 'audio/keep.wav');
    assert.equal(after.audio_status, 'current');
    const count = await dialogueRepository.findByChapterId(chapterId);
    assert.equal(count.length, 1, 'dialogues survive migration');
  } finally {
    await bookRepository.delete(bookId);
  }
});

dbTest('impact query returns affected dialogue and chapter ids and deletes nothing', async () => {
  const { bookId, chapterId } = await seedBook();
  try {
    const characters = await chapterCharacterRepository.findByChapterId(chapterId);
    const dialogueId = await dialogueRepository.create({
      chapter_character_id: characters[0].id,
      chapter_id: chapterId,
      content: '你好世界',
      source: 'manual'
    });

    const ruleId = await pronunciationRuleRepository.create({
      book_id: bookId,
      rule_type: 'alias',
      match_text: '你好',
      replacement: '再见',
      priority: 0
    });
    const saved = await pronunciationRuleRepository.findById(ruleId);
    assert.equal(saved.enabled, true, 'default create preserves enabled flag');

    const impact = await pronunciationService.computeImpact(bookId, { ruleId });
    assert.ok(impact.dialogue_ids.map(String).includes(String(dialogueId)), 'affected dialogue listed');
    assert.ok(impact.chapter_ids.map(String).includes(String(chapterId)), 'affected chapter listed');

    const before = await dialogueRepository.findById(dialogueId);
    const rows = await db.query('SELECT COUNT(*)::int AS n FROM chapter_audio_exports WHERE chapter_id = $1', [chapterId]);
    assert.equal(rows.rows[0].n, 0, 'impact query must not modify storage/exports');
    assert.equal(before.content, '你好世界', 'stored dialogue.content unchanged');
    assert.ok(before.audio_url === null, 'no audio deleted');

    await pronunciationRuleRepository.delete(ruleId);
    const impactEmpty = await pronunciationService.computeImpact(bookId, { ruleId });
    assert.equal(impactEmpty.dialogue_count, 0);
  } finally {
    await bookRepository.delete(bookId);
  }
});

dbTest('profile controller: book-level alias rule applies to all members, impact counts included', async () => {
  const { bookId, chapterId } = await seedBook();
  try {
    const profilesRes = captureRes();
    await characterController.getCharacterProfiles({ params: { id: String(bookId) } }, profilesRes);
    assert.equal(profilesRes.state.status, 200);
    const profile = profilesRes.state.body.data[0];

    const aliasRes = captureRes();
    await characterController.addAlias(
      { params: { id: String(bookId), profileId: String(profile.id) }, body: { alias: '罗大师' } },
      aliasRes
    );
    assert.equal(aliasRes.state.status, 201);
    assert.ok(aliasRes.state.body.data.impact, 'alias creation reports impact info');

    const dupRes = captureRes();
    await characterController.addAlias(
      { params: { id: String(bookId), profileId: String(profile.id) }, body: { alias: '罗大师' } },
      dupRes
    );
    assert.equal(dupRes.state.status, 409, 'duplicate alias rejected');

    const chapterCharacters = await chapterCharacterRepository.findByChapterId(chapterId);
    const seededDialogueId = await dialogueRepository.create({
      chapter_character_id: chapterCharacters[0].id,
      chapter_id: chapterId,
      content: '你好世界',
      source: 'manual'
    });

    const ruleRes = captureRes();
    await characterController.createPronunciationRule(
      { params: { id: String(bookId) }, body: { rule_type: 'alias', match_text: '你好', replacement: '罗辑曰', priority: 3 } },
      ruleRes
    );
    assert.equal(ruleRes.state.status, 201);
    const rule = ruleRes.state.body.data;
    assert.equal(rule.impact.dialogue_count, 1, 'rule affects the dialogue that contains match text');

    const phonemeRes = captureRes();
    await characterController.createPronunciationRule(
      { params: { id: String(bookId) }, body: { rule_type: 'phoneme', match_text: '你', replacement: 'PHON:' } },
      phonemeRes
    );
    assert.equal(phonemeRes.state.status, 201);
    assert.ok(phonemeRes.state.body.data.impact, 'phoneme rule also reports impact');

    const badTypeRes = captureRes();
    await characterController.createPronunciationRule(
      { params: { id: String(bookId) }, body: { rule_type: 'ipa', match_text: 'x' } },
      badTypeRes
    );
    assert.equal(badTypeRes.state.status, 400);

    const disableRes = captureRes();
    await characterController.updatePronunciationRule(
      { params: { id: String(bookId), ruleId: String(rule.id) }, body: { enabled: false } },
      disableRes
    );
    assert.equal(disableRes.state.status, 200);
    assert.equal(disableRes.state.body.data.enabled, false);
    const impactAfter = await pronunciationService.computeImpact(bookId, { ruleId: rule.id });
    assert.equal(impactAfter.dialogue_count, 0, 'disabled rule no longer affects anything');

    await pronunciationRuleRepository.delete(rule.id);
    await bookCharacterAliasRepository.delete(aliasRes.state.body.data.id);
  } finally {
    await bookRepository.delete(bookId);
  }
});

dbTest('planner: alias replacement reaches provider text, phoneme replacement never does, warning counts skips', async () => {
  const { bookId, chapterId } = await seedBook();
  const originalFindByProvider = ttsConfigRepository.findByProvider;
  ttsConfigRepository.findByProvider = async () => [{
    id: 9901,
    name: 'Mosi test',
    provider: 'mosi',
    api_key: 'test-key',
    model: 'm1',
    is_active: true
  }];
  const aliasesToClean = [];
  const rulesToClean = [];
  try {
    await initSchema();
    await characterVoiceBindingRepository.upsert(bookId, '罗辑', {
      voice_id: 'sys-voice-1',
      provider: 'mosi',
      voice_source: 'system'
    });
    const chapterCharacters = await chapterCharacterRepository.findByChapterId(chapterId);
    await dialogueRepository.create({
      chapter_character_id: chapterCharacters[0].id,
      chapter_id: chapterId,
      content: '你好小米流星',
      char_start: 0,
      char_end: 6,
      source: 'manual'
    });

    const aliasRuleId = await pronunciationRuleRepository.create({
      book_id: bookId,
      rule_type: 'alias',
      match_text: '你好',
      replacement: '罗辑曰'
    });
    rulesToClean.push(aliasRuleId);
    const phonemeRuleId = await pronunciationRuleRepository.create({
      book_id: bookId,
      rule_type: 'phoneme',
      match_text: '流星',
      replacement: 'PHON:LIUXING'
    });
    rulesToClean.push(phonemeRuleId);

    const plan = await dubbingPlanner.createPlan(chapterId);

    const tasks = plan.tasks || [];
    assert.equal(tasks.length, 1, 'one dialogue task planned');
    const task = tasks[0];
    assert.equal(task.text, '罗辑曰小米流星', 'alias replacement is applied to the spoken text');
    assert.ok(!task.text.includes('PHON:LIUXING'), 'phoneme replacement must not appear in provider request text');
    assert.ok(!task.text.includes('PHON:'), 'no phoneme marker leaks into provider request text');
    assert.deepEqual(task.spoken_rule_ids, [aliasRuleId], 'applied alias rule ids are recorded');

    const phonemeWarnings = (plan.warnings || []).filter((entry) => entry.type === 'phoneme_skipped');
    assert.equal(phonemeWarnings.length, 1, 'one phoneme warning is emitted');
    assert.equal(phonemeWarnings[0].rule_count, 1, 'warning reports the number of skipped phoneme rules');

    const narrationTask = tasks.find((task) => task.characterName === undefined);
    assert.ok(!narrationTask, 'no narration task is produced for a chapter fully covered by dialogues');

    // A sentence without any rule hit keeps its current audio (hash unchanged).
    // Same input without rules => the golden digest path: spoken text only
    // enters the hash when it differs from the normalized content.
    assert.equal(
      dubbingPlanner.needsDubbing(
        { audio_url: '/media/a.wav', audio_source_hash: task.sourceHash, audio_status: 'current' },
        task.sourceHash,
        {}
      ),
      false
    );
  } finally {
    ttsConfigRepository.findByProvider = originalFindByProvider;
    for (const ruleId of rulesToClean) await pronunciationRuleRepository.delete(ruleId);
    for (const aliasId of aliasesToClean) await bookCharacterAliasRepository.delete(aliasId);
    await bookRepository.delete(bookId);
  }
});
