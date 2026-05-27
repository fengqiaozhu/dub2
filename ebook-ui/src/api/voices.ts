import request from './request';

export type VoiceKind = 'system' | 'clone';

const DEFAULT_PAGE_LIMIT = 100;

const normalizeVoicePage = (res: any) => res?.data || res || {};

export async function fetchTtsVoicePage({
  provider,
  kind,
  limit = DEFAULT_PAGE_LIMIT,
  offset = 0,
}: {
  provider: string;
  kind: VoiceKind;
  limit?: number;
  offset?: number;
}) {
  const res: any = await request.get('/tts/voices', {
    params: { provider, kind, limit, offset },
  });
  const data = normalizeVoicePage(res);
  const voices = (data.voices || []).map((voice: any) => ({
    ...voice,
    provider: voice.provider || provider,
  }));
  const fallbackNextOffset = offset + voices.length;
  const nextOffset = typeof data.next_offset === 'number' ? data.next_offset : fallbackNextOffset;

  return {
    voices,
    hasMore: Boolean(data.has_more) && voices.length > 0 && nextOffset > offset,
    nextOffset,
  };
}

export async function fetchVoiceProfilePage({
  limit = DEFAULT_PAGE_LIMIT,
  offset = 0,
}: {
  limit?: number;
  offset?: number;
} = {}) {
  const res: any = await request.get('/tts/voice-profiles', {
    params: { limit, offset },
  });
  const profiles = res.data || [];
  const nextOffset = offset + profiles.length;

  return {
    profiles,
    hasMore: profiles.length >= limit && nextOffset > offset,
    nextOffset,
  };
}
