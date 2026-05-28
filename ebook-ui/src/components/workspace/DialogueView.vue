<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useJobStore } from '@/stores/jobStore';
import request, { toMediaUrl } from '@/api/request';
import AudioTrack from '@/components/common/AudioTrack.vue';
import AudioEditorModal from '@/components/common/AudioEditorModal.vue';

type FilterMode = 'all' | 'unknown' | 'narration' | 'dialogue';
type AudioFilterMode = 'all' | 'problem' | 'missing' | 'stale' | 'failed' | 'current' | 'skipped';
type AudioStatus = 'current' | 'missing' | 'stale' | 'failed' | 'skipped';

interface Paragraph {
  text: string;
  char_start: number;
  char_end: number;
  paragraph_index: number;
  skip_audio?: boolean;
}

interface Annotation {
  id: number;
  content: string;
  character_name: string;
  emotion?: string;
  char_start: number;
  char_end: number;
  annotation_status?: 'ai' | 'manual' | 'confirmed';
  audio_url?: string;
  source?: string;
}

interface AudioItem {
  id: number | string;
  dialogue_id?: number | null;
  type: 'dialogue' | 'narration';
  character_name: string;
  content: string;
  char_start: number;
  char_end: number;
  audio_url?: string | null;
  audio_duration?: number | null;
  audio_status: AudioStatus;
  skip_audio?: boolean;
  source_hash?: string;
  error?: string | null;
}

interface TextChunk {
  key: string;
  text: string;
  char_start: number;
  char_end: number;
  annotation?: Annotation;
  draft?: boolean;
}

interface RangeItem {
  char_start: number;
  char_end: number;
  annotation?: Annotation;
  draft: boolean;
}

interface SentenceSegment {
  key: string;
  char_start: number;
  char_end: number;
  chunks: TextChunk[];
  audioItem: AudioItem | null;
  hasAnnotation: boolean;
}

interface SelectionDraft {
  char_start: number;
  char_end: number;
  text: string;
  character_name: string;
  emotion: string;
  confirmed: boolean;
  editId?: number | null;
}

const workspaceStore = useWorkspaceStore();
const jobStore = useJobStore();

const contentRoot = ref<HTMLElement | null>(null);
const activeFilter = ref<FilterMode>('all');
const activeAudioFilter = ref<AudioFilterMode>('all');
const editMode = ref(false);
const selectionDraft = ref<SelectionDraft | null>(null);
const activeAnnotationId = ref<number | null>(null);
const rerangeAnnotationId = ref<number | null>(null);
const editorPosition = ref({ top: 0, left: 0 });
const rolePickerOpen = ref(false);
const bookRolesExpanded = ref(false);
const saving = ref(false);
const errorMessage = ref('');
const isAnalysisSubmitting = ref(false);
const activeAudioId = ref<number | string | null>(null);
const redubbingItemId = ref<number | string | null>(null);
const skipUpdatingKey = ref<string | null>(null);
const confirmReparseVisible = ref(false);
const audioEditorItem = ref<AudioItem | null>(null);
const audioEditorSaving = ref(false);
const emotionEditor = ref<{ annotation: Annotation; value: string } | null>(null);
const emotionEditorPosition = ref({ top: 0, left: 0 });
const emotionSavingId = ref<number | null>(null);
const commonEmotionOptions = ['低声', '平静', '急促', '大喊', '冷笑', '哽咽', '颤抖', '讽刺', '犹豫', '恐惧', '愤怒', '温柔'];

const emotionEditorStyle = computed(() => ({
  top: `${emotionEditorPosition.value.top}px`,
  left: `${emotionEditorPosition.value.left}px`
}));

// ── 全章顺序播放 ──────────────────────────────────────────
const seqAudio = ref<HTMLAudioElement | null>(null);
const seqPlaying = ref(false);
const seqActiveItemId = ref<number | string | null>(null);
const seqCurrentIndex = ref(-1);
const seqCurrentTime = ref(0);
const seqDuration = ref(0);
const seqTotalDuration = ref(0);
const seqTotalElapsed = ref(0);
const seqDurationCache = ref<Record<string, number>>({});
const seqDurationLoading = ref<Record<string, boolean>>({});

const playlist = computed<AudioItem[]>(() =>
  audioItems.value
    .filter(item => isPlayableAudioItem(item))
    .sort((a, b) => a.char_start - b.char_start)
);

const hasPlayableAudio = computed(() => playlist.value.length > 0);

const seqProgressLabel = computed(() => {
  if (seqCurrentIndex.value < 0) return `${playlist.value.length} 句可播放`;
  return `${seqCurrentIndex.value + 1} / ${playlist.value.length}`;
});

const seqTimeLabel = computed(() => {
  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) return '0:00';
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };
  if (seqCurrentIndex.value < 0) return '';
  const elapsed = seqTotalElapsed.value + seqCurrentTime.value;
  const total = seqTotalDuration.value;
  return total > 0 ? `${fmt(elapsed)} / ${fmt(total)}` : fmt(elapsed);
});

const seqOverallProgress = computed(() => {
  if (!seqTotalDuration.value || seqCurrentIndex.value < 0) return 0;
  return ((seqTotalElapsed.value + seqCurrentTime.value) / seqTotalDuration.value) * 100;
});

function seqItemKey(item: AudioItem) {
  return `${item.id}:${item.audio_url || ''}`;
}

function seqKnownDuration(item: AudioItem | undefined) {
  if (!item) return 0;
  const cached = seqDurationCache.value[seqItemKey(item)];
  return cached || item.audio_duration || 0;
}

function seqEstimatedDuration() {
  const known = playlist.value
    .map((item) => seqKnownDuration(item))
    .filter((duration) => duration > 0);
  if (known.length > 0) {
    return known.reduce((sum, duration) => sum + duration, 0) / known.length;
  }
  return seqDuration.value || 3;
}

function seqDurationForTimeline(item: AudioItem | undefined) {
  return seqKnownDuration(item) || seqEstimatedDuration();
}

function recomputeSeqTimeline(index = seqCurrentIndex.value) {
  let totalDur = 0;
  let elapsed = 0;
  for (let i = 0; i < playlist.value.length; i++) {
    const dur = seqDurationForTimeline(playlist.value[i]);
    totalDur += dur;
    if (i < index) elapsed += dur;
  }
  seqTotalDuration.value = totalDur;
  seqTotalElapsed.value = elapsed;
}

function loadSeqDuration(item: AudioItem) {
  if (!item.audio_url) return;
  const key = seqItemKey(item);
  if (seqDurationCache.value[key] || seqDurationLoading.value[key]) return;

  seqDurationLoading.value = { ...seqDurationLoading.value, [key]: true };
  const probe = new Audio();
  probe.preload = 'metadata';
  probe.addEventListener('loadedmetadata', () => {
    const duration = Number.isFinite(probe.duration) ? probe.duration : 0;
    if (duration > 0) {
      seqDurationCache.value = { ...seqDurationCache.value, [key]: duration };
      recomputeSeqTimeline(seqCurrentIndex.value);
    }
    const { [key]: _done, ...rest } = seqDurationLoading.value;
    seqDurationLoading.value = rest;
  }, { once: true });
  probe.addEventListener('error', () => {
    const { [key]: _done, ...rest } = seqDurationLoading.value;
    seqDurationLoading.value = rest;
  }, { once: true });
  probe.src = toMediaUrl(item.audio_url);
}

function primeSeqDurations() {
  playlist.value.forEach(loadSeqDuration);
}

function seqPlayPause() {
  if (seqPlaying.value) {
    seqAudio.value?.pause();
    seqPlaying.value = false;
    return;
  }
  primeSeqDurations();
  if (seqCurrentIndex.value < 0 || seqCurrentIndex.value >= playlist.value.length) {
    seqStartFrom(0);
  } else {
    seqAudio.value?.play().catch(() => { seqPlaying.value = false; });
    seqPlaying.value = true;
  }
}

function seqStartFrom(index: number) {
  if (index < 0 || index >= playlist.value.length) {
    seqStop();
    return;
  }
  primeSeqDurations();
  seqCurrentIndex.value = index;
  recomputeSeqTimeline(index);
  seqCurrentTime.value = 0;

  const item = playlist.value[index];
  seqDuration.value = seqKnownDuration(item);
  seqActiveItemId.value = item.id;

  if (!seqAudio.value) {
    seqAudio.value = new Audio();
    seqAudio.value.addEventListener('ended', seqOnEnded);
    seqAudio.value.addEventListener('timeupdate', seqOnTimeUpdate);
    seqAudio.value.addEventListener('loadedmetadata', seqOnLoadedMeta);
  }
  seqAudio.value.src = toMediaUrl(item.audio_url!);
  seqAudio.value.currentTime = 0;
  seqAudio.value.play().catch(() => { seqPlaying.value = false; });
  seqPlaying.value = true;

  // 自动滚动到当前播放的句段
  nextTick(() => {
    const el = document.querySelector('.sentence-segment.seq-active');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function seqOnEnded() {
  const next = seqCurrentIndex.value + 1;
  if (next < playlist.value.length) {
    seqStartFrom(next);
  } else {
    seqStop();
  }
}

function seqOnTimeUpdate() {
  seqCurrentTime.value = seqAudio.value?.currentTime ?? 0;
}

function seqOnLoadedMeta() {
  const duration = seqAudio.value?.duration ?? 0;
  seqDuration.value = Number.isFinite(duration) ? duration : 0;
  const item = playlist.value[seqCurrentIndex.value];
  if (item && seqDuration.value > 0) {
    seqDurationCache.value = {
      ...seqDurationCache.value,
      [seqItemKey(item)]: seqDuration.value
    };
    recomputeSeqTimeline(seqCurrentIndex.value);
  }
}

function seqStop() {
  seqAudio.value?.pause();
  seqPlaying.value = false;
  seqCurrentIndex.value = -1;
  seqCurrentTime.value = 0;
  seqTotalElapsed.value = 0;
  seqDuration.value = 0;
  seqActiveItemId.value = null;
}

// 单个 AudioTrack 播放时暂停全章播放
function onTrackActivate(itemId: number | string) {
  if (seqPlaying.value) seqStop();
  activeAudioId.value = itemId;
}

// 切换章节时停止播放并退出编辑模式
watch(() => workspaceStore.activeChapterId, () => {
  seqStop();
  workspaceStore.setHighlightedRole(null);
  closeEmotionEditor();
  if (editMode.value) {
    editMode.value = false;
    closeEditor();
  }
});

onBeforeUnmount(() => {
  seqAudio.value?.pause();
  seqAudio.value?.removeEventListener('ended', seqOnEnded);
  seqAudio.value?.removeEventListener('timeupdate', seqOnTimeUpdate);
  seqAudio.value?.removeEventListener('loadedmetadata', seqOnLoadedMeta);
  seqAudio.value = null;
});

const currentJob = computed(() => {
  if (!workspaceStore.analysisJobId) return null;
  return jobStore.getJob(workspaceStore.analysisJobId);
});

const isAnalyzing = computed(() => (
  isAnalysisSubmitting.value ||
  !!workspaceStore.analysisJobId && (!currentJob.value || ['PENDING', 'RUNNING'].includes(currentJob.value.status))
));

const chapterContent = computed(() => workspaceStore.chapterContent);
const paragraphs = computed<Paragraph[]>(() => {
  const value = chapterContent.value?.paragraphs;
  return Array.isArray(value) ? value : [];
});
const annotations = computed<Annotation[]>(() => {
  const value = chapterContent.value?.annotations;
  return Array.isArray(value)
    ? value.filter((item: Annotation) => item.char_start >= 0 && item.char_end > item.char_start)
    : [];
});
const unlocatedDialogues = computed(() => {
  const value = chapterContent.value?.unlocated_dialogues;
  return Array.isArray(value) ? value : [];
});
const audioItems = computed<AudioItem[]>(() => {
  const value = chapterContent.value?.audio_items;
  return Array.isArray(value) ? value : [];
});

const dialogueCount = computed(() => annotations.value.length);
const confirmedCount = computed(() => annotations.value.filter(item => item.annotation_status === 'confirmed').length);
const uniqueRoles = computed(() => Array.from(new Set(annotations.value.map(item => item.character_name).filter(Boolean))));
const audioStats = computed(() => ({
  all: audioItems.value.length,
  current: audioItems.value.filter(item => item.audio_status === 'current').length,
  missing: audioItems.value.filter(item => item.audio_status === 'missing').length,
  stale: audioItems.value.filter(item => item.audio_status === 'stale').length,
  failed: audioItems.value.filter(item => item.audio_status === 'failed').length,
  skipped: audioItems.value.filter(item => item.audio_status === 'skipped').length,
  problem: audioItems.value.filter(item => item.audio_status !== 'current' && item.audio_status !== 'skipped').length
}));
const aiParseButtonLabel = computed(() => annotations.value.length > 0 ? '重新 AI 解析' : 'AI 解析');

const bookRoleOptions = computed(() => {
  const roles = new Set<string>();
  for (const character of workspaceStore.bookCharacters || []) {
    if (character.character_name && character.character_name !== '旁白') roles.add(character.character_name);
  }
  return Array.from(roles);
});

const primaryRoleOptions = computed(() => {
  const roles = new Set<string>();
  for (const role of uniqueRoles.value) roles.add(role);
  for (const dialogue of unlocatedDialogues.value) {
    if (dialogue.character_name && dialogue.character_name !== '旁白') roles.add(dialogue.character_name);
  }
  return Array.from(roles);
});

const editorStyle = computed(() => ({
  top: `${editorPosition.value.top}px`,
  left: `${editorPosition.value.left}px`,
}));

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

function chunksForRange(rangeStart: number, rangeEnd: number, paragraphIndex: number): TextChunk[] {
  const draft = selectionDraft.value;
  const relevant: RangeItem[] = annotations.value
    .filter(item => !draft?.editId || item.id !== draft.editId)
    .filter(item => !draft || !overlaps(draft.char_start, draft.char_end, item.char_start, item.char_end))
    .filter(item => item.char_start < rangeEnd && rangeStart < item.char_end)
    .map(item => ({ char_start: item.char_start, char_end: item.char_end, annotation: item, draft: false }));
  if (draft && draft.char_start < rangeEnd && rangeStart < draft.char_end) {
    relevant.push({ char_start: draft.char_start, char_end: draft.char_end, draft: true });
  }
  relevant.sort((a, b) => a.char_start - b.char_start);
  const chunks: TextChunk[] = [];
  let cursor = rangeStart;

  for (const item of relevant) {
    const start = Math.max(item.char_start, rangeStart);
    const end = Math.min(item.char_end, rangeEnd);
    if (start > cursor) {
      chunks.push({
        key: `plain-${paragraphIndex}-${cursor}`,
        text: chapterContent.value.content.slice(cursor, start),
        char_start: cursor,
        char_end: start
      });
    }
    chunks.push({
      key: item.draft ? `draft-${start}` : `ann-${item.annotation!.id}-${start}`,
      text: chapterContent.value.content.slice(start, end),
      char_start: start,
      char_end: end,
      annotation: item.annotation,
      draft: item.draft
    });
    cursor = end;
  }

  if (cursor < rangeEnd) {
    chunks.push({
      key: `plain-${paragraphIndex}-${cursor}`,
      text: chapterContent.value.content.slice(cursor, rangeEnd),
      char_start: cursor,
      char_end: rangeEnd
    });
  }

  return chunks;
}

function paragraphChunks(paragraph: Paragraph): TextChunk[] {
  return chunksForRange(paragraph.char_start, paragraph.char_end, paragraph.paragraph_index);
}

function buildParagraphSegments(paragraph: Paragraph): SentenceSegment[] {
  const items = audioItemsForRange(paragraph.char_start, paragraph.char_end)
    .sort((a, b) => a.char_start - b.char_start);

  if (items.length === 0) {
    const chunks = chunksForRange(paragraph.char_start, paragraph.char_end, paragraph.paragraph_index);
    return [{
      key: `seg-${paragraph.paragraph_index}-0`,
      char_start: paragraph.char_start,
      char_end: paragraph.char_end,
      chunks,
      audioItem: null,
      hasAnnotation: chunks.some(c => c.annotation)
    }];
  }

  const segments: SentenceSegment[] = [];
  let cursor = paragraph.char_start;
  let segIndex = 0;

  for (const item of items) {
    if (item.char_start > cursor) {
      const gapChunks = chunksForRange(cursor, item.char_start, paragraph.paragraph_index);
      if (gapChunks.some(c => c.text.trim())) {
        segments.push({
          key: `seg-${paragraph.paragraph_index}-gap-${segIndex}`,
          char_start: cursor,
          char_end: item.char_start,
          chunks: gapChunks,
          audioItem: null,
          hasAnnotation: gapChunks.some(c => c.annotation)
        });
        segIndex++;
      }
    }

    const segStart = Math.max(item.char_start, paragraph.char_start);
    const segEnd = Math.min(item.char_end, paragraph.char_end);
    const segChunks = chunksForRange(segStart, segEnd, paragraph.paragraph_index);
    segments.push({
      key: `seg-${paragraph.paragraph_index}-${segIndex}`,
      char_start: segStart,
      char_end: segEnd,
      chunks: segChunks,
      audioItem: item,
      hasAnnotation: segChunks.some(c => c.annotation)
    });
    segIndex++;
    cursor = Math.max(cursor, item.char_end);
  }

  if (cursor < paragraph.char_end) {
    const tailChunks = chunksForRange(cursor, paragraph.char_end, paragraph.paragraph_index);
    if (tailChunks.some(c => c.text.trim())) {
      segments.push({
        key: `seg-${paragraph.paragraph_index}-tail-${segIndex}`,
        char_start: cursor,
        char_end: paragraph.char_end,
        chunks: tailChunks,
        audioItem: null,
        hasAnnotation: tailChunks.some(c => c.annotation)
      });
    }
  }

  return segments;
}

const paragraphViews = computed(() => {
  return paragraphs.value.map(paragraph => {
    const segments = buildParagraphSegments(paragraph);
    const hasDialogue = segments.some(s => s.hasAnnotation);
    const hasPlain = segments.some(s => s.chunks.some(c => !c.annotation && c.text.trim()));
    return { ...paragraph, segments, hasDialogue, hasPlain };
  }).filter(paragraph => {
    const matchesTextFilter = (() => {
      if (activeFilter.value === 'all') return true;
      if (activeFilter.value === 'dialogue') return paragraph.hasDialogue;
      if (activeFilter.value === 'unknown') return !paragraph.hasDialogue;
      return paragraph.hasPlain;
    })();
    if (!matchesTextFilter) return false;
    if (activeAudioFilter.value === 'all') return true;
    const items = paragraph.segments.map(s => s.audioItem).filter(Boolean) as AudioItem[];
    if (activeAudioFilter.value === 'problem') return items.some(item => item.audio_status !== 'current' && item.audio_status !== 'skipped');
    if (activeAudioFilter.value === 'skipped') return paragraph.skip_audio || items.some(item => item.audio_status === 'skipped');
    return items.some(item => item.audio_status === activeAudioFilter.value);
  });
});

const unknownCount = computed(() => paragraphViewsFor('unknown').length);
const narrationCount = computed(() => paragraphViewsFor('narration').length);

function paragraphViewsFor(mode: FilterMode) {
  return paragraphs.value.map(paragraph => {
    const chunks = paragraphChunks(paragraph);
    const hasDialogue = chunks.some(chunk => chunk.annotation);
    const hasPlain = chunks.some(chunk => !chunk.annotation && chunk.text.trim());
    return { hasDialogue, hasPlain };
  }).filter(paragraph => {
    if (mode === 'dialogue') return paragraph.hasDialogue;
    if (mode === 'unknown') return !paragraph.hasDialogue;
    if (mode === 'narration') return paragraph.hasPlain;
    return true;
  });
}

function audioItemsForRange(start: number, end: number) {
  return audioItems.value.filter(item => item.char_start >= start && item.char_start < end);
}


function audioStatusLabel(status: AudioStatus) {
  return {
    current: '已完成',
    missing: '未配音',
    stale: '已过期',
    failed: '失败',
    skipped: '已跳过'
  }[status];
}

function audioIssueSummary(item: AudioItem) {
  if (item.audio_status === 'skipped') return '此段已标记为不配音，试读和拼接会跳过';
  if (item.audio_status === 'failed') return item.error || '合成失败';
  if (item.audio_status === 'stale') return '标注、音色或参数变化后需要重新配音';
  return '还没有生成音频';
}

function isPlayableAudioItem(item: AudioItem | null | undefined) {
  return Boolean(item?.audio_url && item.audio_status !== 'failed' && item.audio_status !== 'skipped');
}

function isStalePlayableAudio(item: AudioItem | null | undefined) {
  return Boolean(item?.audio_url && item.audio_status === 'stale');
}

function findAnnotationByAudioItem(item: AudioItem) {
  if (item.dialogue_id) return annotations.value.find(annotation => Number(annotation.id) === Number(item.dialogue_id));
  return annotations.value.find(annotation => annotation.char_start === item.char_start && annotation.char_end === item.char_end);
}

function getTextOffset(node: Node, offset: number) {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement;
  const piece = element?.closest?.('[data-start]') as HTMLElement | null;
  if (!piece) return null;
  const base = Number(piece.dataset.start);
  const range = document.createRange();
  range.selectNodeContents(piece);
  range.setEnd(node, offset);
  return base + range.toString().length;
}

function captureSelection() {
  if (!editMode.value) return;
  errorMessage.value = '';
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !contentRoot.value) return;
  const range = selection.getRangeAt(0);
  if (!contentRoot.value.contains(range.commonAncestorContainer)) return;
  const start = getTextOffset(selection.anchorNode!, selection.anchorOffset);
  const end = getTextOffset(selection.focusNode!, selection.focusOffset);
  if (start === null || end === null || start === end) return;
  const rect = range.getBoundingClientRect();
  const charStart = Math.min(start, end);
  const charEnd = Math.max(start, end);
  const text = chapterContent.value.content.slice(charStart, charEnd);
  if (!text.trim()) return;

  const editing = rerangeAnnotationId.value
    ? annotations.value.find(item => item.id === rerangeAnnotationId.value)
    : null;
  selectionDraft.value = {
    char_start: charStart,
    char_end: charEnd,
    text,
    character_name: editing?.character_name || '',
    emotion: editing?.emotion || '',
    confirmed: editing?.annotation_status === 'confirmed',
    editId: editing?.id || null
  };
  rolePickerOpen.value = false;
  bookRolesExpanded.value = false;
  positionEditor(rect);
  activeAnnotationId.value = editing?.id || null;
  rerangeAnnotationId.value = null;
  selection.removeAllRanges();
}

function positionEditor(rect: DOMRect) {
  const preferredTop = rect.bottom + 8;
  const fallbackTop = Math.max(12, rect.top - 154);
  const top = preferredTop > window.innerHeight - 150 ? fallbackTop : preferredTop;
  const left = Math.min(Math.max(rect.left, 12), Math.max(12, window.innerWidth - 460));
  editorPosition.value = { top, left };
}

function positionEmotionEditor(rect: DOMRect) {
  const width = 300;
  const preferredTop = rect.bottom + 8;
  const fallbackTop = Math.max(12, rect.top - 190);
  const top = preferredTop > window.innerHeight - 180 ? fallbackTop : preferredTop;
  const left = Math.min(Math.max(rect.left, 12), Math.max(12, window.innerWidth - width - 12));
  emotionEditorPosition.value = { top, left };
}

function openEmotionEditor(annotation: Annotation, event?: MouseEvent) {
  emotionEditor.value = {
    annotation,
    value: annotation.emotion || ''
  };
  activeAnnotationId.value = annotation.id;
  if (event?.currentTarget instanceof HTMLElement) {
    positionEmotionEditor(event.currentTarget.getBoundingClientRect());
  }
}

function closeEmotionEditor() {
  const annotationId = emotionEditor.value?.annotation.id;
  emotionEditor.value = null;
  if (annotationId && activeAnnotationId.value === annotationId && !selectionDraft.value) {
    activeAnnotationId.value = null;
  }
}

async function saveInlineEmotion(value?: string) {
  if (!emotionEditor.value) return;
  const annotationId = emotionEditor.value.annotation.id;
  const emotion = (value ?? emotionEditor.value.value).trim();
  emotionSavingId.value = annotationId;
  errorMessage.value = '';
  try {
    await request.put(`/annotations/${annotationId}`, { emotion });
    closeEmotionEditor();
    await refreshChapter();
  } catch (error: any) {
    errorMessage.value = error?.response?.data?.error || '情绪保存失败';
  } finally {
    emotionSavingId.value = null;
  }
}

function editAnnotation(annotation: Annotation, event?: MouseEvent) {
  if (!editMode.value) return;
  closeEmotionEditor();
  activeAnnotationId.value = annotation.id;
  selectionDraft.value = {
    char_start: annotation.char_start,
    char_end: annotation.char_end,
    text: annotation.content,
    character_name: annotation.character_name,
    emotion: annotation.emotion || '',
    confirmed: annotation.annotation_status === 'confirmed',
    editId: annotation.id
  };
  rolePickerOpen.value = false;
  bookRolesExpanded.value = false;
  if (event?.currentTarget instanceof HTMLElement) {
    positionEditor(event.currentTarget.getBoundingClientRect());
  }
}

async function refreshChapter() {
  if (!workspaceStore.activeChapterId) return;
  await workspaceStore.setActiveChapter(workspaceStore.activeChapterId);
  if (workspaceStore.activeBookId) await workspaceStore.fetchBookCharacters(workspaceStore.activeBookId);
}

async function saveSelection() {
  if (!workspaceStore.activeChapterId || !selectionDraft.value) return;
  if (!selectionDraft.value.character_name.trim()) {
    errorMessage.value = '对白需要选择或输入角色';
    return;
  }
  saving.value = true;
  const payload = {
    type: 'dialogue',
    char_start: selectionDraft.value.char_start,
    char_end: selectionDraft.value.char_end,
    character_name: selectionDraft.value.character_name.trim(),
    emotion: selectionDraft.value.emotion.trim(),
    confirmed: selectionDraft.value.confirmed
  };
  try {
    if (selectionDraft.value.editId) {
      await request.put(`/annotations/${selectionDraft.value.editId}`, payload);
    } else {
      await request.post(`/chapters/${workspaceStore.activeChapterId}/annotations`, payload);
    }
    selectionDraft.value = null;
    activeAnnotationId.value = null;
    await refreshChapter();
  } catch (error: any) {
    errorMessage.value = error?.response?.data?.error || '标注保存失败';
  } finally {
    saving.value = false;
  }
}

async function deleteActiveAnnotation() {
  if (!selectionDraft.value?.editId) return;
  saving.value = true;
  try {
    await request.delete(`/annotations/${selectionDraft.value.editId}`);
    selectionDraft.value = null;
    activeAnnotationId.value = null;
    await refreshChapter();
  } catch (error: any) {
    errorMessage.value = error?.response?.data?.error || '标注删除失败';
  } finally {
    saving.value = false;
  }
}

async function redubAudioItem(item: AudioItem) {
  if (!item.dialogue_id) {
    activeAudioFilter.value = 'problem';
    return;
  }
  redubbingItemId.value = item.id;
  try {
    const res = await request.post(`/dialogues/${item.dialogue_id}/redub`);
    const jobId = res.data?.jobId || res.data?.data?.jobId;
    if (jobId) {
      jobStore.startPolling(
        jobId,
        async () => {
          redubbingItemId.value = null;
          await refreshChapter();
        },
        async () => {
          redubbingItemId.value = null;
          await refreshChapter();
        }
      );
    } else {
      redubbingItemId.value = null;
      await refreshChapter();
    }
  } catch (error: any) {
    redubbingItemId.value = null;
    errorMessage.value = error?.response?.data?.error || '重新配音启动失败';
  }
}

async function clearAudioItem(item: AudioItem) {
  if (!item.dialogue_id) return;
  try {
    await request.post(`/dialogues/${item.dialogue_id}/clear-audio`);
    await refreshChapter();
  } catch (error: any) {
    errorMessage.value = error?.response?.data?.error || '清除音频状态失败';
  }
}

async function toggleParagraphSkip(paragraph: Paragraph, skipAudio: boolean) {
  if (!workspaceStore.activeChapterId) return;
  const key = `${paragraph.char_start}-${paragraph.char_end}`;
  skipUpdatingKey.value = key;
  try {
    await request.put(`/chapters/${workspaceStore.activeChapterId}/audio-skip-ranges`, {
      char_start: paragraph.char_start,
      char_end: paragraph.char_end,
      skip_audio: skipAudio
    });
    if (skipAudio && seqPlaying.value) seqStop();
    await refreshChapter();
  } catch (error: any) {
    errorMessage.value = error?.response?.data?.error || '配音跳过状态保存失败';
  } finally {
    skipUpdatingKey.value = null;
  }
}

function isParagraphSkipUpdating(paragraph: Paragraph) {
  return skipUpdatingKey.value === `${paragraph.char_start}-${paragraph.char_end}`;
}

function editAudioItem(item: AudioItem, event?: MouseEvent) {
  const annotation = findAnnotationByAudioItem(item);
  if (!annotation) return;
  if (!editMode.value) editMode.value = true;
  editAnnotation(annotation, event);
}

function openAudioEditor(item: AudioItem) {
  if (!item.audio_url) return;
  if (seqPlaying.value) seqStop();
  if (activeAudioId.value === item.id) activeAudioId.value = null;
  audioEditorItem.value = item;
}

async function saveEditedAudio(payload: { blob: Blob; duration: number }) {
  if (!audioEditorItem.value?.dialogue_id) {
    errorMessage.value = '旁白音频暂不支持覆盖保存';
    return;
  }
  audioEditorSaving.value = true;
  errorMessage.value = '';
  try {
    const form = new FormData();
    form.append('audio', payload.blob, `dialogue-${audioEditorItem.value.dialogue_id}-edited.wav`);
    form.append('duration', String(payload.duration));
    await request.post(`/dialogues/${audioEditorItem.value.dialogue_id}/audio`, form);
    const savedItemId = audioEditorItem.value.id;
    audioEditorItem.value = null;
    activeAudioId.value = null;
    seqDurationCache.value = Object.fromEntries(
      Object.entries(seqDurationCache.value).filter(([key]) => !key.startsWith(`${savedItemId}:`))
    );
    await refreshChapter();
  } catch (error: any) {
    errorMessage.value = error?.response?.data?.error || '音频保存失败';
  } finally {
    audioEditorSaving.value = false;
  }
}

function startRerange() {
  if (!selectionDraft.value?.editId) return;
  rerangeAnnotationId.value = selectionDraft.value.editId;
  errorMessage.value = '请选择新的文本范围';
  nextTick(() => contentRoot.value?.focus());
}

function closeEditor() {
  selectionDraft.value = null;
  activeAnnotationId.value = null;
  rerangeAnnotationId.value = null;
  rolePickerOpen.value = false;
  bookRolesExpanded.value = false;
  errorMessage.value = '';
  closeEmotionEditor();
}

function selectRole(role: string) {
  if (!selectionDraft.value) return;
  selectionDraft.value.character_name = role;
  rolePickerOpen.value = false;
  bookRolesExpanded.value = false;
}

function toggleEditMode() {
  editMode.value = !editMode.value;
  closeEditor();
}

async function startAnalysis() {
  if (!workspaceStore.activeChapterId) return;
  if (annotations.value.length > 0) {
    confirmReparseVisible.value = true;
    return;
  }
  await runAnalysis();
}

async function confirmReparse() {
  confirmReparseVisible.value = false;
  await runAnalysis();
}

async function runAnalysis() {
  if (!workspaceStore.activeChapterId) return;
  const activeBookId = workspaceStore.activeBookId;
  const activeChapterId = workspaceStore.activeChapterId;
  if (!activeBookId || !activeChapterId) return;
  isAnalysisSubmitting.value = true;
  try {
    const res = await request.post(`/chapters/${activeChapterId}/analyze`);
    const jobId = res.data?.jobId || res.data?.data?.jobId;
    if (jobId) {
      workspaceStore.setTabWorkspaceJob(activeBookId, 'analysis', jobId);
      jobStore.startPolling(
        jobId,
        async () => {
          isAnalysisSubmitting.value = false;
          workspaceStore.setTabWorkspaceJob(activeBookId, 'analysis', null);
          await workspaceStore.setActiveChapter(activeChapterId, activeBookId);
          await workspaceStore.fetchBookCharacters(activeBookId);
        },
        (error: any) => {
          isAnalysisSubmitting.value = false;
          workspaceStore.setTabWorkspaceJob(activeBookId, 'analysis', null);
          console.error('Analysis failed', error);
        }
      );
    } else {
      isAnalysisSubmitting.value = false;
    }
  } catch (err) {
    console.error('Failed to start analysis:', err);
    isAnalysisSubmitting.value = false;
  }
}

// 角色颜色（与 RoleVoiceMapping 中 getAvatarColor 一致）
const roleColorHexes = ['#00d4aa', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6'];
const roleColorRGBs = ['0,212,170', '245,158,11', '59,130,246', '236,72,153', '139,92,246'];
function getRoleIndex(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % roleColorHexes.length;
}
function getRoleColor(name: string) {
  return roleColorHexes[getRoleIndex(name)];
}
function getRoleRGB(name: string) {
  return roleColorRGBs[getRoleIndex(name)];
}

// 判断 chunk 是否是该标注在当前 segment 中的第一个 chunk（用于只显示一次角色标签）
function isFirstChunkOfAnnotation(chunks: TextChunk[], chunk: TextChunk): boolean {
  if (!chunk.annotation) return false;
  return chunks.find(c => c.annotation?.id === chunk.annotation!.id) === chunk;
}

// 判断 segment 是否包含高亮角色的对白
function isSegmentOfHighlightedRole(segment: SentenceSegment): boolean {
  if (!workspaceStore.highlightedRole) return false;
  return segment.chunks.some(c => c.annotation?.character_name === workspaceStore.highlightedRole);
}

// hover 状态跟踪（存储 key 和角色名）
const hoveredSegInfo = ref<{ key: string; role: string } | null>(null);

// 获取 segment 中第一个标注的角色名
function getSegmentRole(segment: SentenceSegment): string | null {
  for (const chunk of segment.chunks) {
    if (chunk.annotation?.character_name) return chunk.annotation.character_name;
  }
  return null;
}

// segment 是否包含任何标注
function segmentHasAnnotation(segment: SentenceSegment): boolean {
  return segment.chunks.some(c => c.annotation);
}

// 构建全角色 segment key 索引
const roleSegKeysMap = computed<Record<string, string[]>>(() => {
  const map: Record<string, string[]> = {};
  for (const pv of paragraphViews.value) {
    for (const seg of pv.segments) {
      for (const chunk of seg.chunks) {
        if (chunk.annotation?.character_name) {
          const role = chunk.annotation.character_name;
          if (!map[role]) map[role] = [];
          if (!map[role].includes(seg.key)) map[role].push(seg.key);
          break;
        }
      }
    }
  }
  return map;
});

// 是否有下一句（同角色）
function hasNextRoleSeg(segKey: string, role: string): boolean {
  const keys = roleSegKeysMap.value[role];
  if (!keys) return false;
  const idx = keys.indexOf(segKey);
  return idx >= 0 && idx < keys.length - 1;
}

// 跳转到下一句（同角色）
function scrollToNextRoleSeg(segKey: string, role: string) {
  const keys = roleSegKeysMap.value[role];
  if (!keys) return;
  const idx = keys.indexOf(segKey);
  if (idx < 0 || idx >= keys.length - 1) return;
  const nextKey = keys[idx + 1];
  const el = document.querySelector(`[data-seg-key="${nextKey}"]`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// 点击角色时自动滚动到第一句
watch(() => workspaceStore.highlightedRole, (role) => {
  if (!role) return;
  nextTick(() => {
    const el = document.querySelector('.sentence-segment.role-pointed');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
});

onMounted(() => {
  workspaceStore.fetchVoices();
});
</script>

<template>
  <div class="dialogue-view-container">
    <div class="panel-header">
      <div class="header-left" v-if="chapterContent">
        <span class="status-badge" :class="annotations.length ? 'success' : 'pending'">
          {{ annotations.length ? '标注中' : '待标注' }}
        </span>
        <span class="stat-text mono-text">
          <strong class="text-accent">{{ paragraphs.length }}</strong> 段
          <strong class="text-accent">{{ uniqueRoles.length }}</strong> 角色
          <strong class="text-accent">{{ dialogueCount }}</strong> 对白
          <strong class="text-accent">{{ confirmedCount }}</strong> 已确认
          <button class="remaining-link" type="button" @click="activeAudioFilter = 'problem'">
            剩余 {{ audioStats.problem }} 句
          </button>
        </span>
      </div>
      <div class="header-left" v-else>
        <span class="panel-title">原文标注</span>
      </div>
      <div class="header-actions" v-if="chapterContent && !isAnalyzing">
        <button class="btn btn-outline btn-sm edit-toggle" :class="{ active: editMode }" @click="toggleEditMode">
          {{ editMode ? '退出编辑' : '编辑' }}
        </button>
        <button class="btn btn-outline btn-sm ai-parse-btn" :class="{ primary: annotations.length === 0 }" @click="startAnalysis">
          {{ aiParseButtonLabel }}
        </button>
      </div>
    </div>

    <div class="content-scroll" v-if="!chapterContent">
      <div class="empty-state"><p>请在左侧选择章节</p></div>
    </div>

    <div class="content-scroll" v-else-if="isAnalyzing">
      <div class="analysis-trigger">
        <div class="trigger-box analyzing">
          <div class="spinner"></div>
          <p>AI 解析中... {{ currentJob?.progress || 0 }}%</p>
          <span class="mono-text sub-text">完成后会用新的范围标注重建本章</span>
        </div>
      </div>
    </div>

    <div class="content-scroll" :class="{ editing: editMode }" v-else>
      <div class="seq-player-bar" v-if="hasPlayableAudio">
        <button class="seq-play-btn" @click="seqPlayPause" :title="seqPlaying ? '暂停' : '顺序播放全章'">
          <svg v-if="seqPlaying" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <rect x="6" y="4" width="4" height="16"/>
            <rect x="14" y="4" width="4" height="16"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </button>
        <div class="seq-track" @click="() => { /* future: seek */ }">
          <div class="seq-track-fill" :style="{ width: seqOverallProgress + '%' }"></div>
        </div>
        <span class="seq-progress mono-text">{{ seqProgressLabel }}</span>
        <span class="seq-time mono-text" v-if="seqTimeLabel">{{ seqTimeLabel }}</span>
        <button class="seq-stop-btn" v-if="seqCurrentIndex >= 0" @click="seqStop" title="停止">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <rect x="5" y="5" width="14" height="14" rx="2"/>
          </svg>
        </button>
      </div>
      <div class="filter-bar">
        <button class="filter-chip" :class="{ active: activeFilter === 'all' }" @click="activeFilter = 'all'">全部 <span>{{ paragraphs.length }}</span></button>
        <button class="filter-chip unknown" :class="{ active: activeFilter === 'unknown' }" @click="activeFilter = 'unknown'">未标注 <span>{{ unknownCount }}</span></button>
        <button class="filter-chip narration" :class="{ active: activeFilter === 'narration' }" @click="activeFilter = 'narration'">旁白 <span>{{ narrationCount }}</span></button>
        <button class="filter-chip dialogue" :class="{ active: activeFilter === 'dialogue' }" @click="activeFilter = 'dialogue'">对白 <span>{{ dialogueCount }}</span></button>
      </div>
      <div class="audio-filter-bar">
        <button class="audio-filter-chip" :class="{ active: activeAudioFilter === 'all' }" @click="activeAudioFilter = 'all'">全部 <span>{{ audioStats.all }}</span></button>
        <button class="audio-filter-chip problem" :class="{ active: activeAudioFilter === 'problem' }" @click="activeAudioFilter = 'problem'">问题 <span>{{ audioStats.problem }}</span></button>
        <button class="audio-filter-chip missing" :class="{ active: activeAudioFilter === 'missing' }" @click="activeAudioFilter = 'missing'">未配音 <span>{{ audioStats.missing }}</span></button>
        <button class="audio-filter-chip stale" :class="{ active: activeAudioFilter === 'stale' }" @click="activeAudioFilter = 'stale'">已过期 <span>{{ audioStats.stale }}</span></button>
        <button class="audio-filter-chip failed" :class="{ active: activeAudioFilter === 'failed' }" @click="activeAudioFilter = 'failed'">失败 <span>{{ audioStats.failed }}</span></button>
        <button class="audio-filter-chip skipped" :class="{ active: activeAudioFilter === 'skipped' }" @click="activeAudioFilter = 'skipped'">已跳过 <span>{{ audioStats.skipped }}</span></button>
        <button class="audio-filter-chip current" :class="{ active: activeAudioFilter === 'current' }" @click="activeAudioFilter = 'current'">已完成 <span>{{ audioStats.current }}</span></button>
      </div>

      <div class="selection-editor" v-if="editMode && selectionDraft" :style="editorStyle">
        <div class="selected-text">{{ selectionDraft.text }}</div>
        <div class="role-picker">
          <button class="role-picker-trigger" type="button" @click="rolePickerOpen = !rolePickerOpen">
            <span>{{ selectionDraft.character_name || '选择角色' }}</span>
            <span class="chevron">⌄</span>
          </button>
          <div class="role-picker-menu" v-if="rolePickerOpen">
            <button
              class="role-option"
              v-for="role in primaryRoleOptions"
              :key="`primary-${role}`"
              type="button"
              @click="selectRole(role)"
            >
              {{ role }}
            </button>
            <div class="role-empty" v-if="primaryRoleOptions.length === 0">当前章节暂无角色</div>
            <button
              class="role-group-toggle"
              type="button"
              v-if="bookRoleOptions.length > 0"
              @click="bookRolesExpanded = !bookRolesExpanded"
            >
              <span>本书角色</span>
              <span>{{ bookRolesExpanded ? '⌃' : '›' }}</span>
            </button>
            <div class="role-submenu" v-if="bookRolesExpanded">
              <button
                class="role-option secondary"
                v-for="role in bookRoleOptions"
                :key="`book-${role}`"
                type="button"
                @click="selectRole(role)"
              >
                {{ role }}
              </button>
            </div>
          </div>
        </div>
        <input class="field custom-role-field" v-model="selectionDraft.character_name" placeholder="手输角色">
        <input class="field emotion-field" v-model="selectionDraft.emotion" placeholder="情绪">
        <label class="confirm-toggle"><input type="checkbox" v-model="selectionDraft.confirmed">确认</label>
        <button class="btn-save" :disabled="saving" @click="saveSelection">{{ saving ? '保存中' : '保存' }}</button>
        <button class="btn-ghost" v-if="selectionDraft.editId" @click="startRerange">重新划定</button>
        <button class="btn-danger-mini" v-if="selectionDraft.editId" :disabled="saving" @click="deleteActiveAnnotation">删除</button>
        <button class="btn-ghost" @click="closeEditor">关闭</button>
        <span class="editor-error" v-if="errorMessage">{{ errorMessage }}</span>
      </div>

      <div
        class="emotion-editor-popover"
        v-if="emotionEditor"
        :style="emotionEditorStyle"
        @click.stop
      >
        <div class="emotion-editor-title">
          <span>{{ emotionEditor.annotation.character_name }}</span>
          <button type="button" class="emotion-editor-close" @click="closeEmotionEditor">×</button>
        </div>
        <div class="emotion-options">
          <button
            v-for="emotion in commonEmotionOptions"
            :key="emotion"
            type="button"
            class="emotion-option"
            :class="{ active: emotionEditor.value === emotion }"
            :disabled="emotionSavingId === emotionEditor.annotation.id"
            @click="saveInlineEmotion(emotion)"
          >
            {{ emotion }}
          </button>
        </div>
        <div class="emotion-custom-row">
          <input
            class="emotion-custom-input"
            v-model="emotionEditor.value"
            placeholder="手动输入，如：低声"
            @keydown.enter.prevent="saveInlineEmotion()"
          >
          <button
            type="button"
            class="emotion-save-btn"
            :disabled="emotionSavingId === emotionEditor.annotation.id"
            @click="saveInlineEmotion()"
          >
            保存
          </button>
          <button
            type="button"
            class="emotion-clear-btn"
            :disabled="emotionSavingId === emotionEditor.annotation.id"
            @click="saveInlineEmotion('')"
          >
            清空
          </button>
        </div>
        <div class="emotion-editor-hint">短提示更稳，不确定就留空。</div>
      </div>

      <div class="unlocated-panel" v-if="unlocatedDialogues.length > 0">
        <div class="unlocated-title">未定位 AI 结果</div>
        <div class="unlocated-item" v-for="dialogue in unlocatedDialogues" :key="dialogue.id">
          <strong>{{ dialogue.character_name }}</strong>
          <span>{{ dialogue.content }}</span>
        </div>
      </div>

      <div class="source-document" :class="{ editing: editMode }" ref="contentRoot" tabindex="0" @mouseup="captureSelection" @click="closeEmotionEditor">
        <div class="paragraph-row" :class="{ skipped: paragraph.skip_audio }" v-for="paragraph in paragraphViews" :key="paragraph.paragraph_index">
          <div class="paragraph-index mono-text">
            <span>{{ paragraph.paragraph_index + 1 }}</span>
            <button
              type="button"
              class="paragraph-skip-btn"
              :class="{ active: paragraph.skip_audio }"
              :disabled="isParagraphSkipUpdating(paragraph)"
              @click.stop="toggleParagraphSkip(paragraph, !paragraph.skip_audio)"
            >
              {{ paragraph.skip_audio ? '恢复' : '跳过' }}
            </button>
          </div>
          <div class="paragraph-body">
            <div class="paragraph-skip-notice" v-if="paragraph.skip_audio">已跳过配音</div>
            <div
              class="sentence-segment"
              :class="{
                'seq-active': segment.audioItem && seqActiveItemId === segment.audioItem.id,
                'role-pointed': isSegmentOfHighlightedRole(segment),
                'has-annotation': segmentHasAnnotation(segment)
              }"
              :style="segmentHasAnnotation(segment) ? { '--rc': getRoleRGB(getSegmentRole(segment) || '旁白') } : undefined"
              :data-seg-key="segment.key"
              v-for="segment in paragraph.segments"
              :key="segment.key"
              @mouseenter="segmentHasAnnotation(segment) ? hoveredSegInfo = { key: segment.key, role: getSegmentRole(segment)! } : null"
              @mouseleave="hoveredSegInfo?.key === segment.key ? hoveredSegInfo = null : null"
            >
              <p class="segment-text">
                <template v-for="chunk in segment.chunks" :key="chunk.key">
                  <span
                    v-if="chunk.annotation || chunk.draft"
                    class="annotation-highlight"
                    :class="{
                      active: chunk.annotation && activeAnnotationId === chunk.annotation.id,
                      confirmed: chunk.annotation?.annotation_status === 'confirmed',
                      draft: chunk.draft,
                      'role-highlighted': chunk.annotation && workspaceStore.highlightedRole && chunk.annotation.character_name === workspaceStore.highlightedRole,
                      'role-dimmed': chunk.annotation && workspaceStore.highlightedRole && chunk.annotation.character_name !== workspaceStore.highlightedRole
                    }"
                    :style="chunk.annotation ? { '--rc': getRoleRGB(chunk.annotation.character_name) } : undefined"
                    :data-start="chunk.char_start"
                    :data-end="chunk.char_end"
                    @click.stop="chunk.annotation && editAnnotation(chunk.annotation, $event)"
                  >
                    <span
                      v-if="chunk.annotation && isFirstChunkOfAnnotation(segment.chunks, chunk)"
                      class="role-label"
                      :style="{ backgroundColor: getRoleColor(chunk.annotation.character_name) }"
                    >{{ chunk.annotation.character_name }}</span>
                    <button
                      v-if="chunk.annotation && isFirstChunkOfAnnotation(segment.chunks, chunk)"
                      type="button"
                      class="emotion-chip"
                      :class="{ empty: !chunk.annotation.emotion, active: emotionEditor?.annotation.id === chunk.annotation.id }"
                      :disabled="emotionSavingId === chunk.annotation.id"
                      :title="chunk.annotation.emotion ? `情绪：${chunk.annotation.emotion}` : '设置情绪'"
                      @click.stop="openEmotionEditor(chunk.annotation, $event)"
                    >
                      {{ chunk.annotation.emotion || '情绪' }}
                    </button>
                    {{ chunk.text }}
                  </span>
                  <span v-else class="text-piece" :data-start="chunk.char_start" :data-end="chunk.char_end">{{ chunk.text }}</span>
                </template>
              </p>
              <button
                v-if="hoveredSegInfo?.key === segment.key && hoveredSegInfo?.role && hasNextRoleSeg(segment.key, hoveredSegInfo.role)"
                class="next-role-btn"
                type="button"
                @click.stop="scrollToNextRoleSeg(segment.key, hoveredSegInfo!.role)"
              >下一句 ↓</button>
              <span
                v-else-if="hoveredSegInfo?.key === segment.key && hoveredSegInfo?.role && !hasNextRoleSeg(segment.key, hoveredSegInfo.role)"
                class="next-role-btn last"
              >已是最后一句</span>
              <template v-if="segment.audioItem">
                <div v-if="isPlayableAudioItem(segment.audioItem)" class="segment-audio-block">
                  <div class="segment-audio-row">
                    <AudioTrack
                      :src="toMediaUrl(segment.audioItem.audio_url!)"
                      :active="activeAudioId === segment.audioItem.id"
                      class="segment-audio"
                      :class="{
                        'seq-highlight': seqActiveItemId === segment.audioItem.id,
                        'is-stale': isStalePlayableAudio(segment.audioItem)
                      }"
                      @activate="onTrackActivate(segment.audioItem.id)"
                      @deactivate="activeAudioId = null"
                    />
                    <button
                      type="button"
                      class="audio-edit-btn"
                      title="编辑音频"
                      @click.stop="openAudioEditor(segment.audioItem)"
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 12h3l2-7 4 14 2-7h7"/>
                      </svg>
                    </button>
                  </div>
                  <div v-if="isStalePlayableAudio(segment.audioItem)" class="stale-audio-notice">
                    <div class="stale-copy">
                      <span class="issue-status">已过期</span>
                      <span>{{ audioIssueSummary(segment.audioItem) }}</span>
                    </div>
                    <button
                      type="button"
                      class="issue-btn primary"
                      :disabled="redubbingItemId === segment.audioItem.id || !segment.audioItem.dialogue_id"
                      @click="redubAudioItem(segment.audioItem)"
                    >
                      {{ redubbingItemId === segment.audioItem.id ? '提交中' : '重新配音' }}
                    </button>
                  </div>
                </div>
                <div
                  v-else-if="segment.audioItem.audio_status !== 'current'"
                  class="audio-issue"
                  :class="segment.audioItem.audio_status"
                >
                  <div class="issue-main">
                    <span class="issue-status">{{ audioStatusLabel(segment.audioItem.audio_status) }}</span>
                    <strong>{{ segment.audioItem.character_name }}</strong>
                    <small v-if="segment.audioItem.error">{{ segment.audioItem.error }}</small>
                    <small v-else>{{ audioIssueSummary(segment.audioItem) }}</small>
                  </div>
                  <div class="issue-actions" v-if="segment.audioItem.audio_status === 'skipped'">
                    <button type="button" class="issue-btn primary" :disabled="isParagraphSkipUpdating(paragraph)" @click="toggleParagraphSkip(paragraph, false)">恢复配音</button>
                  </div>
                  <div class="issue-actions" v-else>
                    <button type="button" class="issue-btn primary" :disabled="redubbingItemId === segment.audioItem.id || !segment.audioItem.dialogue_id" @click="redubAudioItem(segment.audioItem)">{{ redubbingItemId === segment.audioItem.id ? '提交中' : '重配' }}</button>
                    <button type="button" class="issue-btn" :disabled="!segment.audioItem.dialogue_id" @click="clearAudioItem(segment.audioItem)">清除</button>
                    <button type="button" class="issue-btn" :disabled="segment.audioItem.type === 'narration'" @click="editAudioItem(segment.audioItem, $event)">编辑</button>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
        <div class="empty-state inline-empty" v-if="paragraphViews.length === 0">
          <p>当前筛选没有匹配段落</p>
        </div>
      </div>
    </div>

    <div class="theme-modal-backdrop" v-if="confirmReparseVisible" @click.self="confirmReparseVisible = false">
      <div class="theme-dialog warning-dialog">
        <div class="theme-dialog-header">
          <div>
            <h3>重新 AI 解析</h3>
            <span class="mono-text">RESET ANNOTATIONS</span>
          </div>
          <button class="dialog-close" type="button" @click="confirmReparseVisible = false">×</button>
        </div>
        <p class="theme-dialog-message">重新解析会清空本章现有标注，并用新的 AI 结果重建角色与对白。</p>
        <div class="warning-list">
          <span>人工调整不会保留</span>
          <span>已有音频和拼接结果可能失效</span>
        </div>
        <div class="theme-dialog-actions">
          <button class="btn-cancel" type="button" @click="confirmReparseVisible = false">取消</button>
          <button class="btn-confirm" type="button" @click="confirmReparse">重新解析</button>
        </div>
      </div>
    </div>

    <AudioEditorModal
      :open="!!audioEditorItem"
      :src="audioEditorItem?.audio_url ? toMediaUrl(audioEditorItem.audio_url) : ''"
      :title="audioEditorItem ? `${audioEditorItem.character_name} · 音频编辑` : '音频编辑'"
      :subtitle="audioEditorItem?.content || '切片编辑'"
      :saving="audioEditorSaving"
      @close="audioEditorItem = null"
      @save="saveEditedAudio"
    />
  </div>
</template>

<style scoped>
.dialogue-view-container { display: flex; flex-direction: column; height: 100%; }
.panel-header { height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 var(--space-3); border-bottom: 1px solid var(--border-color); background: var(--bg-panel); flex-shrink: 0; }
.header-left { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.header-actions { display: flex; align-items: center; gap: 6px; }
.panel-title { font-size: 13px; color: var(--text-secondary); font-weight: 500; }
.status-badge { font-size: 11px; padding: 2px 6px; border-radius: var(--radius-sm); font-weight: 600; flex-shrink: 0; }
.status-badge.success { background: var(--accent-cyan); color: var(--bg-base); }
.status-badge.pending { background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); }
.stat-text { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.remaining-link { height: 20px; margin-left: 6px; padding: 0 7px; border: 1px solid rgba(245,158,11,.38); border-radius: var(--radius-sm); background: rgba(245,158,11,.08); color: #f8c16c; font-size: 11px; cursor: pointer; }
.remaining-link:hover { border-color: rgba(245,158,11,.72); color: #ffd18a; }
.btn-sm, .btn-save, .btn-ghost, .btn-danger-mini { height: 24px; padding: 0 9px; font-size: 11px; border-radius: var(--radius-sm); cursor: pointer; border: 1px solid var(--border-focus); background: transparent; color: var(--text-secondary); }
.btn-save:hover, .btn-sm:hover, .btn-ghost:hover { border-color: var(--accent-cyan); color: var(--accent-cyan); }
.edit-toggle.active { border-color: rgba(0,212,170,.72); background: rgba(0,212,170,.14); color: var(--accent-cyan); }
.ai-parse-btn { border-color: rgba(0,212,170,.42); color: var(--accent-cyan); background: rgba(0,212,170,.08); font-weight: 600; }
.ai-parse-btn.primary { border-color: rgba(0,212,170,.78); background: rgba(0,212,170,.18); color: #7fffe7; box-shadow: 0 0 0 1px rgba(0,212,170,.08), 0 0 16px rgba(0,212,170,.12); }
.ai-parse-btn:hover { border-color: var(--accent-cyan); background: rgba(0,212,170,.16); color: #b9fff2; }
.btn-danger-mini { border-color: rgba(239, 68, 68, 0.45); color: #f87171; }
.content-scroll { flex: 1; min-height: 0; overflow-y: auto; background: var(--bg-panel); transition: box-shadow 0.3s ease, border-color 0.3s ease; border: 1px solid transparent; margin: -1px; }
.content-scroll.editing { box-shadow: inset 0 0 40px rgba(0, 212, 170, 0.15), inset 0 0 12px rgba(0, 212, 170, 0.1); border-color: rgba(0, 212, 170, 0.25); }
.empty-state, .analysis-trigger { height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 13px; }
.trigger-box { border: 1px solid var(--accent-cyan); border-radius: var(--radius-md); padding: var(--space-6) var(--space-8); text-align: center; }
.trigger-box p { color: var(--text-secondary); font-size: 14px; }
.sub-text { font-size: 11px; color: var(--text-muted); }
.spinner { width: 24px; height: 24px; margin: 0 auto var(--space-3); border: 2px solid var(--border-focus); border-top-color: var(--accent-cyan); border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.seq-player-bar { position: sticky; top: 0; z-index: 4; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid rgba(0,212,170,.18); background: rgba(16, 20, 24, 0.97); backdrop-filter: blur(8px); }
.seq-play-btn, .seq-stop-btn { flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--border-focus); background: transparent; color: var(--text-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.18s; }
.seq-play-btn:hover { border-color: var(--accent-cyan); color: var(--accent-cyan); background: rgba(0,212,170,.1); }
.seq-stop-btn { width: 24px; height: 24px; border-radius: var(--radius-sm); }
.seq-stop-btn:hover { border-color: #f87171; color: #f87171; background: rgba(248,113,113,.1); }
.seq-track { flex: 1; height: 6px; background: var(--border-color); border-radius: 3px; overflow: hidden; cursor: pointer; position: relative; }
.seq-track-fill { height: 100%; background: linear-gradient(90deg, var(--accent-cyan), rgba(0,212,170,.6)); border-radius: 3px; transition: width 0.3s linear; }
.seq-progress { flex-shrink: 0; font-size: 11px; color: var(--text-secondary); min-width: 56px; }
.seq-time { flex-shrink: 0; font-size: 10px; color: var(--text-muted); min-width: 70px; text-align: right; }
.filter-bar { position: sticky; top: 0; z-index: 3; display: flex; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--border-color); background: rgba(22, 24, 29, 0.96); backdrop-filter: blur(8px); }
.seq-player-bar ~ .filter-bar { top: 47px; }
.filter-chip { height: 24px; display: inline-flex; align-items: center; gap: 5px; padding: 0 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); font-size: 11px; cursor: pointer; }
.filter-chip span { font-family: var(--font-mono); font-size: 10px; }
.filter-chip.active { color: var(--text-primary); border-color: var(--border-focus); background: rgba(255,255,255,0.04); }
.filter-chip.unknown.active { color: #f59e0b; border-color: rgba(245,158,11,.55); background: rgba(245,158,11,.12); }
.filter-chip.narration.active { color: #c4c9d1; border-color: rgba(156,163,175,.55); background: rgba(156,163,175,.12); }
.filter-chip.dialogue.active { color: var(--accent-cyan); border-color: rgba(0,212,170,.55); background: rgba(0,212,170,.12); }
.audio-filter-bar { position: sticky; top: 41px; z-index: 3; display: flex; gap: 6px; padding: 7px 10px; border-bottom: 1px solid var(--border-color); background: rgba(20, 22, 27, 0.96); backdrop-filter: blur(8px); overflow-x: auto; }
.seq-player-bar ~ .filter-bar ~ .audio-filter-bar { top: 88px; }
.audio-filter-chip { height: 24px; display: inline-flex; align-items: center; gap: 5px; padding: 0 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); font-size: 11px; cursor: pointer; white-space: nowrap; }
.audio-filter-chip span { font-family: var(--font-mono); font-size: 10px; }
.audio-filter-chip.active { color: var(--text-primary); border-color: var(--border-focus); background: rgba(255,255,255,0.04); }
.audio-filter-chip.problem.active { color: #f59e0b; border-color: rgba(245,158,11,.58); background: rgba(245,158,11,.12); }
.audio-filter-chip.missing.active { color: #cbd5e1; border-color: rgba(148,163,184,.45); background: rgba(148,163,184,.08); }
.audio-filter-chip.stale.active { color: #facc15; border-color: rgba(250,204,21,.55); background: rgba(250,204,21,.1); }
.audio-filter-chip.failed.active { color: #f87171; border-color: rgba(248,113,113,.58); background: rgba(248,113,113,.12); }
.audio-filter-chip.skipped.active { color: #94a3b8; border-color: rgba(148,163,184,.58); background: rgba(148,163,184,.12); }
.audio-filter-chip.current.active { color: var(--accent-cyan); border-color: rgba(0,212,170,.55); background: rgba(0,212,170,.12); }
.selection-editor { position: fixed; z-index: 900; width: min(448px, calc(100vw - 24px)); display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 8px 10px; border: 1px solid rgba(0,212,170,.36); border-radius: var(--radius-md); background: rgba(18, 22, 25, .98); box-shadow: 0 14px 36px rgba(0,0,0,.36); }
.selection-editor::before { content: ''; position: absolute; top: -6px; left: 18px; width: 10px; height: 10px; transform: rotate(45deg); background: rgba(18, 22, 25, .98); border-left: 1px solid rgba(0,212,170,.36); border-top: 1px solid rgba(0,212,170,.36); }
.emotion-editor-popover { position: fixed; z-index: 920; width: min(300px, calc(100vw - 24px)); padding: 9px; border: 1px solid rgba(0,212,170,.34); border-radius: var(--radius-md); background: rgba(18, 22, 25, .98); box-shadow: 0 14px 36px rgba(0,0,0,.38); }
.emotion-editor-popover::before { content: ''; position: absolute; top: -6px; left: 18px; width: 10px; height: 10px; transform: rotate(45deg); background: rgba(18, 22, 25, .98); border-left: 1px solid rgba(0,212,170,.34); border-top: 1px solid rgba(0,212,170,.34); }
.emotion-editor-title { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; color: var(--text-secondary); font-size: 12px; font-weight: 600; }
.emotion-editor-title span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.emotion-editor-close { flex-shrink: 0; width: 22px; height: 22px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); cursor: pointer; }
.emotion-editor-close:hover { border-color: var(--accent-cyan); color: var(--accent-cyan); }
.emotion-options { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.emotion-option { height: 24px; padding: 0 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: transparent; color: var(--text-secondary); font-size: 11px; cursor: pointer; }
.emotion-option:hover:not(:disabled), .emotion-option.active { border-color: rgba(0,212,170,.58); background: rgba(0,212,170,.11); color: var(--accent-cyan); }
.emotion-custom-row { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 6px; }
.emotion-custom-input { min-width: 0; height: 26px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-base); color: var(--text-primary); padding: 0 8px; font-size: 11px; outline: none; }
.emotion-custom-input:focus { border-color: var(--accent-cyan); }
.emotion-save-btn, .emotion-clear-btn { height: 26px; padding: 0 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: transparent; color: var(--text-secondary); font-size: 11px; cursor: pointer; white-space: nowrap; }
.emotion-save-btn { border-color: rgba(0,212,170,.45); color: var(--accent-cyan); }
.emotion-clear-btn:hover:not(:disabled), .emotion-save-btn:hover:not(:disabled) { border-color: var(--accent-cyan); color: var(--accent-cyan); }
.emotion-option:disabled, .emotion-save-btn:disabled, .emotion-clear-btn:disabled { opacity: .5; cursor: not-allowed; }
.emotion-editor-hint { position: relative; z-index: 1; margin-top: 7px; color: var(--text-muted); font-size: 11px; line-height: 1.4; }
.selected-text { max-width: 100%; flex: 1 0 100%; color: var(--text-secondary); font-size: 12px; line-height: 1.5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; position: relative; z-index: 1; }
.field { height: 24px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-base); color: var(--text-primary); padding: 0 8px; font-size: 11px; outline: none; }
.field:focus { border-color: var(--accent-cyan); }
.role-picker { position: relative; width: 126px; }
.role-picker-trigger { width: 100%; height: 24px; display: flex; align-items: center; justify-content: space-between; gap: 6px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-base); color: var(--text-primary); padding: 0 8px; font-size: 11px; cursor: pointer; }
.role-picker-trigger:hover { border-color: var(--accent-cyan); }
.role-picker-trigger span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chevron { color: var(--text-muted); }
.role-picker-menu { position: absolute; top: 29px; left: 0; z-index: 20; width: 184px; max-height: 260px; overflow-y: auto; padding: 5px; border: 1px solid rgba(0,212,170,.34); border-radius: var(--radius-sm); background: #171a20; box-shadow: 0 14px 32px rgba(0,0,0,.42); }
.role-option, .role-group-toggle { width: 100%; min-height: 26px; display: flex; align-items: center; justify-content: space-between; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text-secondary); padding: 0 8px; font-size: 11px; text-align: left; cursor: pointer; }
.role-option:hover, .role-group-toggle:hover { background: rgba(0,212,170,.12); color: var(--accent-cyan); }
.role-option.secondary { color: var(--text-muted); padding-left: 16px; }
.role-group-toggle { margin-top: 4px; border-top: 1px solid var(--border-color); border-radius: 0; color: var(--accent-cyan); }
.role-submenu { padding-top: 3px; }
.role-empty { padding: 6px 8px; color: var(--text-muted); font-size: 11px; }
.custom-role-field { width: 104px; }
.emotion-field { width: 96px; }
.confirm-toggle { display: inline-flex; align-items: center; gap: 5px; color: var(--text-secondary); font-size: 11px; }
.editor-error { color: #f59e0b; font-size: 11px; }
.unlocated-panel { margin: var(--space-3); border: 1px solid rgba(245,158,11,.3); background: rgba(245,158,11,.08); border-radius: var(--radius-sm); padding: var(--space-2); color: var(--text-secondary); }
.unlocated-title { font-size: 12px; color: #f59e0b; margin-bottom: 6px; font-weight: 600; }
.unlocated-item { display: flex; gap: var(--space-2); font-size: 12px; line-height: 1.5; }
.source-document { outline: none; }
.source-document.editing { cursor: text; }
.paragraph-row { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: var(--space-3); padding: 10px 14px 10px 0; border-bottom: 1px solid var(--border-color); }
.paragraph-row:hover { background: rgba(255,255,255,.025); }
.paragraph-row.skipped { background: rgba(148,163,184,.035); }
.paragraph-row.skipped .sentence-segment { opacity: .58; }
.paragraph-index { color: var(--text-muted); font-size: 11px; padding-top: 4px; text-align: right; user-select: none; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.paragraph-skip-btn { height: 22px; padding: 0 6px; border: 1px solid rgba(148,163,184,.28); border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); font-size: 10px; cursor: pointer; }
.paragraph-skip-btn:hover:not(:disabled) { border-color: rgba(148,163,184,.62); color: #cbd5e1; }
.paragraph-skip-btn.active { border-color: rgba(148,163,184,.58); background: rgba(148,163,184,.12); color: #cbd5e1; }
.paragraph-skip-btn:disabled { opacity: .48; cursor: not-allowed; }
.paragraph-body { display: flex; flex-direction: column; }
.paragraph-skip-notice { align-self: flex-start; margin-bottom: 3px; padding: 2px 7px; border: 1px solid rgba(148,163,184,.28); border-radius: var(--radius-sm); background: rgba(148,163,184,.08); color: #cbd5e1; font-size: 11px; font-weight: 600; }
.sentence-segment { padding: 6px 0 2px; transition: background 0.2s; position: relative; }
.sentence-segment.seq-active { background: rgba(0,212,170,.06); border-left: 2px solid var(--accent-cyan); padding-left: 10px; }
.sentence-segment.role-pointed { background: rgba(var(--rc, 0,212,170), .06); padding-left: 10px; }
.sentence-segment.role-pointed::before { content: ''; position: absolute; left: -22px; top: 50%; transform: translateY(-50%); width: 0; height: 0; border-top: 8px solid transparent; border-bottom: 8px solid transparent; border-left: 12px solid rgba(var(--rc, 0,212,170), .7); filter: drop-shadow(0 0 3px rgba(var(--rc, 0,212,170), .4)); }
.sentence-segment + .sentence-segment { border-top: 1px solid rgba(255,255,255,.04); }
.next-role-btn { position: absolute; right: 4px; top: 4px; height: 22px; padding: 0 8px; border: 1px solid rgba(var(--rc, 0,212,170), .45); border-radius: var(--radius-sm); background: rgba(18,22,25,.95); color: rgba(var(--rc, 0,212,170), 1); font-size: 10px; font-weight: 600; cursor: pointer; transition: all 0.15s; z-index: 5; white-space: nowrap; backdrop-filter: blur(4px); animation: fadeInBtn 0.15s ease; }
.next-role-btn:hover { background: rgba(var(--rc, 0,212,170), .15); border-color: rgba(var(--rc, 0,212,170), .7); }
.next-role-btn.last { cursor: default; color: var(--text-muted); border-color: var(--border-color); }
@keyframes fadeInBtn { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } }
.segment-text { margin: 0; color: var(--text-primary); font-size: 14px; line-height: 1.85; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.text-piece { border-radius: 2px; }
.annotation-highlight { --rc: 0,212,170; border-radius: 3px; padding: 1px 2px; background: linear-gradient(135deg, rgba(var(--rc), .22) 0%, rgba(var(--rc), .08) 100%); border-bottom: 2px solid rgba(var(--rc), .55); color: var(--text-primary); cursor: pointer; transition: opacity 0.2s, background 0.2s; }
.annotation-highlight.confirmed { border-bottom-style: solid; border-bottom-width: 2px; box-shadow: inset 0 -1px 0 rgba(var(--rc), .2); }
.annotation-highlight.active { outline: 1px solid rgba(var(--rc), .8); background: linear-gradient(135deg, rgba(var(--rc), .32) 0%, rgba(var(--rc), .16) 100%); }
.annotation-highlight.draft { --rc: 245,158,11; color: #ffe2a8; outline: 1px solid rgba(245,158,11,.45); }
.annotation-highlight.role-highlighted { background: linear-gradient(135deg, rgba(var(--rc), .36) 0%, rgba(var(--rc), .18) 100%); outline: 1px solid rgba(var(--rc), .6); }
.annotation-highlight.role-dimmed { opacity: 0.3; }
.role-label { display: inline-block; padding: 0 5px; margin-right: 4px; border-radius: 3px; font-size: 10px; font-weight: 600; line-height: 18px; color: #fff; vertical-align: middle; white-space: nowrap; user-select: none; }
.emotion-chip { display: inline-flex; align-items: center; justify-content: center; max-width: 96px; height: 18px; margin-right: 4px; padding: 0 6px; border: 1px solid rgba(var(--rc), .42); border-radius: 3px; background: rgba(18,22,25,.76); color: rgba(var(--rc), 1); font-size: 10px; font-weight: 600; line-height: 18px; vertical-align: middle; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.emotion-chip.empty { border-style: dashed; color: var(--text-muted); background: rgba(255,255,255,.035); }
.emotion-chip.active, .emotion-chip:hover:not(:disabled) { border-color: rgba(var(--rc), .82); background: rgba(var(--rc), .16); color: var(--text-primary); }
.emotion-chip:disabled { opacity: .55; cursor: not-allowed; }
.segment-audio-block { margin-top: 4px; margin-bottom: 2px; }
.segment-audio-row { display: grid; grid-template-columns: minmax(0, 1fr) 30px; gap: 6px; align-items: center; }
.segment-audio { background: rgba(255,255,255,.03) !important; }
.segment-audio.seq-highlight { border-color: rgba(0, 212, 170, 0.35) !important; }
.segment-audio.is-stale { border-color: rgba(250,204,21,.28) !important; }
.audio-edit-btn { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(0,212,170,.32); border-radius: var(--radius-sm); background: rgba(0,212,170,.06); color: var(--accent-cyan); cursor: pointer; transition: all .18s; }
.audio-edit-btn:hover { border-color: var(--accent-cyan); background: rgba(0,212,170,.14); }
.stale-audio-notice { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 4px; padding: 5px 8px; border: 1px solid rgba(250,204,21,.24); border-radius: var(--radius-sm); background: rgba(250,204,21,.06); }
.stale-copy { min-width: 0; display: flex; align-items: center; gap: 7px; color: var(--text-secondary); font-size: 12px; line-height: 1.4; }
.stale-copy > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stale-audio-notice .issue-status { color: #fde047; }
.audio-issue { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 4px; margin-bottom: 2px; padding: 6px 9px; border: 1px solid rgba(245,158,11,.28); border-radius: var(--radius-sm); background: rgba(245,158,11,.07); }
.audio-issue.missing { border-color: rgba(148,163,184,.18); background: rgba(148,163,184,.035); }
.audio-issue.stale { border-color: rgba(250,204,21,.28); background: rgba(250,204,21,.07); }
.audio-issue.failed { border-color: rgba(248,113,113,.32); background: rgba(248,113,113,.08); }
.audio-issue.skipped { border-color: rgba(148,163,184,.28); background: rgba(148,163,184,.07); }
.issue-main { min-width: 0; display: flex; align-items: center; gap: 7px; color: var(--text-secondary); font-size: 12px; line-height: 1.4; }
.issue-main strong { color: var(--text-primary); flex-shrink: 0; }
.issue-main small { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.issue-status { flex-shrink: 0; padding: 1px 5px; border-radius: var(--radius-sm); background: rgba(0,0,0,.16); color: #f8c16c; font-size: 10px; font-weight: 600; line-height: 18px; }
.audio-issue.missing .issue-status { background: rgba(148,163,184,.1); color: #94a3b8; font-weight: 500; }
.audio-issue.stale .issue-status { color: #fde047; }
.audio-issue.failed .issue-status { color: #fca5a5; }
.audio-issue.skipped .issue-status { color: #cbd5e1; }
.issue-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.issue-btn { height: 24px; padding: 0 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); font-size: 11px; cursor: pointer; }
.issue-btn.primary { border-color: rgba(0,212,170,.42); color: var(--accent-cyan); }
.issue-btn:hover:not(:disabled) { border-color: var(--accent-cyan); color: var(--accent-cyan); }
.issue-btn:disabled { opacity: .45; cursor: not-allowed; }
.inline-empty { min-height: 160px; height: auto; border-bottom: 1px solid var(--border-color); }
.theme-modal-backdrop { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: var(--space-4); background: rgba(0,0,0,.68); backdrop-filter: blur(6px); }
.theme-dialog { width: min(420px, 100%); border: 1px solid var(--border-focus); border-radius: var(--radius-md); background: var(--bg-panel); box-shadow: 0 18px 60px rgba(0,0,0,.45); overflow: hidden; }
.warning-dialog { border-color: rgba(245,158,11,.46); }
.theme-dialog-header { display: flex; justify-content: space-between; gap: var(--space-3); padding: var(--space-4); border-bottom: 1px solid var(--border-color); background: linear-gradient(180deg, rgba(245,158,11,.12), rgba(255,255,255,.02)); }
.theme-dialog-header h3 { margin: 0; color: var(--text-primary); font-size: 16px; }
.theme-dialog-header span { display: block; margin-top: 4px; color: #f59e0b; font-size: 10px; letter-spacing: .08em; }
.dialog-close { width: 26px; height: 26px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); cursor: pointer; }
.theme-dialog-message { margin: 0; padding: var(--space-4) var(--space-4) var(--space-2); color: var(--text-secondary); font-size: 13px; line-height: 1.7; }
.warning-list { display: grid; gap: 6px; padding: 0 var(--space-4) var(--space-4); }
.warning-list span { padding: 7px 9px; border: 1px solid rgba(245,158,11,.2); border-radius: var(--radius-sm); background: rgba(245,158,11,.07); color: var(--text-muted); font-size: 12px; }
.theme-dialog-actions { display: flex; justify-content: flex-end; gap: var(--space-2); padding: var(--space-3) var(--space-4); border-top: 1px solid var(--border-color); background: rgba(255,255,255,.02); }
.btn-cancel, .btn-confirm { height: 30px; padding: 0 14px; border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; }
.btn-cancel { border: 1px solid var(--border-color); background: transparent; color: var(--text-secondary); }
.btn-confirm { border: 1px solid rgba(245,158,11,.72); background: rgba(245,158,11,.18); color: #f8c16c; }
@media (max-width: 720px) {
  .panel-header { height: auto; min-height: 48px; align-items: flex-start; padding-top: 8px; padding-bottom: 8px; gap: var(--space-2); }
  .paragraph-row { grid-template-columns: 32px minmax(0, 1fr); gap: var(--space-2); padding-right: 10px; }
  .audio-issue { align-items: flex-start; flex-direction: column; }
}
</style>
