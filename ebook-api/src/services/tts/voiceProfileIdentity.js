const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { randomUUID } = require('crypto');
const storageService = require('../storage/storageService');
const { keyFromMediaUrl } = require('../storage/keyBuilder');

const MARKER_PATTERN = /\bvf[:_](\d+)[:_]([a-f0-9]{8})\b/i;

function resolvePublicFilePath(relativeUrl) {
  if (!relativeUrl || String(relativeUrl).startsWith('http')) return null;
  const publicRoot = path.resolve(__dirname, '../../../public');
  const pathname = String(relativeUrl).split('?')[0].replace(/^\/+/, '');
  const filePath = path.resolve(publicRoot, pathname);
  if (!filePath.startsWith(`${publicRoot}${path.sep}`)) return null;
  return filePath;
}

function computeFileHash(filePathOrBuffer) {
  const hash = crypto.createHash('sha256');
  hash.update(Buffer.isBuffer(filePathOrBuffer) ? filePathOrBuffer : fs.readFileSync(filePathOrBuffer));
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

async function ensureProfileSampleHash(profile, voiceProfileRepository) {
  if (!profile) return null;
  if (profile.sample_hash) return profile.sample_hash;

  let buffer = null;
  const key = keyFromMediaUrl(profile.sample_audio_url);
  if (key) {
    buffer = await storageService.getObjectBuffer(key);
  } else {
    const filePath = resolvePublicFilePath(profile.sample_audio_url);
    if (!filePath || !fs.existsSync(filePath)) return null;
    buffer = fs.readFileSync(filePath);
  }

  const sampleHash = computeFileHash(buffer);
  await voiceProfileRepository.updateSampleHash(profile.id, sampleHash);
  profile.sample_hash = sampleHash;
  return sampleHash;
}

async function materializeMediaUrlToTempFile(mediaUrl, filename = 'sample.wav') {
  const key = keyFromMediaUrl(mediaUrl);
  if (!key) {
    const localPath = resolvePublicFilePath(mediaUrl);
    if (localPath && fs.existsSync(localPath)) return { filePath: localPath, cleanup: false };
    return null;
  }
  const buffer = await storageService.getObjectBuffer(key);
  const ext = path.extname(filename) || path.extname(key) || '.wav';
  const filePath = path.join(os.tmpdir(), `ebook-media-${randomUUID()}${ext}`);
  fs.writeFileSync(filePath, buffer);
  return { filePath, cleanup: true };
}

module.exports = {
  appendMarker,
  buildMarker,
  computeFileHash,
  ensureProfileSampleHash,
  extractMarker,
  isMarkerMatch,
  materializeMediaUrlToTempFile,
  parseMarker,
  resolvePublicFilePath
};
