import axios from 'axios';

// Default short timeout for ordinary JSON calls (job status, settings, lists).
export const DEFAULT_TIMEOUT = 10000;
// Uploads (book files, covers, voice samples) can be large and slow on weak
// networks, so they get a longer budget than ordinary API calls.
export const UPLOAD_TIMEOUT = 120000;
// Synchronous, compute-heavy reads (e.g. planning a whole chapter) may exceed
// the default short budget on large chapters.
export const ANALYSIS_TIMEOUT = 60000;

export const ACCESS_TOKEN_STORAGE_KEY = 'dub_access_token';

export function getAccessToken(): string {
  try {
    const stored = localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
    if (stored) return stored;
  } catch (error) {
    console.warn('Cannot read stored access token:', error);
  }
  const envToken = import.meta.env.VITE_DUB_ACCESS_TOKEN as string | undefined;
  return envToken || '';
}

export function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function withAccessToken(url: string): string {
  const token = getAccessToken();
  if (!token) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}access_token=${encodeURIComponent(token)}`;
}

const request = axios.create({
  baseURL: '/api',
  timeout: DEFAULT_TIMEOUT,
});

request.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
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
 * 认证开启时附带 access_token，保证 <audio>/<video> 等无法设置请求头的播放器可用。
 */
export const toMediaUrl = (relativePath: string): string => {
  if (!relativePath) return '';
  if (relativePath.startsWith('http')) {
    if (relativePath.includes('/media/') && !relativePath.includes('access_token=')) {
      return withAccessToken(relativePath);
    }
    return relativePath;
  }
  const base = import.meta.env.VITE_MEDIA_BASE_URL
    || (import.meta.env.DEV ? 'http://localhost:13000' : window.location.origin);
  return withAccessToken(`${base}${relativePath}`);
};

export default request;
