const SqliteBookRepository = require('./sqlite/SqliteBookRepository');
const SqliteChapterRepository = require('./sqlite/SqliteChapterRepository');
const SqliteChapterSegmentRepository = require('./sqlite/SqliteChapterSegmentRepository');
const SqliteChapterCharacterRepository = require('./sqlite/SqliteChapterCharacterRepository');
const SqliteDialogueRepository = require('./sqlite/SqliteDialogueRepository');
const SqliteBookCharacterRepository = require('./sqlite/SqliteBookCharacterRepository');
const SqliteCharacterVoiceBindingRepository = require('./sqlite/SqliteCharacterVoiceBindingRepository');
const SqliteChapterAudioExportRepository = require('./sqlite/SqliteChapterAudioExportRepository');
const SqliteVoiceProfileRepository = require('./sqlite/SqliteVoiceProfileRepository');
const SqliteProviderVoiceRepository = require('./sqlite/SqliteProviderVoiceRepository');

// Future proofing: If we change DB, we just change the instantiation here
// based on env variables (e.g. process.env.DB_TYPE === 'mongodb')

const repositories = {
  bookRepository: new SqliteBookRepository(),
  chapterRepository: new SqliteChapterRepository(),
  chapterSegmentRepository: new SqliteChapterSegmentRepository(),
  chapterCharacterRepository: new SqliteChapterCharacterRepository(),
  dialogueRepository: new SqliteDialogueRepository(),
  bookCharacterRepository: new SqliteBookCharacterRepository(),
  characterVoiceBindingRepository: new SqliteCharacterVoiceBindingRepository(),
  chapterAudioExportRepository: new SqliteChapterAudioExportRepository(),
  voiceProfileRepository: new SqliteVoiceProfileRepository(),
  providerVoiceRepository: new SqliteProviderVoiceRepository(),
};

module.exports = repositories;
