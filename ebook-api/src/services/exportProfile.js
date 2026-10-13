// Export delivery profiles. `provisional-spoken-v1` is a reproducible
// technical loudness profile (-16 LUFS / -1.5 dBTP / LRA 11), NOT an
// audience calibration and NOT a platform compliance metric.
const DEFAULT_EXPORT_PROFILE_ID = 'mp3-192k';

const loudnessProfile = Object.freeze({
  id: 'provisional-spoken-v1',
  integrated_lufs: -16,
  true_peak_dbtp: -1.5,
  lra: 11
});

const EXPORT_PROFILES = {
  'mp3-192k': Object.freeze({
    id: 'mp3-192k',
    format: 'mp3',
    contentType: 'audio/mpeg',
    bitrateKbps: 192,
    sampleRateHz: 44100,
    channels: 2,
    fileExtension: '.mp3',
    loudnessProfile
  }),
  'wav-legacy': Object.freeze({
    id: 'wav-legacy',
    format: 'wav',
    contentType: 'audio/wav',
    // Identical to the historical concat output: pcm_s16le / 44100 Hz / 2ch.
    sampleRateHz: 44100,
    channels: 2,
    fileExtension: '.wav'
  })
};

function resolveExportProfile(env = process.env) {
  const requested = String(env.EXPORT_PROFILE == null ? '' : env.EXPORT_PROFILE).trim();
  if (requested === '') return EXPORT_PROFILES[DEFAULT_EXPORT_PROFILE_ID];
  const profile = EXPORT_PROFILES[requested];
  if (!profile) {
    const supported = Object.keys(EXPORT_PROFILES).join(', ');
    throw new Error(`不支持的 EXPORT_PROFILE："${requested}"，当前仅支持：${supported}`);
  }
  return profile;
}

module.exports = {
  DEFAULT_EXPORT_PROFILE_ID,
  EXPORT_PROFILES,
  loudnessProfile,
  resolveExportProfile
};
