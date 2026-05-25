import { defineStore } from 'pinia';
import request from '@/api/request';

type LeftTab = 'chapters' | 'voices';

// 音色绑定缓存：character_name -> provider-aware voice reference
interface VoiceBinding {
  voice_id: string;
  provider: string;
  provider_voice_id?: string;
  voice_source: 'clone' | 'system';
  voice_profile_id?: number | null;
  tts_model?: string | null;
  binding_mode?: 'provider_voice' | 'voice_profile';
  display_name?: string;
  status?: string;
}

interface VoiceOption {
  id: string;
  name: string;
  provider: string;
  source: 'clone' | 'system';
  voice_profile_id?: number | null;
  status?: string;
}

interface BookCharacter {
  id: number;
  book_id: number;
  character_name: string;
  dialogue_count: number;
  chapter_count: number;
  voice_id: string | null;
  provider: string | null;
  provider_voice_id: string | null;
  voice_source: 'clone' | 'system' | null;
  voice_profile_id?: number | null;
  binding_mode?: 'provider_voice' | 'voice_profile' | null;
}

export interface WorkspaceTab {
  bookId: string;
  title: string;
  activeChapterId: number | null;
  activeLeftTab: LeftTab;
  highlightedRole: string | null;
  analysisJobId: string | null;
  dubbingJobId: string | null;
  exportJobId: string | null;
}

interface WorkspaceContext {
  bookDetails: any | null;
  chapterContent: any | null;
  bookCharacters: BookCharacter[];
  voiceBindings: Record<string, VoiceBinding>;
}

const STORAGE_KEY = 'voiceforge.workspace.tabs.v1';

const createTab = (bookId: string, title = '未命名书籍'): WorkspaceTab => ({
  bookId,
  title,
  activeChapterId: null,
  activeLeftTab: 'chapters',
  highlightedRole: null,
  analysisJobId: null,
  dubbingJobId: null,
  exportJobId: null,
});

const createContext = (): WorkspaceContext => ({
  bookDetails: null,
  chapterContent: null,
  bookCharacters: [],
  voiceBindings: {},
});

const normalizeBookId = (bookId: string | number) => String(bookId);

export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    tabs: [] as WorkspaceTab[],
    activeTabId: null as string | null,
    contexts: {} as Record<string, WorkspaceContext>,
    hydrated: false,

    // 统一管理的音色列表
    systemVoices: [] as any[],
    customVoices: [] as any[],
    voicesLoaded: false,
  }),

  getters: {
    activeTab(state): WorkspaceTab | null {
      return state.tabs.find((tab) => tab.bookId === state.activeTabId) || null;
    },

    activeContext(state): WorkspaceContext | null {
      if (!state.activeTabId) return null;
      return state.contexts[state.activeTabId] || null;
    },

    activeBookId(): string | null {
      return this.activeTab?.bookId || null;
    },

    activeChapterId(): number | null {
      return this.activeTab?.activeChapterId || null;
    },

    activeLeftTab(): LeftTab {
      return this.activeTab?.activeLeftTab || 'chapters';
    },

    activeBookDetails(): any | null {
      return this.activeContext?.bookDetails || null;
    },

    chapterContent(): any | null {
      return this.activeContext?.chapterContent || null;
    },

    bookCharacters(): BookCharacter[] {
      return this.activeContext?.bookCharacters || [];
    },

    voiceBindings(): Record<string, VoiceBinding> {
      return this.activeContext?.voiceBindings || {};
    },

    highlightedRole(): string | null {
      return this.activeTab?.highlightedRole || null;
    },

    analysisJobId(): string | null {
      return this.activeTab?.analysisJobId || null;
    },

    dubbingJobId(): string | null {
      return this.activeTab?.dubbingJobId || null;
    },

    exportJobId(): string | null {
      return this.activeTab?.exportJobId || null;
    },

    currentChapterRoles(): string[] {
      if (!this.activeChapterId) return [];
      const characters = this.chapterContent?.characters;
      const annotations = this.chapterContent?.annotations;
      const roles = new Set<string>();
      roles.add('旁白');
      if (Array.isArray(characters)) {
        characters.forEach((c: any) => {
          if (c.character_name) roles.add(c.character_name);
        });
      }
      if (Array.isArray(annotations)) {
        annotations.forEach((annotation: any) => {
          const role = annotation.character_name;
          if (role) roles.add(role);
        });
      }
      return Array.from(roles);
    },

    // 合并后的所有音色（扁平化，用于反查名称）
    allVoicesFlat(state): VoiceOption[] {
      return [
        ...state.systemVoices.map((v: any) => ({
          id: v.provider_voice_id || v.voiceId || v.id,
          name: v.name || v.voiceName,
          provider: v.provider || 'mosi',
          source: 'system' as const,
          voice_profile_id: v.voice_profile_id,
          status: v.status || 'ACTIVE',
        })),
        ...state.customVoices.map((v: any) => ({
          id: v.provider_voice_id || v.voice_id || v.id,
          name: v.name || v.voiceName || '未命名',
          provider: v.provider || 'mosi',
          source: 'clone' as const,
          voice_profile_id: v.voice_profile_id,
          status: v.status,
        })),
      ];
    },

    // 分组音色选项（用于 <select> optgroup 渲染）
    allVoicesGrouped(state): { label: string; options: { value: string; label: string; source: string }[] }[] {
      const groups = [];
      if (state.systemVoices.length > 0) {
        groups.push({
          label: '系统预置',
          options: state.systemVoices.map((v: any) => ({
            value: v.provider_voice_id || v.voiceId || v.id,
            label: v.name || v.voiceName,
            source: 'system',
          })),
        });
      }
      if (state.customVoices.length > 0) {
        groups.push({
          label: '我的克隆',
          options: state.customVoices.map((v: any) => ({
            value: v.provider_voice_id || v.voice_id || v.id,
            label: v.name || v.voiceName || '未命名',
            source: 'clone',
          })),
        });
      }
      return groups;
    },
  },

  actions: {
    ensureContext(bookId: string) {
      if (!this.contexts[bookId]) {
        this.contexts[bookId] = createContext();
      }
      return this.contexts[bookId];
    },

    hydrateTabs() {
      if (this.hydrated) return;
      this.hydrated = true;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed?.tabs)) return;

        const tabs: WorkspaceTab[] = parsed.tabs
          .filter((tab: any) => tab?.bookId)
          .map((tab: any) => ({
            ...createTab(normalizeBookId(tab.bookId), tab.title || '未命名书籍'),
            activeChapterId: typeof tab.activeChapterId === 'number' ? tab.activeChapterId : null,
            activeLeftTab: tab.activeLeftTab === 'voices' ? 'voices' : 'chapters',
            highlightedRole: typeof tab.highlightedRole === 'string' ? tab.highlightedRole : null,
            analysisJobId: typeof tab.analysisJobId === 'string' ? tab.analysisJobId : null,
            dubbingJobId: typeof tab.dubbingJobId === 'string' ? tab.dubbingJobId : null,
            exportJobId: typeof tab.exportJobId === 'string' ? tab.exportJobId : null,
          }));

        this.tabs = tabs;
        this.activeTabId = tabs.some((tab) => tab.bookId === parsed.activeTabId)
          ? parsed.activeTabId
          : (tabs[0]?.bookId || null);
        tabs.forEach((tab) => this.ensureContext(tab.bookId));
      } catch (error) {
        console.warn('Failed to hydrate workspace tabs:', error);
      }
    },

    persistTabs() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          activeTabId: this.activeTabId,
          tabs: this.tabs,
        }));
      } catch (error) {
        console.warn('Failed to persist workspace tabs:', error);
      }
    },

    setActiveBook(bookId: string) {
      this.activateTab(bookId);
    },

    activateTab(bookId: string | number) {
      const id = normalizeBookId(bookId);
      if (!this.tabs.some((tab) => tab.bookId === id)) return;
      this.activeTabId = id;
      this.ensureContext(id);
      this.persistTabs();
    },

    async openBookTab(bookId: string | number, fallbackTitle = '未命名书籍') {
      const id = normalizeBookId(bookId);
      let tab = this.tabs.find((item) => item.bookId === id);
      if (!tab) {
        tab = createTab(id, fallbackTitle);
        this.tabs.push(tab);
      }
      this.activeTabId = id;
      this.ensureContext(id);
      await this.loadBook(id);
      this.persistTabs();
    },

    closeTab(bookId: string | number) {
      const id = normalizeBookId(bookId);
      const index = this.tabs.findIndex((tab) => tab.bookId === id);
      if (index === -1) return;

      this.tabs.splice(index, 1);
      delete this.contexts[id];
      if (this.activeTabId === id) {
        const next = this.tabs[index] || this.tabs[index - 1] || null;
        this.activeTabId = next?.bookId || null;
      }
      this.persistTabs();
    },

    removeMissingTab(bookId: string | number) {
      this.closeTab(bookId);
    },

    setActiveLeftTab(tab: LeftTab) {
      if (!this.activeTab) return;
      this.activeTab.activeLeftTab = tab;
      this.persistTabs();
    },

    setHighlightedRole(role: string | null) {
      if (!this.activeTab) return;
      this.activeTab.highlightedRole = role;
      this.persistTabs();
    },

    setWorkspaceJob(kind: 'analysis' | 'dubbing' | 'export', jobId: string | null) {
      if (!this.activeTab) return;
      this.setTabWorkspaceJob(this.activeTab.bookId, kind, jobId);
    },

    setTabWorkspaceJob(bookId: string | number, kind: 'analysis' | 'dubbing' | 'export', jobId: string | null) {
      const tab = this.tabs.find((item) => item.bookId === normalizeBookId(bookId));
      if (!tab) return;
      if (kind === 'analysis') tab.analysisJobId = jobId;
      if (kind === 'dubbing') tab.dubbingJobId = jobId;
      if (kind === 'export') tab.exportJobId = jobId;
      this.persistTabs();
    },

    async loadBook(bookId: string | number) {
      const id = normalizeBookId(bookId);
      const context = this.ensureContext(id);
      const res = await request.get(`/books/${id}`);
      context.bookDetails = res.data;

      const tab = this.tabs.find((item) => item.bookId === id);
      if (tab) {
        tab.title = res.data?.title || tab.title || '未命名书籍';
        const chapters = Array.isArray(res.data?.chapters) ? res.data.chapters : [];
        const restoredChapterExists = tab.activeChapterId
          ? chapters.some((chapter: any) => Number(chapter.id) === Number(tab.activeChapterId))
          : false;

        if (restoredChapterExists) {
          await this.setActiveChapter(tab.activeChapterId, id);
        } else if (chapters.length > 0) {
          await this.setActiveChapter(chapters[0].id, id);
        } else {
          await this.setActiveChapter(null, id);
        }
      }

      await Promise.all([
        this.fetchVoiceBindings(id),
        this.fetchBookCharacters(id),
      ]);
      this.persistTabs();
      return context.bookDetails;
    },

    async refreshActiveBook() {
      if (!this.activeBookId) return;
      await this.loadBook(this.activeBookId);
    },

    async setActiveChapter(chapterId: number | null, bookId?: string | number) {
      const id = bookId ? normalizeBookId(bookId) : this.activeBookId;
      if (!id) return;

      const tab = this.tabs.find((item) => item.bookId === id);
      const context = this.ensureContext(id);
      if (tab) {
        tab.activeChapterId = chapterId;
        tab.highlightedRole = null;
      }
      if (!chapterId) {
        context.chapterContent = null;
        this.persistTabs();
        return;
      }

      try {
        const res = await request.get(`/chapters/${chapterId}`);
        context.chapterContent = res.data;
      } catch (err) {
        console.error('Failed to fetch chapter:', err);
        context.chapterContent = null;
      } finally {
        this.persistTabs();
      }
    },

    // 统一加载音色列表（系统 + 克隆），避免多组件重复请求
    async fetchVoices() {
      if (this.voicesLoaded) return;
      try {
        const [sysRes, customRes] = await Promise.all([
          request.get('/tts/voices', { params: { provider: 'mosi', kind: 'system' } }),
          request.get('/tts/voices', { params: { provider: 'mosi', kind: 'clone' } }),
        ]);
        if (sysRes.data?.voices) this.systemVoices = sysRes.data.voices;
        if (customRes.data?.voices) this.customVoices = customRes.data.voices;
        this.voicesLoaded = true;
      } catch (err) {
        console.error('Failed to fetch voices:', err);
      }
    },

    // 加载全书角色汇总，在切换书籍时调用
    async fetchBookCharacters(bookId?: string | number) {
      const id = bookId ? normalizeBookId(bookId) : this.activeBookId;
      if (!id) return;
      const context = this.ensureContext(id);
      try {
        const res = await request.get(`/books/${id}/characters`);
        const chars = res.data || [];

        // 确保“旁白”始终存在且在最前
        const narratorIdx = chars.findIndex((c: any) => c.character_name === '旁白');
        if (narratorIdx === -1) {
          chars.unshift({
            id: -1,
            book_id: parseInt(id, 10),
            character_name: '旁白',
            dialogue_count: 0,
            chapter_count: 0,
            voice_id: null,
            provider: null,
            provider_voice_id: null,
            voice_source: null
          });
        } else {
          const narrator = chars.splice(narratorIdx, 1)[0];
          chars.unshift(narrator);
        }

        context.bookCharacters = chars;
      } catch (err) {
        console.error('Failed to fetch book characters:', err);
        context.bookCharacters = [];
      }
    },

    // 加载全书音色绑定，在切换书籍时调用
    async fetchVoiceBindings(bookId?: string | number) {
      const id = bookId ? normalizeBookId(bookId) : this.activeBookId;
      if (!id) return;
      const context = this.ensureContext(id);
      try {
        const res = await request.get(`/books/${id}/voice-bindings`);
        const bindings: Record<string, VoiceBinding> = {};
        (res.data || []).forEach((b: any) => {
          if (b.character_name) {
            bindings[b.character_name] = {
              voice_id: b.provider_voice_id || b.voice_id,
              provider: b.provider || 'mosi',
              provider_voice_id: b.provider_voice_id || b.voice_id,
              voice_source: b.voice_source,
              voice_profile_id: b.voice_profile_id,
              tts_model: b.tts_model,
              binding_mode: b.voice_profile_id ? 'voice_profile' : 'provider_voice',
            };
          }
        });
        context.voiceBindings = bindings;
      } catch (err) {
        console.error('Failed to fetch voice bindings:', err);
      }
    },

    // 绑定或更新音色（调用 PUT API，并同步更新本地 voiceBindings 和 bookCharacters）
    async saveVoiceBinding(characterName: string, binding: {
      voice_id?: string;
      provider?: string;
      provider_voice_id?: string | null;
      voice_source?: 'clone' | 'system';
      voice_profile_id?: number | null;
      tts_model?: string | null;
      intent_defaults?: any;
      display_name?: string;
      status?: string;
    }) {
      if (!this.activeBookId) return;
      const id = this.activeBookId;
      const context = this.ensureContext(id);
      const provider = binding.provider || 'mosi';
      const voiceId = binding.provider_voice_id || binding.voice_id || (binding.voice_profile_id ? `profile:${binding.voice_profile_id}` : '');
      try {
        await request.put(
          `/books/${id}/voice-bindings/${encodeURIComponent(characterName)}`,
          {
            voice_id: voiceId,
            provider,
            provider_voice_id: binding.provider_voice_id || null,
            voice_source: binding.voice_source || 'clone',
            voice_profile_id: binding.voice_profile_id || null,
            tts_model: binding.tts_model || null,
            intent_defaults: binding.intent_defaults
          }
        );
        // 更新本地绑定缓存
        context.voiceBindings[characterName] = {
          voice_id: voiceId,
          provider,
          provider_voice_id: binding.provider_voice_id || voiceId || undefined,
          voice_source: binding.voice_source || 'clone',
          voice_profile_id: binding.voice_profile_id || null,
          tts_model: binding.tts_model || null,
          binding_mode: binding.voice_profile_id ? 'voice_profile' : 'provider_voice',
          display_name: binding.display_name,
          status: binding.status,
        };
        // 同步 bookCharacters 中的绑定状态
        const char = context.bookCharacters.find((c) => c.character_name === characterName);
        if (char) {
          char.voice_id = voiceId;
          char.provider = provider;
          char.provider_voice_id = binding.provider_voice_id || voiceId || null;
          char.voice_source = binding.voice_source || 'clone';
          char.voice_profile_id = binding.voice_profile_id || null;
          char.binding_mode = binding.voice_profile_id ? 'voice_profile' : 'provider_voice';
        }
      } catch (err) {
        console.error('Failed to save voice binding:', err);
        throw err;
      }
    },

    // 解绑音色（调用 DELETE API，并清除本地缓存）
    async deleteVoiceBinding(characterName: string) {
      if (!this.activeBookId) return;
      const id = this.activeBookId;
      const context = this.ensureContext(id);
      try {
        await request.delete(
          `/books/${id}/voice-bindings/${encodeURIComponent(characterName)}`
        );
        delete context.voiceBindings[characterName];
        // 同步 bookCharacters 中的绑定状态
        const char = context.bookCharacters.find((c) => c.character_name === characterName);
        if (char) {
          char.voice_id = null;
          char.provider = null;
          char.provider_voice_id = null;
          char.voice_source = null;
        }
      } catch (err) {
        console.error('Failed to delete voice binding:', err);
        throw err;
      }
    },

    getVoiceForRole(characterName: string): string | null {
      const binding = this.voiceBindings[characterName];
      if (!binding) return null;
      return binding.voice_id || binding.provider_voice_id || (binding.voice_profile_id ? `profile:${binding.voice_profile_id}` : null);
    },

    getVoiceNameForRole(characterName: string): string | null {
      const voiceId = this.voiceBindings[characterName]?.voice_id;
      const binding = this.voiceBindings[characterName];
      const provider = this.voiceBindings[characterName]?.provider || 'mosi';
      if (binding?.display_name) return binding.display_name;
      if (!voiceId) return null;
      const found = this.allVoicesFlat.find((v) => v.id === voiceId && v.provider === provider);
      return found?.name || voiceId;
    },

    getVoiceSourceForRole(characterName: string): string | null {
      return this.voiceBindings[characterName]?.voice_source || null;
    },

    getVoiceBindingForRole(characterName: string): VoiceBinding | null {
      return this.voiceBindings[characterName] || null;
    },
  },
});
