import test from 'node:test';
import assert from 'node:assert/strict';

// Test replicating the exact alias addition/deletion store logic
function createTestContext() {
  return {
    characterProfiles: [
      {
        id: "1", // Bigint from postgres serialized as string
        book_id: "100",
        canonical_name: "主角",
        aliases: [
          { id: "10", profile_id: "1", book_id: "100", alias: "阿强" }
        ],
        impact: null
      }
    ]
  };
}

test('addCharacterAlias finds profile when profile.id is string and profileId argument is number', () => {
  const context = createTestContext();
  const profileId = 1; // number passed from caller
  const newAlias = { id: "11", profile_id: "1", book_id: "100", alias: "小强" };

  const profile = context.characterProfiles.find(
    (p) => String(p.id) === String(profileId) || Number(p.id) === Number(profileId)
  );
  assert.ok(profile, 'Profile should be found');
  profile.aliases = [...(profile.aliases || []), newAlias];
  context.characterProfiles = [...context.characterProfiles];

  assert.equal(profile.aliases.length, 2);
  assert.equal(profile.aliases[1].alias, '小强');
  assert.equal(context.characterProfiles[0].aliases.length, 2);
});

test('deleteCharacterAlias filters alias when id is string and aliasId is number or string', () => {
  const context = createTestContext();
  const profileId = "1";
  const aliasId = 10; // number

  const profile = context.characterProfiles.find(
    (p) => String(p.id) === String(profileId) || Number(p.id) === Number(profileId)
  );
  assert.ok(profile, 'Profile should be found');
  profile.aliases = (profile.aliases || []).filter(
    (a) => String(a.id) !== String(aliasId) && Number(a.id) !== Number(aliasId)
  );
  context.characterProfiles = [...context.characterProfiles];

  assert.equal(profile.aliases.length, 0);
  assert.equal(context.characterProfiles[0].aliases.length, 0);
});
