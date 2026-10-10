import axios from 'axios';

// Default short timeout for ordinary JSON calls (job status, settings, lists).
export const DEFAULT_TIMEOUT = 10000;
// Uploads (book files, covers, voice samples) can be large and slow on weak
// networks, so they get a longer budget than ordinary API calls.
export const UPLOAD_TIMEOUT = 120000;
// Synchronous, compute-heavy reads (e.g. planning a whole chapter) may exceed
// the default short budget on large chapters.
export const ANALYSIS_TIMEOUT = 60000;

const request = axios.create({
  baseURL: '/api',
  timeout: DEFAULT_TIMEOUT,
});

request.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    console.error('API Error:', error);
    return Promise.reject(error);
  }
);

/**
 * 将后端返回的相对媒体路径（如 /media/xxx）转为完整 URL。
 * 开发环境下默认指向本项目 API 端口，生产环境下使用当前 origin。
 */
export const toMediaUrl = (relativePath: string): string => {
  if (!relativePath) return '';
  if (relativePath.startsWith('http')) return relativePath;
  const base = import.meta.env.VITE_MEDIA_BASE_URL
    || (import.meta.env.DEV ? 'http://localhost:13000' : window.location.origin);
  return `${base}${relativePath}`;
};

export default request;
