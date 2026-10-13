export const ACCESS_TOKEN_STORAGE_KEY = 'dub_access_token';

export type TokenStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export const accessAuthState = {
  unauthorized: false
};

function defaultStorage(): TokenStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function envAccessToken(env: { VITE_DUB_ACCESS_TOKEN?: string } | undefined): string {
  return String(env?.VITE_DUB_ACCESS_TOKEN || '').trim();
}

export function readAccessToken(
  storage: TokenStorage | null = defaultStorage(),
  envToken = ''
): string {
  if (storage) {
    try {
      const stored = storage.getItem(ACCESS_TOKEN_STORAGE_KEY);
      if (stored) return stored;
    } catch (error) {
      console.warn('Cannot read stored access token:', error);
    }
  }
  return String(envToken || '').trim();
}

export function writeAccessToken(
  token: string,
  storage: TokenStorage | null = defaultStorage()
): string {
  const trimmed = String(token || '').trim();
  if (!storage) return trimmed;
  try {
    if (!trimmed) storage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    else storage.setItem(ACCESS_TOKEN_STORAGE_KEY, trimmed);
  } catch (error) {
    console.warn('Cannot persist access token:', error);
  }
  return trimmed;
}

export function clearAccessToken(storage: TokenStorage | null = defaultStorage()): void {
  writeAccessToken('', storage);
}
