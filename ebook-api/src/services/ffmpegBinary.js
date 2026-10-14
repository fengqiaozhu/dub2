const fs = require('fs');
const path = require('path');

const DEFAULT_FFMPEG_STATIC_LOADER = () => require('ffmpeg-static');

function isUsableFile(candidate) {
  if (!candidate || typeof candidate !== 'string') return false;
  try {
    if (!fs.existsSync(candidate)) return false;
    if (!fs.statSync(candidate).isFile()) return false;
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function findSystemFfmpeg(pathEnv = process.env.PATH, platform = process.platform) {
  const names = platform === 'win32'
    ? ['ffmpeg.exe', 'ffmpeg.cmd', 'ffmpeg.bat', 'ffmpeg']
    : ['ffmpeg'];
  for (const dir of String(pathEnv || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isUsableFile(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * 按固定顺序解析可用的 ffmpeg 二进制：
 * 1. FFMPEG_PATH 显式指定（设置后若不可用则直接报错，不做静默回退）；
 * 2. ffmpeg-static 包附带二进制（其 postinstall 下载会被 npm ci --ignore-scripts 跳过）；
 * 3. 系统 PATH 中的 ffmpeg。
 */
function resolveFfmpegPath({
  env = process.env,
  platform = process.platform,
  loadFfmpegStatic = DEFAULT_FFMPEG_STATIC_LOADER
} = {}) {
  if (env.FFMPEG_PATH) {
    if (isUsableFile(env.FFMPEG_PATH)) {
      return { path: env.FFMPEG_PATH, source: 'FFMPEG_PATH', error: null };
    }
    return {
      path: null,
      source: 'FFMPEG_PATH',
      error: `FFMPEG_PATH=${env.FFMPEG_PATH} 指向的文件不存在或不可执行`
    };
  }

  let staticError = null;
  try {
    const staticPath = loadFfmpegStatic();
    if (isUsableFile(staticPath)) {
      return { path: staticPath, source: 'ffmpeg-static', error: null };
    }
    staticError = `ffmpeg-static 解析到 ${staticPath}，但该文件不存在或不可执行（npm ci --ignore-scripts 会跳过其二进制下载）`;
  } catch (error) {
    staticError = `ffmpeg-static 加载失败：${error.message}`;
  }

  const systemPath = findSystemFfmpeg(env.PATH, platform);
  if (systemPath) {
    return { path: systemPath, source: 'system', error: null };
  }

  return {
    path: null,
    source: null,
    error: `${staticError}；系统 PATH 中也未找到 ffmpeg。请安装 ffmpeg、运行 npm rebuild ffmpeg-static（或改用保留 postinstall 的 npm ci），或设置 FFMPEG_PATH 指向可用的 ffmpeg。`
  };
}

module.exports = { resolveFfmpegPath, findSystemFfmpeg, isUsableFile };
