<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useJobStore } from '@/stores/jobStore';
import ChapterList from '@/components/workspace/ChapterList.vue';
import DialogueView from '@/components/workspace/DialogueView.vue';
import BookVoiceBinding from '@/components/workspace/BookVoiceBinding.vue';
import RoleVoiceMapping from '@/components/workspace/RoleVoiceMapping.vue';
import AudioTrack from '@/components/common/AudioTrack.vue';
import request, { toMediaUrl } from '@/api/request';

const route = useRoute();
const router = useRouter();
const workspaceStore = useWorkspaceStore();
const jobStore = useJobStore();

const dubbingJob = computed(() => {
  if (!workspaceStore.dubbingJobId) return null;
  return jobStore.getJob(workspaceStore.dubbingJobId);
});

const exportJob = computed(() => {
  if (!workspaceStore.exportJobId) return null;
  return jobStore.getJob(workspaceStore.exportJobId);
});

const isDubbing = computed(() => !!workspaceStore.dubbingJobId && (!dubbingJob.value || ['PENDING', 'RUNNING'].includes(dubbingJob.value.status)));
const isExporting = computed(() => !!workspaceStore.exportJobId && (!exportJob.value || ['PENDING', 'RUNNING'].includes(exportJob.value.status)));
const bookDetails = computed(() => workspaceStore.activeBookDetails);
const activeLeftTab = computed(() => workspaceStore.activeLeftTab);
const activeChapterAudioIndex = ref(-1);
const modalState = ref({
  visible: false,
  type: 'info' as 'info' | 'confirm' | 'warning',
  title: '',
  message: '',
  details: [] as string[],
  confirmText: '确认',
  cancelText: '取消',
  showCancel: false,
});
let modalResolver: ((value: boolean) => void) | null = null;

const chapterContent = computed(() => workspaceStore.chapterContent);
const isChapterAnalyzed = computed(() => {
  const characters = chapterContent.value?.characters;
  return Array.isArray(characters) && characters.some((character: any) => character.character_name !== '旁白');
});
const dubbingStats = computed(() => chapterContent.value?.dubbing_stats || { total: 0, completed: 0, pending: 0 });
const mergedAudioExport = computed(() => chapterContent.value?.merged_audio_export || null);
const mergedAudioUrl = computed(() => {
  if (!mergedAudioExport.value?.audio_url) return '';
  return toMediaUrl(mergedAudioExport.value.audio_url);
});
const hasCurrentMergedAudio = computed(() => !!mergedAudioExport.value?.audio_url && mergedAudioExport.value?.is_current !== false);

const dubbingAction = computed(() => {
  const stats = dubbingStats.value;
  if (stats.total > 0 && stats.completed >= stats.total) {
    return {
      mode: 'redub',
      label: '重新配音',
      subText: `已完成 ${stats.completed}/${stats.total}`
    };
  }
  if (stats.completed > 0) {
    return {
      mode: 'continue',
      label: '继续配音',
      subText: `剩余 ${stats.pending} 句`
    };
  }
  return {
    mode: 'start',
    label: '开始AI配音',
    subText: stats.total > 0 ? `待配音 ${stats.total} 句` : '生成旁白与对白音频'
  };
});

const mergeActionLabel = computed(() => {
  if (isExporting.value) return `拼接中 ${exportJob.value?.progress || 0}%`;
  if (mergedAudioExport.value) return '重新拼接';
  return '拼接本章';
});

const openBooksLabel = computed(() => `${workspaceStore.tabs.length} 本书工作中`);

const showModal = (options: Partial<typeof modalState.value>) => new Promise<boolean>((resolve) => {
  modalResolver = resolve;
  modalState.value = {
    visible: true,
    type: options.type || 'info',
    title: options.title || '',
    message: options.message || '',
    details: options.details || [],
    confirmText: options.confirmText || '确认',
    cancelText: options.cancelText || '取消',
    showCancel: options.showCancel || false,
  };
});

const closeModal = (value: boolean) => {
  modalState.value.visible = false;
  if (modalResolver) {
    modalResolver(value);
    modalResolver = null;
  }
};

const showWarning = (title: string, message: string, details: string[] = []) => {
  return showModal({ type: 'warning', title, message, details, confirmText: '知道了' });
};

const showConfirm = (title: string, message: string, details: string[] = [], confirmText = '继续') => {
  return showModal({
    type: 'confirm',
    title,
    message,
    details,
    confirmText,
    cancelText: '取消',
    showCancel: true,
  });
};

const getDubbingRoles = () => {
  const roles = new Set<string>();
  roles.add('旁白');
  const characters = chapterContent.value?.characters;
  if (Array.isArray(characters)) {
    characters.forEach((character: any) => {
      if (character.character_name && character.character_name !== '旁白') {
        roles.add(character.character_name);
      }
    });
  }
  return Array.from(roles);
};

const getMissingVoiceRoles = () => {
  return getDubbingRoles().filter((role) => !workspaceStore.getVoiceForRole(role));
};

const fetchDubbingPreview = async () => {
  if (!workspaceStore.activeChapterId) return null;
  const res = await request.get(`/chapters/${workspaceStore.activeChapterId}/dubbing-preview`);
  return res.data;
};

const formatDubbingPlanDetails = (preview: any) => {
  const details: string[] = [];
  if (Array.isArray(preview?.provider_summary) && preview.provider_summary.length > 0) {
    details.push('配音计划：');
    preview.provider_summary.forEach((item: any) => {
      details.push(`${item.provider}：${item.dialogue_count} 句，${item.role_count} 个角色（${(item.roles || []).join('、')}）`);
    });
  }

  if (Array.isArray(preview?.warnings) && preview.warnings.length > 0) {
    details.push('提示：');
    preview.warnings.forEach((warning: any) => {
      details.push(warning.message || String(warning));
    });
  }

  const blockedRoles = preview?.roles?.filter((role: any) => !role.ready) || [];
  if (blockedRoles.length > 0) {
    details.push('不可配音：');
    blockedRoles.forEach((role: any) => {
      details.push(`${role.character_name}：${role.message || role.status}`);
    });
  }

  return details;
};

const pollDubbingJob = (jobId: string, bookId: string, chapterId: number) => {
  jobStore.startPolling(
    jobId,
    async () => {
      workspaceStore.setTabWorkspaceJob(bookId, 'dubbing', null);
      await workspaceStore.setActiveChapter(chapterId, bookId);
    },
    (error: any) => {
      workspaceStore.setTabWorkspaceJob(bookId, 'dubbing', null);
      console.error('Dubbing failed', error);
      showWarning('批量配音失败', '请检查音色绑定和后端任务日志。');
    }
  );
};

const pollAnalysisJob = (jobId: string, bookId: string, chapterId: number) => {
  jobStore.startPolling(
    jobId,
    async () => {
      workspaceStore.setTabWorkspaceJob(bookId, 'analysis', null);
      await workspaceStore.setActiveChapter(chapterId, bookId);
      await workspaceStore.fetchBookCharacters(bookId);
    },
    (error: any) => {
      workspaceStore.setTabWorkspaceJob(bookId, 'analysis', null);
      console.error('Analysis failed', error);
    }
  );
};

const pollExportJob = (jobId: string, bookId: string, chapterId: number) => {
  jobStore.startPolling(
    jobId,
    async () => {
      workspaceStore.setTabWorkspaceJob(bookId, 'export', null);
      await workspaceStore.setActiveChapter(chapterId, bookId);
    },
    (error: any) => {
      workspaceStore.setTabWorkspaceJob(bookId, 'export', null);
      console.error('Merged export failed', error);
      showWarning('拼接导出失败', '请确认本章已有可用音频。');
    }
  );
};

const resumeActiveTabJobs = () => {
  const bookId = workspaceStore.activeBookId;
  const chapterId = workspaceStore.activeChapterId;
  if (!bookId || !chapterId) return;
  if (workspaceStore.analysisJobId) pollAnalysisJob(workspaceStore.analysisJobId, bookId, chapterId);
  if (workspaceStore.dubbingJobId) pollDubbingJob(workspaceStore.dubbingJobId, bookId, chapterId);
  if (workspaceStore.exportJobId) pollExportJob(workspaceStore.exportJobId, bookId, chapterId);
};

const openRouteBook = async (id: string) => {
  try {
    await workspaceStore.openBookTab(id);
    resumeActiveTabJobs();
  } catch (err) {
    console.error('Failed to load book:', err);
    workspaceStore.removeMissingTab(id);
    if (workspaceStore.activeBookId) {
      router.replace(`/workspace/${workspaceStore.activeBookId}`);
    } else {
      router.replace('/workspace');
    }
  }
};

const refreshBook = async () => {
  await workspaceStore.refreshActiveBook();
};

const activateWorkspaceTab = async (bookId: string) => {
  workspaceStore.activateTab(bookId);
  router.replace(`/workspace/${bookId}`);
  try {
    await workspaceStore.loadBook(bookId);
    resumeActiveTabJobs();
  } catch (error) {
    console.error('Failed to activate workspace tab:', error);
    workspaceStore.removeMissingTab(bookId);
  }
};

const closeWorkspaceTab = (bookId: string) => {
  const wasActive = workspaceStore.activeBookId === bookId;
  workspaceStore.closeTab(bookId);
  if (wasActive) {
    router.replace(workspaceStore.activeBookId ? `/workspace/${workspaceStore.activeBookId}` : '/workspace');
  }
};

const setLeftTab = (tab: 'chapters' | 'voices') => {
  workspaceStore.setActiveLeftTab(tab);
};

onMounted(async () => {
  workspaceStore.hydrateTabs();
  const routeBookId = route.params.bookId as string | undefined;
  if (routeBookId) {
    await openRouteBook(routeBookId);
    return;
  }
  if (workspaceStore.activeBookId) {
    try {
      await workspaceStore.loadBook(workspaceStore.activeBookId);
      resumeActiveTabJobs();
    } catch (error) {
      console.error('Failed to restore workspace tab:', error);
      workspaceStore.removeMissingTab(workspaceStore.activeBookId);
    }
  }
});

watch(() => route.params.bookId, async (value) => {
  if (!workspaceStore.hydrated) return;
  if (value) {
    await openRouteBook(value as string);
  }
});

const startDubbing = async () => {
  if (!workspaceStore.activeChapterId) return;
  if (!isChapterAnalyzed.value) {
    const ok = await showConfirm(
      '当前章节尚未 AI 解析',
      '继续配音会把全文按“旁白”处理，并使用旁白音色生成音频。',
      ['如需多角色配音，请先点击“开始 AI 解析”。'],
      '使用旁白配音'
    );
    if (!ok) return;
  }

  let preview: any = null;
  try {
    preview = await fetchDubbingPreview();
  } catch (error) {
    console.warn('Failed to fetch dubbing preview, falling back to local binding check:', error);
  }

  const blockingRoles = preview?.roles?.filter((role: any) => !role.ready) || [];
  const missingRoles = preview ? blockingRoles.map((role: any) => `${role.character_name}：${role.message || role.status}`) : getMissingVoiceRoles();
  if (missingRoles.length > 0) {
    workspaceStore.setActiveLeftTab('voices');
    await showWarning(
      preview ? '存在不可配音的角色' : '存在未指定音色的角色',
      preview ? '请处理以下音色绑定问题，然后再开始配音。' : '请先为以下角色绑定音色，然后再开始配音。',
      preview ? formatDubbingPlanDetails(preview) : missingRoles
    );
    return;
  }

  const force = dubbingAction.value.mode === 'redub';
  if (force) {
    const ok = await showConfirm(
      '确认重新配音',
      '重新配音会清理本章节已有音频和已拼接音轨，并重新生成所有对白与旁白音频。',
      [],
      '重新配音'
    );
    if (!ok) return;
  }

  if (preview?.provider_summary?.length > 1 || preview?.warnings?.length > 0) {
    const ok = await showConfirm(
      preview?.provider_summary?.length > 1 ? '确认多平台配音计划' : '确认配音计划',
      preview?.provider_summary?.length > 1
        ? '本章将按角色绑定混合调用多个 TTS 平台生成音频。'
        : '本章配音计划包含需要注意的提示。',
      formatDubbingPlanDetails(preview),
      '开始配音'
    );
    if (!ok) return;
  }

  const activeBookId = workspaceStore.activeBookId;
  const activeChapterId = workspaceStore.activeChapterId;
  if (!activeBookId || !activeChapterId) return;
  try {
    const res = await request.post(`/chapters/${activeChapterId}/batch-dub`, { force });
    const jobId = res.data?.jobId || res.data?.data?.jobId;
    if (jobId) {
      workspaceStore.setTabWorkspaceJob(activeBookId, 'dubbing', jobId);
      pollDubbingJob(jobId, activeBookId, activeChapterId);
    }
  } catch (err) {
    console.error('Failed to start dubbing:', err);
    showWarning('批量配音启动失败', '请求未能成功提交，请稍后重试。');
  }
};

const exportChapterAudio = () => {
  if (!workspaceStore.activeChapterId) return;
  downloadChapterAudioArchive();
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const readErrorMessage = async (response: Response) => {
  try {
    const payload = await response.json();
    return payload.error || payload.message || '导出失败';
  } catch {
    return '导出失败';
  }
};

const downloadChapterAudioArchive = async () => {
  if (!workspaceStore.activeChapterId) return;
  try {
    const response = await fetch(`/api/chapters/${workspaceStore.activeChapterId}/export-audio`);
    if (!response.ok) {
      showWarning('单句导出失败', await readErrorMessage(response));
      return;
    }
    const blob = await response.blob();
    downloadBlob(blob, `chapter-${workspaceStore.activeChapterId}-audio.zip`);
  } catch (error) {
    console.error('Failed to export chapter audio archive:', error);
    showWarning('单句导出失败', '下载请求异常，请稍后重试。');
  }
};

const downloadStorySourcePackage = async () => {
  if (!workspaceStore.activeChapterId) return;
  try {
    const response = await fetch(`/api/chapters/${workspaceStore.activeChapterId}/story-source-package`);
    if (!response.ok) {
      showWarning('故事源包导出失败', await readErrorMessage(response));
      return;
    }
    const blob = await response.blob();
    downloadBlob(blob, `chapter-${workspaceStore.activeChapterId}-story-source-package.json`);
  } catch (error) {
    console.error('Failed to export story source package:', error);
    showWarning('故事源包导出失败', '下载请求异常，请稍后重试。');
  }
};

const downloadMergedChapterAudio = async () => {
  if (!mergedAudioUrl.value) return;
  try {
    const response = await fetch(mergedAudioUrl.value);
    if (!response.ok) {
      showWarning('章节音轨下载失败', '音频文件暂时无法访问。');
      return;
    }
    const blob = await response.blob();
    downloadBlob(blob, `chapter-${workspaceStore.activeChapterId || 'audio'}.wav`);
  } catch (error) {
    console.error('Failed to download merged chapter audio:', error);
    showWarning('章节音轨下载失败', '下载请求异常，请稍后重试。');
  }
};

const exportMergedChapterAudio = async () => {
  if (!workspaceStore.activeChapterId) return;
  const activeBookId = workspaceStore.activeBookId;
  const activeChapterId = workspaceStore.activeChapterId;
  if (!activeBookId || !activeChapterId) return;
  try {
    const res = await request.post(`/chapters/${activeChapterId}/export-audio/merged`);
    const jobId = res.data?.jobId || res.data?.data?.jobId;
    if (jobId) {
      workspaceStore.setTabWorkspaceJob(activeBookId, 'export', jobId);
      pollExportJob(jobId, activeBookId, activeChapterId);
    }
  } catch (err) {
    console.error('Failed to start merged export:', err);
    showWarning('拼接导出启动失败', '请求未能成功提交，请稍后重试。');
  }
};
</script>

<template>
  <div class="workspace-container">
    <div class="workspace-tabs">
      <div class="tabs-meta">
        <span class="mono-text">WORKSPACE</span>
        <span class="tabs-count mono-text">{{ openBooksLabel }}</span>
      </div>
      <div class="book-tabs" v-if="workspaceStore.tabs.length > 0">
        <div
          v-for="tab in workspaceStore.tabs"
          :key="tab.bookId"
          class="book-tab"
          :class="{ active: tab.bookId === workspaceStore.activeBookId }"
          role="button"
          tabindex="0"
          @click="activateWorkspaceTab(tab.bookId)"
          @keydown.enter.prevent="activateWorkspaceTab(tab.bookId)"
          @keydown.space.prevent="activateWorkspaceTab(tab.bookId)"
        >
          <span class="book-tab-title">{{ tab.title }}</span>
          <span class="book-tab-state" v-if="tab.dubbingJobId || tab.exportJobId">运行中</span>
          <span class="book-tab-chapter mono-text" v-else-if="tab.activeChapterId">CH {{ tab.activeChapterId }}</span>
          <button
            class="book-tab-close"
            type="button"
            title="关闭工作标签"
            @click.stop="closeWorkspaceTab(tab.bookId)"
          >
            ×
          </button>
        </div>
      </div>
    </div>

    <div class="workspace-empty" v-if="!workspaceStore.activeBookId">
      <div class="empty-mark">⌁</div>
      <h2>工作台还没有打开书籍</h2>
      <p>从书籍管理选择一本书开始工作。之后这里会保留多个书籍标签，方便你在不同项目之间切换。</p>
      <router-link class="btn btn-primary" to="/books">选择书籍</router-link>
    </div>

    <template v-else>
    <!-- Main 2-column layout -->
    <div class="workspace-grid">

      <!-- Left: Tab Panel (Chapters / Voices) -->
      <div class="panel column-left">
        <!-- Tab 切换栏 -->
        <div class="tab-bar">
          <button
            class="tab-btn mono-text"
            :class="{ active: activeLeftTab === 'chapters' }"
            @click="setLeftTab('chapters')"
          >
            CHAPTERS
          </button>
          <button
            class="tab-btn mono-text"
            :class="{ active: activeLeftTab === 'voices' }"
            @click="setLeftTab('voices')"
          >
            VOICES
            <span class="tab-count" v-if="workspaceStore.bookCharacters.length > 0">
              {{ workspaceStore.bookCharacters.length }}
            </span>
          </button>
        </div>

        <!-- Tab 内容区 -->
        <div class="tab-content">
          <ChapterList
            v-show="activeLeftTab === 'chapters'"
            :chapters="bookDetails?.chapters || []"
            :book-title="bookDetails?.title"
            @refresh="refreshBook"
          />
          <BookVoiceBinding v-show="activeLeftTab === 'voices'" />
        </div>
      </div>

      <!-- Middle: Dialogue Flow -->
      <div class="panel column-middle">
        <DialogueView />
      </div>

      <!-- Right: Chapter Role Quick Binding -->
      <div class="panel column-right">
        <RoleVoiceMapping />
      </div>

    </div>

    <!-- Bottom Action Bar -->
    <div class="bottom-action-bar">
      <div class="export-settings">
        <button class="btn btn-outline" :disabled="!workspaceStore.activeChapterId" @click="downloadStorySourcePackage">导出故事源包</button>
        <button class="btn btn-outline" :disabled="!workspaceStore.activeChapterId" @click="exportChapterAudio">导出本章单句</button>
        <button class="btn btn-outline" :disabled="isExporting || !workspaceStore.activeChapterId" @click="exportMergedChapterAudio">
          {{ mergeActionLabel }}
        </button>
      </div>

      <div class="chapter-audio-panel">
        <div class="chapter-audio-meta">
          <span class="audio-title">章节音轨</span>
          <span class="audio-state mono-text" v-if="isExporting">正在拼接 {{ exportJob?.progress || 0 }}%</span>
          <span class="audio-state mono-text success" v-else-if="hasCurrentMergedAudio">已生成</span>
          <span class="audio-state mono-text warning" v-else-if="mergedAudioExport">音轨已过期</span>
          <span class="audio-state mono-text" v-else>尚未拼接</span>
        </div>
        <AudioTrack
          v-if="mergedAudioUrl"
          :src="mergedAudioUrl"
          :active="activeChapterAudioIndex === 0"
          filename="chapter-audio.wav"
          class="chapter-audio-track"
          @activate="activeChapterAudioIndex = 0"
          @deactivate="activeChapterAudioIndex = -1"
        />
        <button
          v-if="mergedAudioUrl"
          class="download-track-btn"
          type="button"
          title="下载拼接后的章节音轨"
          @click="downloadMergedChapterAudio"
        >
          下载音轨
        </button>
        <div class="empty-audio-track mono-text" v-else>
          拼接后可在这里播放和下载
        </div>
      </div>

      <div class="start-action">
        <button class="btn btn-primary btn-large" @click="startDubbing" :disabled="isDubbing || !workspaceStore.activeChapterId">
          <template v-if="isDubbing">
            <span class="spinner-small"></span>
            配音中... {{ dubbingJob?.progress || 0 }}%
          </template>
          <template v-else>
            {{ dubbingAction.label }}¸¸¸
            <span class="sub-text mono-text">{{ dubbingAction.subText }}</span>
          </template>
        </button>
      </div>
    </div>

    <div class="modal-backdrop" v-if="modalState.visible" @click.self="modalState.showCancel ? closeModal(false) : null">
      <div class="workspace-dialog" :class="`dialog-${modalState.type}`">
        <div class="dialog-header">
          <div>
            <h3>{{ modalState.title }}</h3>
            <span class="mono-text">{{ modalState.type === 'warning' ? 'ACTION REQUIRED' : 'WORKSPACE' }}</span>
          </div>
          <button class="dialog-close" type="button" @click="closeModal(false)" v-if="modalState.showCancel">×</button>
        </div>
        <p class="dialog-message">{{ modalState.message }}</p>
        <ul class="dialog-details" v-if="modalState.details.length > 0">
          <li v-for="item in modalState.details" :key="item">{{ item }}</li>
        </ul>
        <div class="dialog-actions">
          <button class="btn btn-outline" type="button" v-if="modalState.showCancel" @click="closeModal(false)">
            {{ modalState.cancelText }}
          </button>
          <button class="btn btn-primary dialog-primary" type="button" @click="closeModal(true)">
            {{ modalState.confirmText }}
          </button>
        </div>
      </div>
    </div>
    </template>
  </div>
</template>

<style scoped>
.workspace-container {
  display: flex;
  flex-direction: column;
  height:100%;
  gap: var(--space-3);
  overflow: hidden;
}

.workspace-tabs {
  min-height: 48px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-2);
  background-color: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.tabs-meta {
  width: 140px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 11px;
}

.tabs-count {
  color: var(--text-muted);
  font-size: 10px;
}

.book-tabs {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: var(--space-1);
  overflow-x: auto;
  padding: 6px 0;
}

.book-tab {
  height: 34px;
  max-width: 240px;
  min-width: 150px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background-color: var(--bg-input);
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  user-select: none;
}

.book-tab:hover {
  border-color: var(--border-focus);
  color: var(--text-primary);
}

.book-tab:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}

.book-tab.active {
  border-color: rgba(0, 212, 170, 0.55);
  color: var(--text-primary);
  background-color: rgba(0, 212, 170, 0.08);
}

.book-tab-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  text-align: left;
}

.book-tab-state,
.book-tab-chapter {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--accent-cyan);
}

.book-tab-close {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
  line-height: 1;
  padding: 0;
}

.book-tab-close:hover {
  background-color: rgba(239, 68, 68, 0.14);
  color: #ef4444;
}

.workspace-empty {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-secondary);
  text-align: center;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  background-color: var(--bg-panel);
  padding: var(--space-4);
}

.workspace-empty .empty-mark {
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid var(--border-focus);
  color: var(--accent-cyan);
  font-size: 28px;
}

.workspace-empty h2 {
  margin: 0;
  font-size: 20px;
  color: var(--text-primary);
}

.workspace-empty p {
  max-width: 460px;
  margin: 0 0 var(--space-2);
  color: var(--text-muted);
  line-height: 1.6;
}

.workspace-grid {
  display: grid;
  grid-template-columns: 280px 1fr 240px;
  gap: var(--space-3);
  flex: 1;
  min-height: 0;
}

.panel {
  background-color: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.column-right {
  min-height: 0;
}

/* Tab 切换栏 */
.tab-bar {
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-color);
  background-color: var(--bg-panel);
}

.tab-btn {
  flex: 1;
  height: 40px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  margin-bottom: -1px;
}

.tab-btn:hover {
  color: var(--text-secondary);
}

.tab-btn.active {
  color: var(--accent-cyan);
  border-bottom-color: var(--accent-cyan);
}

.tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 14px;
  padding: 0 4px;
  background-color: rgba(0, 212, 170, 0.15);
  color: var(--accent-cyan);
  border-radius: 7px;
  font-size: 9px;
}

/* Tab 内容区撑满剩余高度 */
.tab-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* v-show 的子组件需要能撑满 */
.tab-content > * {
  flex: 1;
  min-height: 0;
}

/* Bottom Action Bar */
.bottom-action-bar {
  min-height: 76px;
  background-color: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-3);
  gap: var(--space-3);
}

.export-settings {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-shrink: 0;
}

.btn {
  padding: 6px 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;
  cursor: pointer;
  border: none;
}

.btn-outline {
  background-color: transparent;
  border: 1px solid var(--border-focus);
  color: var(--text-secondary);
}

.btn-outline:hover {
  border-color: var(--text-secondary);
  color: var(--text-primary);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.chapter-audio-panel {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 260px;
}

.chapter-audio-meta {
  width: 88px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.audio-title {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 600;
}

.audio-state {
  font-size: 10px;
  color: var(--text-muted);
}

.audio-state.success {
  color: var(--accent-cyan);
}

.audio-state.warning {
  color: var(--warning-amber);
}

.chapter-audio-track {
  flex: 1;
  min-width: 0;
}

.download-track-btn {
  flex-shrink: 0;
  border: 1px solid var(--border-focus);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  padding: 6px 10px;
  font-size: 12px;
}

.download-track-btn:hover {
  border-color: var(--accent-cyan);
  color: var(--accent-cyan);
}

.empty-audio-track {
  flex: 1;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  background-color: var(--bg-input);
  padding: 10px 12px;
  font-size: 11px;
  text-align: center;
}

.start-action {
  display: flex;
  flex-shrink: 0;
}

.btn-primary.btn-large {
  background: linear-gradient(135deg, #00d4aa 0%, #00a383 100%);
  color: var(--bg-base);
  padding: 8px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  box-shadow: 0 0 12px rgba(0, 212, 170, 0.4);
}

.btn-primary.btn-large:hover {
  box-shadow: 0 0 16px rgba(0, 212, 170, 0.6);
  transform: translateY(-1px);
}

.sub-text {
  font-size: 9px;
  opacity: 0.8;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-3);
  background-color: rgba(0, 0, 0, 0.62);
}

.workspace-dialog {
  width: min(440px, 100%);
  max-height: calc(100vh - 64px);
  overflow: auto;
  background-color: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  box-shadow: var(--shadow-md);
}

.workspace-dialog.dialog-warning {
  border-color: rgba(245, 158, 11, 0.45);
}

.dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.dialog-header h3 {
  font-size: 17px;
  margin-bottom: 2px;
}

.dialog-header span {
  color: var(--text-muted);
  font-size: 10px;
}

.dialog-close {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}

.dialog-message {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.dialog-details {
  margin-top: var(--space-2);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.dialog-details li {
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: var(--radius-sm);
  background-color: rgba(245, 158, 11, 0.08);
  color: var(--warning-amber);
  padding: 3px 8px;
  font-size: 12px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-1);
  margin-top: var(--space-3);
}

.dialog-primary {
  background-color: var(--accent-cyan);
  color: var(--bg-base);
}
</style>
