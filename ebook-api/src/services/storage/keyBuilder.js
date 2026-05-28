const path = require('path');
const { randomUUID } = require('crypto');

function cleanExt(filename, fallback = '') {
  const ext = path.extname(filename || '').toLowerCase();
  return ext || fallback;
}

function mediaUrlForKey(key) {
  return `/media/${encodeURIComponent(key)}`;
}

function keyFromMediaUrl(url) {
  if (!url) return null;
  const value = String(url);
  if (!value.startsWith('/media/')) return null;
  return decodeURIComponent(value.slice('/media/'.length).split('?')[0]);
}

function bookSourceKey(bookId, originalName) {
  return `books/${bookId}/source/${randomUUID()}${cleanExt(originalName)}`;
}

function coverKey(bookId, originalName) {
  return `books/${bookId}/covers/${randomUUID()}${cleanExt(originalName, '.jpg')}`;
}

function dialogueAudioKey(bookId, chapterId, dialogueId, ext = '.wav') {
  return `books/${bookId}/chapters/${chapterId}/dialogues/${dialogueId}-${randomUUID()}${cleanExt(ext, '.wav')}`;
}

function chapterExportKey(bookId, chapterId) {
  return `books/${bookId}/chapters/${chapterId}/exports/${randomUUID()}.wav`;
}

function voiceSampleKey(voiceProfileId, originalName) {
  return `voices/profiles/${voiceProfileId}/samples/${randomUUID()}${cleanExt(originalName)}`;
}

module.exports = {
  bookSourceKey,
  chapterExportKey,
  coverKey,
  dialogueAudioKey,
  keyFromMediaUrl,
  mediaUrlForKey,
  voiceSampleKey
};
