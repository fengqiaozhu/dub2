const { spawn } = require('child_process');

// Shared ffmpeg helpers for chapter export. The product code never calls
// ffprobe; probing is done by decoding with `ffmpeg -i` as required.

function runFfmpeg(ffmpegPath, args, { timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args);
    let stderr = '';
    let stdout = '';
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`ffmpeg 超时（${timeoutMs}ms）`));
    }, timeoutMs);

    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

// Probe one downloaded segment: `ffmpeg -i <file>` decode pass aborting on
// the first decode error. Returns silently, or throws with the segment
// index when the segment cannot be decoded.
async function probeSegment(ffmpegPath, filePath, index, runFfmpegFn = runFfmpeg) {
  try {
    await runFfmpegFn(ffmpegPath, [
      '-nostdin',
      '-hide_banner',
      '-v', 'error',
      '-xerror',
      '-i', filePath,
      '-f', 'null',
      '-'
    ], { timeoutMs: 120000 });
  } catch (error) {
    const detail = String(error.message || '').split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300);
    throw new Error(`第 ${index + 1} 段音频探测失败（导出中止，未写入导出记录）：${detail || '无法解码'}`);
  }
}

// Confirms the resolved ffmpeg can deliver the MP3 profile: loudnorm filter
// and libmp3lame encoder must both exist, or the export fails loudly.
async function verifyMp3Capabilities(ffmpegPath, runFfmpegFn = runFfmpeg) {
  const missing = [];
  const { stdout: filters } = await runFfmpegFn(ffmpegPath, ['-hide_banner', '-filters'], { timeoutMs: 30000 });
  if (!/\bloudnorm\b/.test(filters)) missing.push('loudnorm 滤镜');
  const { stdout: encoders } = await runFfmpegFn(ffmpegPath, ['-hide_banner', '-encoders'], { timeoutMs: 30000 });
  if (!/\blibmp3lame\b/.test(encoders)) missing.push('libmp3lame MP3 编码器');
  if (missing.length > 0) {
    throw new Error(`解析到的 ffmpeg（${ffmpegPath}）缺少 ${missing.join('、')}，无法按 ${'mp3-192k'} 交付档导出 MP3。导出失败，未写入导出记录。`);
  }
  return { ok: true };
}

// First loudnorm pass: measure the merged WAV. Parses the trailing JSON
// block (print_format=json) from ffmpeg's stderr.
async function measureLoudness(ffmpegPath, wavPath, loudnessProfile, runFfmpegFn = runFfmpeg) {
  const targetI = loudnessProfile.integrated_lufs;
  const targetTP = loudnessProfile.true_peak_dbtp;
  const targetLRA = loudnessProfile.lra;
  const { stderr } = await runFfmpegFn(ffmpegPath, [
    '-nostdin',
    '-hide_banner',
    '-nostats',
    '-i', wavPath,
    '-af', `loudnorm=I=${targetI}:TP=${targetTP}:LRA=${targetLRA}:print_format=json`,
    '-f', 'null',
    '-'
  ], { timeoutMs: 10 * 60 * 1000 });

  const matches = stderr.match(/\{[^{}]*input_i[\s\S]*?\}/g);
  if (!matches || matches.length === 0) {
    throw new Error('loudnorm 测量失败：ffmpeg 未输出测量结果 JSON，无法做响度归一。导出失败，未写入导出记录。');
  }
  let parsed = null;
  try {
    parsed = JSON.parse(matches[matches.length - 1]);
  } catch {
    throw new Error('loudnorm 测量失败：无法解析测量结果 JSON。导出失败，未写入导出记录。');
  }
  const measurement = {
    input_i: parsed.input_i,
    input_tp: parsed.input_tp,
    input_lra: parsed.input_lra,
    input_thresh: parsed.input_thresh,
    target_offset: parsed.target_offset
  };
  for (const key of ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset']) {
    const value = Number(measurement[key]);
    if (!Number.isFinite(value)) {
      throw new Error(`loudnorm 测量失败：${key} 非有限值（${measurement[key]}），章节音频可能为空或静音。导出失败，未写入导出记录。`);
    }
  }
  return measurement;
}

// Second loudnorm pass (linear) + libmp3lame CBR encode + ID3 metadata,
// combined into a single ffmpeg run.
function buildMp3EncodeArgs({
  wavPath,
  outputPath,
  measurement,
  profile,
  metadata,
  coverPath = null
}) {
  const loud = profile.loudnessProfile;
  const loudnormArg = [
    `I=${loud.integrated_lufs}`,
    `TP=${loud.true_peak_dbtp}`,
    `LRA=${loud.lra}`,
    `measured_I=${measurement.input_i}`,
    `measured_TP=${measurement.input_tp}`,
    `measured_LRA=${measurement.input_lra}`,
    `measured_thresh=${measurement.input_thresh}`,
    `offset=${measurement.target_offset}`,
    'linear=true',
    'print_format=none'
  ].join(':');

  const args = [
    '-y',
    '-nostdin',
    '-hide_banner',
    '-i', wavPath
  ];
  if (coverPath) {
    args.push('-i', coverPath);
    args.push('-map', '0:a', '-map', '1:v', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic');
  }
  args.push(
    '-af', `loudnorm=${loudnormArg}`,
    '-c:a', 'libmp3lame',
    '-b:a', `${profile.bitrateKbps}k`,
    '-ar', String(profile.sampleRateHz),
    '-ac', String(profile.channels),
    '-id3v2_version', '3',
    '-metadata', `title=${metadata.title}`
  );
  if (metadata.artist) args.push('-metadata', `artist=${metadata.artist}`);
  if (metadata.album) args.push('-metadata', `album=${metadata.album}`);
  if (metadata.date) args.push('-metadata', `date=${metadata.date}`);
  args.push(outputPath);
  return args;
}

// Legacy WAV output: identical to the historical single concat command.
function buildWavConcatArgs(listPath, outputPath) {
  return [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-acodec', 'pcm_s16le',
    '-ar', '44100',
    '-ac', '2',
    outputPath
  ];
}

// Temporary intermediate concat is always PCM WAV, for both profiles.
function buildIntermediateConcatArgs(listPath, outputPath) {
  return [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-acodec', 'pcm_s16le',
    '-ar', '44100',
    '-ac', '2',
    outputPath
  ];
}

module.exports = {
  runFfmpeg,
  probeSegment,
  verifyMp3Capabilities,
  measureLoudness,
  buildMp3EncodeArgs,
  buildWavConcatArgs,
  buildIntermediateConcatArgs
};
