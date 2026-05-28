const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MARKER_PATTERN = /\bvf[:_](\d+)[:_]([a-f0-9]{8})\b/i;

function resolvePublicFilePath(relativeUrl) {
  if (!relativeUrl || String(relativeUrl).startsWith('http')) return null;
  const publicRoot = path.resolve(__dirname, '../../../public');
  const pathname = String(relativeUrl).split('?')[0].replace(/^\/+/, '');
  const filePath = path.resolve(publicRoot, pathname);
  if (!filePath.startsWith(`${publicRoot}${path.sep}`)) return null;
  return filePath;
}

function computeFileHash(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function parseMarker(value) {
  const match = MARKER_PATTERN.exec(String(value || ''));
  if (!match) return null;
  return {
    marker: `vf:${match[1]}:${match[2].toLowerCase()}`,
    voice_profile_id: Number(match[1]),
    sample_hash_prefix: match[2].toLowerCase()
  };
}

function collectMarkerTexts(value, texts = []) {
  if (!value) return texts;
  if (typeof value === 'string' || typeof value === 'number') {
    texts.push(String(value));
    return texts;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectMarkerTexts(item, texts));
    return texts;
  }
  if (typeof value === 'object') {
    [
      'marker',
      'description',
      'desc',
      'name',
      'title',
      'voiceName',
      'voice_name',
      'reference_id',
      'id',
      'metadata',
      'meta',
      'provider_meta',
      'raw'
    ].forEach((key) => collectMarkerTexts(value[key], texts));
  }
  return texts;
}

function extractMarker(value) {
  const texts = collectMarkerTexts(value);
  for (const text of texts) {
    const marker = parseMarker(text);
    if (marker) return marker;
  }
  return null;
}

function buildMarker(profile) {
  if (!profile?.id || !profile.sample_hash) return null;
  return `vf:${profile.id}:${String(profile.sample_hash).slice(0, 8).toLowerCase()}`;
}

function appendMarker(value, marker) {
  const text = String(value || '').trim();
  if (!marker) return text;
  if (parseMarker(text)) return text;
  return text ? `${text} ${marker}` : marker;
}

function isMarkerMatch(profile, markerInfo) {
  if (!profile || !markerInfo) return false;
  if (Number(profile.id) !== Number(markerInfo.voice_profile_id)) return false;
  if (!profile.sample_hash) return false;
  return String(profile.sample_hash).toLowerCase().startsWith(markerInfo.sample_hash_prefix);
}

function ensureProfileSampleHash(profile, voiceProfileRepository) {
  if (!profile) return null;
  if (profile.sample_hash) return profile.sample_hash;

  const filePath = resolvePublicFilePath(profile.sample_audio_url);
  if (!filePath || !fs.existsSync(filePath)) return null;

  const sampleHash = computeFileHash(filePath);
  voiceProfileRepository.updateSampleHash(profile.id, sampleHash);
  profile.sample_hash = sampleHash;
  return sampleHash;
}

module.exports = {
  appendMarker,
  buildMarker,
  computeFileHash,
  ensureProfileSampleHash,
  extractMarker,
  isMarkerMatch,
  parseMarker,
  resolvePublicFilePath
};
