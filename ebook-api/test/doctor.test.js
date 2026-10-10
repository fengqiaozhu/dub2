const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectStorageHealth, collectReferencedKeys } = require('../scripts/doctor');

test('doctor: clean state with matching references and storage records passes', async () => {
  const mockDb = {
    many: async (sql) => {
      if (sql.includes('books')) return [{ id: 1, url: '/media/books/cover.png' }];
      if (sql.includes('dialogues')) return [{ id: 2, url: '/media/audio/dia1.mp3' }];
      return [];
    }
  };

  const mockStorage = {
    headObject: async (key) => ({ ContentLength: 1024, Key: key })
  };

  const mockStorageRepo = {
    findAll: async () => [
      { object_key: 'books/cover.png' },
      { object_key: 'audio/dia1.mp3' }
    ]
  };

  const result = await inspectStorageHealth({
    database: mockDb,
    storage: mockStorage,
    storageRepo: mockStorageRepo
  });

  assert.equal(result.referenced, 2);
  assert.equal(result.storage_records, 2);
  assert.deepEqual(result.missing_objects, []);
  assert.deepEqual(result.untracked_references, []);
  assert.equal(result.ok, true);
});

test('doctor: missing object in S3 is detected and marks ok false', async () => {
  const mockDb = {
    many: async (sql) => {
      if (sql.includes('dialogues')) return [{ id: 1, url: '/media/audio/missing.mp3' }];
      return [];
    }
  };

  const mockStorage = {
    headObject: async () => null // Object not found in S3
  };

  const mockStorageRepo = {
    findAll: async () => [{ object_key: 'audio/missing.mp3' }]
  };

  const result = await inspectStorageHealth({
    database: mockDb,
    storage: mockStorage,
    storageRepo: mockStorageRepo
  });

  assert.equal(result.referenced, 1);
  assert.deepEqual(result.missing_objects, ['audio/missing.mp3']);
  assert.deepEqual(result.untracked_references, []);
  assert.equal(result.ok, false);
});

test('doctor: referenced object missing in storage_objects table is tracked', async () => {
  const mockDb = {
    many: async (sql) => {
      if (sql.includes('voice_profiles')) return [{ id: 1, url: '/media/voices/sample.mp3' }];
      return [];
    }
  };

  const mockStorage = {
    headObject: async () => ({ ContentLength: 512 })
  };

  const mockStorageRepo = {
    findAll: async () => [] // Missing metadata record in db
  };

  const result = await inspectStorageHealth({
    database: mockDb,
    storage: mockStorage,
    storageRepo: mockStorageRepo
  });

  assert.equal(result.referenced, 1);
  assert.deepEqual(result.missing_objects, []);
  assert.deepEqual(result.untracked_references, ['voices/sample.mp3']);
  assert.equal(result.ok, false);
});

test('doctor: safely ignores non-media or malformed URLs without throwing', async () => {
  const mockDb = {
    many: async (sql) => {
      if (sql.includes('books')) return [
        { id: 1, url: 'https://external-cdn.com/avatar.jpg' },
        { id: 2, url: '/invalid-path/image.png' }
      ];
      return [];
    }
  };

  const mockStorage = {
    headObject: async () => null
  };

  const mockStorageRepo = {
    findAll: async () => []
  };

  const result = await inspectStorageHealth({
    database: mockDb,
    storage: mockStorage,
    storageRepo: mockStorageRepo
  });

  assert.equal(result.referenced, 0);
  assert.deepEqual(result.missing_objects, []);
  assert.deepEqual(result.untracked_references, []);
  assert.equal(result.ok, true);
});

test('doctor: surfaces database query failures', async () => {
  const mockDb = {
    many: async () => {
      throw new Error('Postgres connection failed');
    }
  };

  await assert.rejects(
    async () => inspectStorageHealth({ database: mockDb }),
    /Postgres connection failed/
  );
});
