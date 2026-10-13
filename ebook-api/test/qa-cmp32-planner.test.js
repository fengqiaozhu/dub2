// CMP-32 independent verification of fix #6: planner failures are visible to the caller.
// Run with: DATABASE_URL=postgres://ebook:ebook@localhost:5432/cmp32ebook node --test test/qa-cmp32-planner.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const chapterController = require('../src/controllers/chapterController');
const dubbingPlanner = require('../src/services/tts/dubbingPlanner');
const { bookRepository, chapterRepository } = require('../src/repositories');
const db = require('../src/repositories/postgres/db');

const HAS_DB = Boolean(process.env.DATABASE_URL);
const dbTest = HAS_DB ? test : test.skip;

function captureRes() {
  const state = { status: 200, body: undefined, headers: {} };
  return {
    state,
    status(code) { state.status = code; return this; },
    json(body) { state.body = body; return this; },
    attachment() { return this; },
    type() { return this; },
    send(body) { state.body = body; return this; }
  };
}

dbTest('#6 getChapter surfaces a planner failure as 500 internal_error (not 200 with 0 tasks)', async () => {
  const bookId = await bookRepository.create({ title: `cmp32-plan-${Date.now()}`, format: 'txt' });
  const chapterId = await chapterRepository.create({
    book_id: bookId, title: 'ch', content: '第一章\n他说：“你好”', chapter_index: 0
  });

  const original = dubbingPlanner.createPlan;
  dubbingPlanner.createPlan = async () => { throw new Error('simulated planner explosion'); };
  try {
    const res = captureRes();
    await chapterController.getChapter({ params: { id: String(chapterId) } }, res);
    assert.equal(res.state.status, 500, 'planner failure must map to 500, got ' + res.state.status);
    assert.deepEqual(res.state.body, { error: 'internal_error' });
  } finally {
    dubbingPlanner.createPlan = original;
    await bookRepository.delete(bookId);
  }
});

test('#6 dubbingPreview surfaces a planner failure with a 500 and the error message', async () => {
  const original = dubbingPlanner.createPlan;
  dubbingPlanner.createPlan = async () => { throw new Error('planner blew up'); };
  try {
    const res = captureRes();
    await chapterController.dubbingPreview({ params: { id: '1' } }, res);
    assert.equal(res.state.status, 500);
    assert.equal(res.state.body.error, 'planner blew up');
  } finally {
    dubbingPlanner.createPlan = original;
  }
});

dbTest('#6 control: with a working planner getChapter returns 200 (error path is specifically for failures)', async () => {
  const bookId = await bookRepository.create({ title: `cmp32-plan-ok-${Date.now()}`, format: 'txt' });
  const chapterId = await chapterRepository.create({
    book_id: bookId, title: 'ch', content: '第一章\n他说：“你好”', chapter_index: 0
  });
  try {
    const res = captureRes();
    await chapterController.getChapter({ params: { id: String(chapterId) } }, res);
    assert.equal(res.state.status, 200, 'healthy planner should still yield 200');
  } finally {
    await bookRepository.delete(bookId);
  }
});

test.after(async () => { await db.close(); });
