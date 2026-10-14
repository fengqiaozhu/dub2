const test = require('node:test');
const assert = require('node:assert/strict');
const aiService = require('../src/services/aiService');
const {
  dialogueRepository,
  chapterCharacterRepository,
  bookCharacterRepository
} = require('../src/repositories');

const MANUAL_LINE = '这是人工标注的两句。';
const AI_LINE = '纯AI新句。';
const CHAPTER_CONTENT = `“${MANUAL_LINE}”旁白文字。“${AI_LINE}”正文说明。`;

// 章节内各行的真实字符区间，保证 slice 出的内容与 AI 行内容一致。
const MANUAL_START = CHAPTER_CONTENT.indexOf(MANUAL_LINE);
const MANUAL_END = MANUAL_START + MANUAL_LINE.length; // 不含引号的区间
const AI_START = CHAPTER_CONTENT.indexOf(AI_LINE);
const AI_END = AI_START + AI_LINE.length;

function createChapterFixture() {
  return {
    id: 5,
    book_id: 2,
    content: CHAPTER_CONTENT
  };
}

function stubRepositories(t, options = {}) {
  const calls = {
    dialogueDeleteExceptIds: [],
    characterDeleteExceptIds: [],
    insertedDialogues: [],
    characterUpserts: [],
    recalculatedBooks: []
  };

  const originalFindByChapterId = dialogueRepository.findByChapterId;
  const originalDialogueDelete = dialogueRepository.deleteByChapterIdExceptIds;
  const originalCharacterDelete = chapterCharacterRepository.deleteByChapterIdExceptIds;
  const originalCreateMany = dialogueRepository.createMany;
  const originalUpsert = chapterCharacterRepository.upsert;
  const originalRecalculate = bookCharacterRepository.recalculateForBook;

  dialogueRepository.findByChapterId = async () => options.existingDialogues || [];
  dialogueRepository.deleteByChapterIdExceptIds = async (chapterId, keepIds) => {
    calls.dialogueDeleteExceptIds.push({ chapterId, keepIds });
    return 0;
  };
  chapterCharacterRepository.deleteByChapterIdExceptIds = async (chapterId, keepIds) => {
    calls.characterDeleteExceptIds.push({ chapterId, keepIds });
    return 0;
  };
  dialogueRepository.createMany = async (dialogues) => {
    calls.insertedDialogues.push(...dialogues);
  };
  chapterCharacterRepository.upsert = async (chapterId, bookId, roleName) => {
    calls.characterUpserts.push({ chapterId, bookId, roleName });
    return roleName === '张三' ? 11 : 12;
  };
  bookCharacterRepository.recalculateForBook = async (bookId) => {
    calls.recalculatedBooks.push(bookId);
  };

  t.after(() => {
    dialogueRepository.findByChapterId = originalFindByChapterId;
    dialogueRepository.deleteByChapterIdExceptIds = originalDialogueDelete;
    chapterCharacterRepository.deleteByChapterIdExceptIds = originalCharacterDelete;
    dialogueRepository.createMany = originalCreateMany;
    chapterCharacterRepository.upsert = originalUpsert;
    bookCharacterRepository.recalculateForBook = originalRecalculate;
  });

  return calls;
}

test('manual annotations survive re-analysis and overlapping AI rows are skipped', async (t) => {
  const existingDialogues = [
    {
      id: 101,
      chapter_id: 5,
      chapter_character_id: 7,
      content: MANUAL_LINE,
      char_start: MANUAL_START,
      char_end: MANUAL_END,
      source: 'manual',
      annotation_status: 'manual'
    },
    {
      id: 102,
      chapter_id: 5,
      chapter_character_id: 8,
      content: '旧的AI行',
      char_start: -1,
      char_end: -1,
      source: 'ai',
      annotation_status: 'ai'
    }
  ];

  const calls = stubRepositories(t, { existingDialogues });

  const analysisResult = [
    {
      role: '张三',
      dialogues: [
        { content: MANUAL_LINE, emotion: '', char_index: [MANUAL_START, MANUAL_END] },
        { content: AI_LINE, emotion: '', char_index: [AI_START, AI_END] }
      ]
    }
  ];

  await aiService.persistAnalysisResult(createChapterFixture(), analysisResult);

  assert.deepEqual(calls.dialogueDeleteExceptIds, [{ chapterId: 5, keepIds: [101] }]);
  assert.deepEqual(calls.characterDeleteExceptIds, [{ chapterId: 5, keepIds: [7] }]);

  assert.deepEqual(calls.characterUpserts.map((u) => u.roleName), ['张三']);

  assert.equal(calls.insertedDialogues.length, 1);
  assert.equal(calls.insertedDialogues[0].content, AI_LINE);
  assert.deepEqual(calls.insertedDialogues[0].char_index, undefined);
  assert.equal(calls.insertedDialogues[0].source, 'ai');
  assert.equal(calls.insertedDialogues[0].annotation_status, 'ai');
  assert.deepEqual(calls.recalculatedBooks, [2]);
});

test('confirmed-status annotations are also protected', async (t) => {
  const existingDialogues = [
    {
      id: 201,
      chapter_id: 5,
      chapter_character_id: 9,
      content: MANUAL_LINE,
      char_start: MANUAL_START,
      char_end: MANUAL_END,
      source: 'ai',
      annotation_status: 'confirmed'
    }
  ];

  const calls = stubRepositories(t, { existingDialogues });

  const analysisResult = [
    {
      role: '李四',
      dialogues: [
        { content: MANUAL_LINE, emotion: '', char_index: [MANUAL_START, MANUAL_END] },
        { content: AI_LINE, emotion: '', char_index: [AI_START, AI_END] }
      ]
    }
  ];

  await aiService.persistAnalysisResult(createChapterFixture(), analysisResult);

  assert.deepEqual(calls.dialogueDeleteExceptIds, [{ chapterId: 5, keepIds: [201] }]);
  assert.deepEqual(calls.characterDeleteExceptIds, [{ chapterId: 5, keepIds: [9] }]);
  // 与受保护区间重叠的新 AI 行必须被跳过，只有不受保护的行可以重新写入。
  assert.deepEqual(
    calls.insertedDialogues.map((d) => d.content),
    [AI_LINE]
  );
});

test('pure AI rows can be replaced by the new run', async (t) => {
  const existingDialogues = [
    {
      id: 301,
      chapter_id: 5,
      chapter_character_id: 10,
      content: MANUAL_LINE,
      char_start: MANUAL_START,
      char_end: MANUAL_END,
      source: 'ai',
      annotation_status: 'ai'
    }
  ];

  const calls = stubRepositories(t, { existingDialogues });

  const analysisResult = [
    {
      role: '张三',
      dialogues: [
        { content: MANUAL_LINE, emotion: '平静', char_index: [MANUAL_START, MANUAL_END] }
      ]
    }
  ];

  await aiService.persistAnalysisResult(createChapterFixture(), analysisResult);

  assert.deepEqual(calls.dialogueDeleteExceptIds, [{ chapterId: 5, keepIds: [] }]);
  assert.equal(calls.insertedDialogues.length, 1);
  assert.equal(calls.insertedDialogues[0].content, MANUAL_LINE);
  assert.equal(calls.insertedDialogues[0].emotion, '平静');
});

test('manual-protected row is preserved even when a new AI row covers the whole chapter', async (t) => {
  const existingDialogues = [
    {
      id: 401,
      chapter_id: 5,
      chapter_character_id: 12,
      content: MANUAL_LINE,
      char_start: MANUAL_START,
      char_end: MANUAL_END,
      source: 'manual',
      annotation_status: 'manual'
    }
  ];

  const calls = stubRepositories(t, { existingDialogues });

  const analysisResult = [
    {
      role: '张三',
      dialogues: [
        { content: CHAPTER_CONTENT, emotion: '', char_index: [0, CHAPTER_CONTENT.length] }
      ]
    }
  ];

  await aiService.persistAnalysisResult(createChapterFixture(), analysisResult);

  assert.deepEqual(calls.dialogueDeleteExceptIds, [{ chapterId: 5, keepIds: [401] }]);
  // 覆盖整章的新 AI 行与人工区间重叠，必须跳过；不得插入整章大段。
  assert.deepEqual(calls.insertedDialogues, []);
});
