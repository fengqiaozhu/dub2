const {
  bookCharacterProfileRepository,
  bookCharacterAliasRepository,
  pronunciationRuleRepository,
  dialogueRepository,
  characterVoiceBindingRepository
} = require('../../repositories');
const { resolveBinding } = require('./voiceResolver');
const { normalizeDialogueContent } = require('../chapterAudioState');

// Enabled spoken-text rules: rule_type 'alias' and enabled. Order:
// priority DESC, match_text length DESC, id ASC. Applied on the normalized
// spoken text with non-overlapping replacements. 'phoneme' rules are stored
// but never rendered into provider request text in this repo (Mosi / Fish
// Audio / Fish self-hosted all have ssml=false).
function normalizeRuleText(entry) {
  return {
    ...entry,
    match_text: normalizeDialogueContent(entry.match_text),
    replacement: normalizeDialogueContent(entry.replacement || '')
  };
}

async function loadEnabledRules(bookId) {
  const rows = await pronunciationRuleRepository.findByBookId(bookId);
  return rows
    .filter((rule) => rule.enabled && rule.rule_type === 'alias')
    .map(normalizeRuleText)
    .filter((rule) => rule.match_text);
}

async function loadEnabledPhonemeRules(bookId) {
  const rows = await pronunciationRuleRepository.findByBookId(bookId);
  return rows
    .filter((rule) => rule.enabled && rule.rule_type === 'phoneme')
    .map(normalizeRuleText)
    .filter((rule) => rule.match_text);
}

// Non-overlapping left-to-right scan; rules already ordered by caller's sort.
function applyAliasRule(text, rule) {
  if (!rule.match_text) return { text, hit: null };
  let result = '';
  let cursor = 0;
  let hitFrom = -1;
  while (cursor <= text.length) {
    const found = text.indexOf(rule.match_text, cursor);
    if (found === -1) break;
    result += text.slice(cursor, found) + rule.replacement;
    cursor = found + rule.match_text.length;
    if (hitFrom === -1) hitFrom = found;
  }
  result += text.slice(cursor);
  return { text: result, hit: hitFrom >= 0 ? rule : null };
}

function applyAliasRules(text, rules, profileId = null) {
  let current = text;
  const applied = [];
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (rule.profile_id != null && profileId != null && Number(rule.profile_id) !== Number(profileId)) continue;
    if (rule.profile_id != null && profileId == null) continue;
    const outcome = applyAliasRule(current, rule);
    current = outcome.text;
    if (outcome.hit) applied.push({ rule_id: rule.id, match_text: rule.match_text, replacement: rule.replacement, priority: rule.priority });
  }
  return { text: current, applied };
}

// name -> { profileId, canonicalName }; canonical names map onto themselves.
async function buildAliasMap(bookId) {
  const [profiles, aliases] = await Promise.all([
    bookCharacterProfileRepository.findByBookId(bookId),
    bookCharacterAliasRepository.findByBookId(bookId)
  ]);
  const map = new Map();
  for (const profile of profiles) {
    map.set(String(profile.canonical_name), { profileId: profile.id, canonicalName: profile.canonical_name });
  }
  for (const alias of aliases) {
    map.set(String(alias.alias), {
      profileId: alias.profile_id,
      canonicalName: alias.canonical_name || alias.alias
    });
  }
  return map;
}

function resolveCanonicalName(name, aliasMap) {
  if (!name) return name;
  const entry = aliasMap.get(String(name));
  return entry ? entry.canonicalName : name;
}

// Voice binding resolution precedence: canonical name first (alias falls
// back to the profile's canonical name), then the raw dialogue name so that
// pre-profile books keep working unchanged.
function resolveBindingForName(canonicalName, rawName, bindingMap) {
  return bindingMap.get(String(canonicalName)) || bindingMap.get(String(rawName)) || null;
}

async function findEffectiveBindings(bookId) {
  return characterVoiceBindingRepository.findByBookId(bookId);
}

// Compare the actual resolved voice between canonical and raw-name lookups.
async function voiceDiffersByProfile(bookId, profile) {
  const bindings = await findEffectiveBindings(bookId);
  const aliasMap = await buildAliasMap(bookId);
  const bindingMap = new Map(bindings.map((binding) => [binding.character_name, binding]));
  const nameCandidate = profile.canonical_name;
  const aliasNames = [...aliasMap.entries()]
    .filter(([, entry]) => Number(entry.profileId) === Number(profile.id))
    .map(([name]) => name);
  const namesToCheck = new Set([String(nameCandidate), ...aliasNames.map((n) => String(n))]);
  const results = [];
  for (const name of namesToCheck) {
    const rawBinding = bindingMap.get(name);
    const canonicalBinding = resolveBindingForName(profile.canonical_name, name, bindingMap);
    const rawResolved = rawBinding ? await resolveBinding(rawBinding, { requireActive: false }) : null;
    const canonicalResolved = canonicalBinding ? await resolveBinding(canonicalBinding, { requireActive: false }) : null;
    if (!canonicalResolved || !canonicalResolved.ready) continue;
    if (!rawResolved || !rawResolved.ready) {
      results.push({ alias_name: name, changes_voice: true });
      continue;
    }
    const sameVoice = String(rawResolved.provider) === String(canonicalResolved.provider)
      && String(rawResolved.providerVoiceId ?? '') === String(canonicalResolved.providerVoiceId ?? '')
      && String(rawResolved.voiceProfileId ?? '') === String(canonicalResolved.voiceProfileId ?? '');
    results.push({ alias_name: name, changes_voice: !sameVoice });
  }
  const voiceChangeAliases = results.filter((entry) => entry.changes_voice);
  return { voiceChangeAliases, checked: results.length };
}

// Read-only impact query. Given a profile, an existing rule id, or a
// proposed rule payload, returns dialogue ids + chapter ids whose spoken
// text or actually-resolved voice would change. Deletes nothing.
// scope: { profileId?, ruleId?, disableRuleId?, rule? }
async function computeImpact(bookId, scope = {}) {
  const dialogues = await dialogueRepository.findByBookId(bookId);
  const aliasMap = await buildAliasMap(bookId);
  const rules = await loadEnabledRules(bookId);

  let baseRules = rules;
  if (scope.disableRuleId) {
    baseRules = rules.filter((rule) => Number(rule.id) !== Number(scope.disableRuleId));
  }
  const proposedRules = [];
  if (scope.rule) {
    proposedRules.push(normalizeRuleText({ ...scope.rule, enabled: true }));
  } else if (scope.ruleId && !scope.disableRuleId) {
    const existing = await pronunciationRuleRepository.findById(scope.ruleId);
    if (existing && existing.rule_type === 'alias') {
      // The impact of a rule is "with the rule vs without it". For an
      // already-saved rule, exclude it from the baseline rules so the
      // comparison reflects the rule's own effect.
      baseRules = baseRules.filter((rule) => Number(rule.id) !== Number(existing.id));
      if (existing.enabled) proposedRules.push(normalizeRuleText(existing));
    }
  }
  const effectiveRules = (profileId) => {
    const additions = proposedRules.filter((rule) => {
      if (rule.profile_id != null) {
        return Number(rule.profile_id) === Number(profileId ?? 0);
      }
      return true;
    });
    return sortRules(baseRules.concat(additions));
  };

  let voiceDiffs = new Map();
  if (scope.profileId) {
    const profiles = await bookCharacterProfileRepository.findByBookId(bookId);
    const profile = profiles.find((candidate) => Number(candidate.id) === Number(scope.profileId));
    if (profile) {
      const diff = await voiceDiffersByProfile(bookId, profile);
      voiceDiffs = new Map(diff.voiceChangeAliases.map((item) => [item.alias_name, true]));
    }
  }

  const dialogueIds = [];
  const chapterIds = new Set();
  for (const dialogue of dialogues) {
    const rawName = String(dialogue.character_name ?? '');
    const entry = aliasMap.get(rawName);
    const profileId = entry?.profileId ?? null;
    const isProfileMember = Boolean(scope.profileId && entry
      && Number(entry.profileId) === Number(scope.profileId));
    const isVoiceImpactAlias = Boolean(scope.profileId && voiceDiffs.get(rawName));
    if (scope.profileId && !isProfileMember && !isVoiceImpactAlias) continue;

    const base = normalizeDialogueContent(dialogue.content);
    const baseline = applyAliasRules(base, baseRules, profileId).text;
    const prospective = applyAliasRules(base, effectiveRules(profileId), profileId).text;
    const spokenChanged = prospective !== baseline;
    const voiceChanged = isVoiceImpactAlias;

    if (spokenChanged || voiceChanged) {
      dialogueIds.push(dialogue.id);
      chapterIds.add(dialogue.chapter_id);
    }
  }

  return {
    dialogue_ids: dialogueIds,
    chapter_ids: [...chapterIds],
    dialogue_count: dialogueIds.length,
    chapter_count: chapterIds.size
  };
}

function sortRules(rules) {
  return rules.slice().sort((a, b) => (
    b.priority - a.priority
    || b.match_text.length - a.match_text.length
    || Number(a.id ?? 0) - Number(b.id ?? 0)
  ));
}

function disabledClone(rule) {
  if (!rule) return null;
  return { ...rule, enabled: false };
}

module.exports = {
  loadEnabledRules,
  loadEnabledPhonemeRules,
  applyAliasRules,
  applyAliasRule,
  buildAliasMap,
  resolveCanonicalName,
  resolveBindingForName,
  findEffectiveBindings,
  voiceDiffersByProfile,
  computeImpact,
  normalizeRuleText,
  sortRules
};
