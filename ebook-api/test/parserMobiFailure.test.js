const test = require('node:test');
const assert = require('node:assert/strict');
const parserService = require('../src/services/parserService');

test('MOBI result without usable text or html fails explicitly', () => {
  assert.throws(
    () => parserService.buildChaptersFromMobi({}),
    /no usable text or html/i
  );
});

test('MOBI result that is only serialized junk fails explicitly instead of becoming a chapter', () => {
  assert.throws(
    () => parserService.buildChaptersFromMobi({ meta: { title: 'book' }, chapters: [] }),
    /no usable text or html/i
  );
  assert.throws(
    () => parserService.buildChaptersFromMobi(null),
    /no usable text or html/i
  );
});

test('empty text and empty html variants also fail explicitly', () => {
  assert.throws(
    () => parserService.buildChaptersFromMobi({ text: '' }),
    /no usable text or html/i
  );
  assert.throws(
    () => parserService.buildChaptersFromMobi({ html: '<p>   </p>' }),
    /no usable text or html/i
  );
});

test('MOBI raw text is split into chapters', () => {
  const chapters = parserService.buildChaptersFromMobi({
    text: '第一章 起始\n清晨\n第二章 转折\n黄昏'
  });
  assert.deepEqual(
    chapters.map((c) => [c.title, c.content, c.chapter_index]),
    [
      ['第一章 起始', '清晨', 0],
      ['第二章 转折', '黄昏', 1]
    ]
  );
});

test('MOBI html content is stripped of tags before splitting', () => {
  const chapters = parserService.buildChaptersFromMobi({
    html: '<html><body><p>Chapter 1</p><p>hello</p></body></html>'
  });
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].title, 'Chapter 1');
  assert.equal(chapters[0].content, 'hello');
});
