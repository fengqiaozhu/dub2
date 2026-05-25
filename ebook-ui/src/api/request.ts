import axios from 'axios';

const request = axios.create({
  baseURL: '/api',
  timeout: 10000,
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
 * 将后端返回的相对路径（如 /audio/xxx.wav）转为完整 URL。
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
