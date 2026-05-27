<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';

interface CutRegion {
  id: string;
  start: number;
  end: number;
}

interface WaveRegion {
  id: string;
  start: number;
  end: number;
  remove: () => void;
  setOptions: (options: { color?: string; content?: string }) => void;
}

const props = defineProps<{
  open: boolean;
  src: string;
  title?: string;
  subtitle?: string;
  saving?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  save: [payload: { blob: Blob; duration: number }];
}>();

const wavePanelRef = ref<HTMLElement | null>(null);
const waveRef = ref<HTMLElement | null>(null);
const overviewRef = ref<HTMLElement | null>(null);
const isReady = ref(false);
const isLoading = ref(false);
const isProcessing = ref(false);
const isPlaying = ref(false);
const errorMessage = ref('');
const duration = ref(0);
const currentTime = ref(0);
const activeRegionId = ref<string | null>(null);
const cutRegions = ref<CutRegion[]>([]);
const zoomLevel = ref(1);
const fitPxPerSec = ref(24);
const currentPxPerSec = computed(() => fitPxPerSec.value * zoomLevel.value);
const canPanWaveform = computed(() => zoomLevel.value > 1.02);
const viewportStart = ref(0);
const viewportEnd = ref(0);
const isTimelineDragging = ref(false);
const viewportStyle = computed(() => {
  const total = duration.value || 1;
  const left = Math.max(0, Math.min(100, (viewportStart.value / total) * 100));
  const width = Math.max(2, Math.min(100 - left, ((viewportEnd.value - viewportStart.value) / total) * 100));
  return { left: `${left}%`, width: `${width}%` };
});
const overviewTicks = computed(() => {
  const total = duration.value;
  if (!total || !isFinite(total)) return [];
  const rawStep = total / 6;
  const niceSteps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const step = niceSteps.find(item => item >= rawStep) || niceSteps[niceSteps.length - 1];
  const ticks: Array<{ time: number; left: string; label: string; major: boolean }> = [];
  for (let time = 0; time <= total + 0.001; time += step) {
    ticks.push({
      time,
      left: `${Math.min(100, (time / total) * 100)}%`,
      label: fmtTick(time),
      major: true
    });
  }
  if (ticks[ticks.length - 1]?.time !== total) {
    ticks.push({ time: total, left: '100%', label: fmtTick(total), major: true });
  }
  return ticks;
});

let wavesurfer: WaveSurfer | null = null;
let regionsPlugin: ReturnType<typeof RegionsPlugin.create> | null = null;
let cleanupEvents: Array<() => void> = [];
let resizeObserver: ResizeObserver | null = null;
let timelineDragStartX = 0;
let timelineDragStartScrollLeft = 0;

const sortedRegions = computed(() =>
  [...cutRegions.value].sort((a, b) => a.start - b.start)
);

const totalCutDuration = computed(() =>
  sortedRegions.value.reduce((sum, region) => sum + Math.max(0, region.end - region.start), 0)
);

const resultDuration = computed(() =>
  Math.max(0, duration.value - totalCutDuration.value)
);

function fmt(seconds: number) {
  if (!isFinite(seconds) || seconds < 0) return '0:00.000';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${mins}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function fmtTick(seconds: number) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function destroyEditor() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  cleanupEvents.forEach(cleanup => cleanup());
  cleanupEvents = [];
  wavesurfer?.destroy();
  wavesurfer = null;
  regionsPlugin = null;
  isReady.value = false;
  isLoading.value = false;
  duration.value = 0;
  currentTime.value = 0;
  activeRegionId.value = null;
  cutRegions.value = [];
  isPlaying.value = false;
  errorMessage.value = '';
  isTimelineDragging.value = false;
  viewportStart.value = 0;
  viewportEnd.value = 0;
}

function computeFitPxPerSec(audioDuration = duration.value) {
  const width = wavePanelRef.value?.clientWidth || waveRef.value?.clientWidth || 640;
  if (!audioDuration || !isFinite(audioDuration)) return 24;
  return Math.max(8, width / audioDuration);
}

function applyZoom(level = zoomLevel.value) {
  if (!wavesurfer || !duration.value) return;
  zoomLevel.value = Math.min(8, Math.max(1, level));
  wavesurfer.zoom(currentPxPerSec.value);
  nextTick(updateViewportRange);
}

function fitZoomToPanel() {
  fitPxPerSec.value = computeFitPxPerSec();
  applyZoom(zoomLevel.value);
}

function resetZoom() {
  applyZoom(1);
}

function updateViewportRange() {
  if (!waveRef.value || !duration.value || !currentPxPerSec.value) {
    viewportStart.value = 0;
    viewportEnd.value = duration.value || 0;
    return;
  }
  const scrollLeft = wavesurfer?.getScroll() || 0;
  const width = wavesurfer?.getWidth() || waveRef.value.clientWidth || 1;
  viewportStart.value = Math.max(0, scrollLeft / currentPxPerSec.value);
  viewportEnd.value = Math.min(duration.value, viewportStart.value + width / currentPxPerSec.value);
}

function waveformScrollLeft() {
  return wavesurfer?.getScroll() || 0;
}

function setWaveformScrollLeft(scrollLeft: number) {
  if (!wavesurfer || !duration.value) return;
  const width = wavesurfer.getWidth() || waveRef.value?.clientWidth || 0;
  const maxScroll = Math.max(0, duration.value * currentPxPerSec.value - width);
  wavesurfer.setScroll(Math.max(0, Math.min(maxScroll, scrollLeft)));
  updateViewportRange();
}

function onWaveScroll() {
  updateViewportRange();
}

function onWaveWheel(event: WheelEvent) {
  if (!wavesurfer || !duration.value || !waveRef.value) return;
  event.preventDefault();
  const rect = waveRef.value.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
  const focusTime = (waveformScrollLeft() + x) / currentPxPerSec.value;
  const direction = event.deltaY > 0 ? -1 : 1;
  const nextZoom = zoomLevel.value * (1 + direction * 0.2);
  applyZoom(nextZoom);
  nextTick(() => {
    setWaveformScrollLeft(focusTime * currentPxPerSec.value - x);
  });
}

function beginTimelineDrag(event: PointerEvent) {
  if (!canPanWaveform.value || event.button !== 0) return;
  event.preventDefault();
  isTimelineDragging.value = true;
  timelineDragStartX = event.clientX;
  timelineDragStartScrollLeft = waveformScrollLeft();
  overviewRef.value?.setPointerCapture(event.pointerId);
  moveTimelineDrag(event);
}

function moveTimelineDrag(event: PointerEvent) {
  if (!isTimelineDragging.value) return;
  event.preventDefault();
  const overviewWidth = overviewRef.value?.clientWidth || 1;
  const viewDuration = Math.max(0, viewportEnd.value - viewportStart.value);
  const rect = overviewRef.value?.getBoundingClientRect();
  const pointerX = rect ? event.clientX - rect.left : 0;
  const initialWindowLeft = (viewportStart.value / (duration.value || 1)) * overviewWidth;
  const dragDelta = event.clientX - timelineDragStartX;
  const isPointerInsideWindow = pointerX >= initialWindowLeft && pointerX <= initialWindowLeft + (viewDuration / (duration.value || 1)) * overviewWidth;
  const targetCenter = isPointerInsideWindow
    ? (timelineDragStartScrollLeft / currentPxPerSec.value) + viewDuration / 2 + (dragDelta / overviewWidth) * (duration.value || 0)
    : (pointerX / overviewWidth) * (duration.value || 0);
  const nextStart = targetCenter - viewDuration / 2;
  setWaveformScrollLeft(nextStart * currentPxPerSec.value);
}

function endTimelineDrag(event: PointerEvent) {
  if (!isTimelineDragging.value) return;
  isTimelineDragging.value = false;
  overviewRef.value?.releasePointerCapture(event.pointerId);
}

function syncRegion(region: WaveRegion) {
  if (!region.end || region.end <= region.start) return;
  const next = {
    id: region.id,
    start: Math.max(0, region.start),
    end: Math.min(duration.value || region.end, region.end)
  };
  const index = cutRegions.value.findIndex(item => item.id === region.id);
  if (index >= 0) {
    cutRegions.value = cutRegions.value.map(item => item.id === region.id ? next : item);
  } else {
    cutRegions.value = [...cutRegions.value, next];
  }
  region.setOptions({
    color: 'rgba(248, 113, 113, 0.22)',
    content: '剪掉'
  });
}

async function createEditor() {
  await nextTick();
  destroyEditor();
  if (!props.open || !props.src || !waveRef.value) return;

  isLoading.value = true;
  const styles = getComputedStyle(waveRef.value);
  const accentColor = styles.getPropertyValue('--accent-cyan').trim() || '#00d4aa';
  const waveColor = styles.getPropertyValue('--border-focus').trim() || '#3f3f46';

  regionsPlugin = RegionsPlugin.create();
  wavesurfer = WaveSurfer.create({
    container: waveRef.value,
    url: props.src,
    height: 128,
    waveColor,
    progressColor: accentColor,
    cursorColor: accentColor,
    cursorWidth: 2,
    barWidth: 2,
    barGap: 1,
    barRadius: 1,
    normalize: true,
    dragToSeek: true,
    hideScrollbar: true,
    minPxPerSec: 8,
    plugins: [
      regionsPlugin
    ]
  });

  cleanupEvents = [
    wavesurfer.on('ready', (readyDuration) => {
      duration.value = readyDuration;
      isReady.value = true;
      isLoading.value = false;
      fitZoomToPanel();
      updateViewportRange();
      resizeObserver = new ResizeObserver(() => {
        const currentWidth = wavesurfer?.getWidth() || waveRef.value?.clientWidth || 0;
        const currentMaxScroll = Math.max(0, readyDuration * currentPxPerSec.value - currentWidth);
        const scrollRatio = currentMaxScroll > 0 ? waveformScrollLeft() / currentMaxScroll : 0;
        fitPxPerSec.value = computeFitPxPerSec(readyDuration);
        applyZoom(zoomLevel.value);
        nextTick(() => {
          if (!waveRef.value) return;
          const width = wavesurfer?.getWidth() || waveRef.value.clientWidth;
          const maxScroll = Math.max(0, readyDuration * currentPxPerSec.value - width);
          setWaveformScrollLeft(maxScroll * scrollRatio);
          updateViewportRange();
        });
      });
      if (wavePanelRef.value) resizeObserver.observe(wavePanelRef.value);
      regionsPlugin?.enableDragSelection({
        color: 'rgba(248, 113, 113, 0.22)'
      });
    }),
    wavesurfer.on('loading', () => {
      isLoading.value = true;
    }),
    wavesurfer.on('timeupdate', (time) => {
      currentTime.value = time;
      skipCutRangeIfNeeded(time);
    }),
    wavesurfer.on('seeking', (time) => {
      currentTime.value = time;
    }),
    wavesurfer.on('scroll', (start, end) => {
      viewportStart.value = start;
      viewportEnd.value = end;
    }),
    wavesurfer.on('play', () => {
      isPlaying.value = true;
    }),
    wavesurfer.on('pause', () => {
      isPlaying.value = false;
    }),
    wavesurfer.on('finish', () => {
      isPlaying.value = false;
      currentTime.value = 0;
    }),
    wavesurfer.on('error', () => {
      errorMessage.value = '音频加载失败';
      isLoading.value = false;
    }),
    regionsPlugin.on('region-created', (region) => {
      syncRegion(region as WaveRegion);
    }),
    regionsPlugin.on('region-updated', (region) => {
      syncRegion(region as WaveRegion);
    }),
    regionsPlugin.on('region-removed', (region) => {
      cutRegions.value = cutRegions.value.filter(item => item.id !== (region as WaveRegion).id);
      if (activeRegionId.value === (region as WaveRegion).id) activeRegionId.value = null;
    }),
    regionsPlugin.on('region-clicked', (region, event) => {
      event.stopPropagation();
      activeRegionId.value = (region as WaveRegion).id;
    })
  ];
}

function close() {
  emit('close');
}

function cutRangeAt(time: number) {
  return sortedRegions.value.find(region => time >= region.start && time < region.end - 0.015);
}

function skipCutRangeIfNeeded(time: number) {
  if (!wavesurfer || !isPlaying.value) return;
  const range = cutRangeAt(time);
  if (!range) return;
  const nextTime = Math.min(duration.value, range.end + 0.01);
  wavesurfer.setTime(nextTime);
  currentTime.value = nextTime;
}

async function togglePreviewPlay() {
  if (!wavesurfer || !isReady.value) return;
  if (isPlaying.value) {
    wavesurfer.pause();
    return;
  }
  const range = cutRangeAt(currentTime.value);
  if (range) {
    wavesurfer.setTime(Math.min(duration.value, range.end + 0.01));
  }
  await wavesurfer.play();
}

function addQuickCut() {
  if (!regionsPlugin || !duration.value) return;
  const center = currentTime.value || 0;
  const start = Math.max(0, center - 0.5);
  const end = Math.min(duration.value, center + 0.5);
  const region = regionsPlugin.addRegion({
    start,
    end,
    color: 'rgba(248, 113, 113, 0.22)',
    drag: true,
    resize: true,
    content: '剪掉'
  });
  activeRegionId.value = region.id;
}

function removeRegion(regionId: string) {
  const region = regionsPlugin?.getRegions().find(item => item.id === regionId) as WaveRegion | undefined;
  region?.remove();
}

function clearRegions() {
  regionsPlugin?.clearRegions();
  cutRegions.value = [];
  activeRegionId.value = null;
}

function normalizeCutRanges(audioDuration: number) {
  const ranges: CutRegion[] = [];
  for (const region of sortedRegions.value) {
    const start = Math.max(0, Math.min(audioDuration, region.start));
    const end = Math.max(start, Math.min(audioDuration, region.end));
    if (end - start < 0.01) continue;
    const previous = ranges[ranges.length - 1];
    if (previous && start <= previous.end) {
      previous.end = Math.max(previous.end, end);
    } else {
      ranges.push({ id: region.id, start, end });
    }
  }
  return ranges;
}

function encodeWav(buffer: AudioBuffer) {
  const channelCount = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const samples = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = samples * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples; i++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i] || 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

async function buildTrimmedWav() {
  const response = await fetch(props.src);
  if (!response.ok) throw new Error('fetch failed');
  const sourceBuffer = await response.arrayBuffer();
  const AudioContextClass = window.AudioContext || (window as unknown as {
    webkitAudioContext: typeof AudioContext;
  }).webkitAudioContext;
  const audioContext = new AudioContextClass();
  const decoded = await audioContext.decodeAudioData(sourceBuffer.slice(0));
  const ranges = normalizeCutRanges(decoded.duration);
  const keepSegments: Array<{ start: number; end: number }> = [];
  let cursor = 0;

  for (const range of ranges) {
    if (range.start > cursor) keepSegments.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < decoded.duration) keepSegments.push({ start: cursor, end: decoded.duration });

  const outputLength = Math.max(1, keepSegments.reduce((sum, segment) => (
    sum + Math.round((segment.end - segment.start) * decoded.sampleRate)
  ), 0));
  const output = audioContext.createBuffer(decoded.numberOfChannels, outputLength, decoded.sampleRate);
  let writeOffset = 0;

  for (const segment of keepSegments) {
    const startFrame = Math.round(segment.start * decoded.sampleRate);
    const endFrame = Math.round(segment.end * decoded.sampleRate);
    const frameCount = Math.max(0, endFrame - startFrame);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const source = decoded.getChannelData(channel).subarray(startFrame, endFrame);
      output.getChannelData(channel).set(source, writeOffset);
    }
    writeOffset += frameCount;
  }

  const blob = encodeWav(output);
  await audioContext.close();
  return { blob, duration: output.duration };
}

async function saveTrimmedAudio() {
  if (!props.src || cutRegions.value.length === 0 || isProcessing.value || props.saving) return;
  isProcessing.value = true;
  errorMessage.value = '';
  try {
    const result = await buildTrimmedWav();
    emit('save', result);
  } catch {
    errorMessage.value = '保存失败，请确认音频文件可访问';
  } finally {
    isProcessing.value = false;
  }
}

watch(() => [props.open, props.src] as const, () => {
  if (props.open) {
    createEditor();
  } else {
    destroyEditor();
  }
});

onBeforeUnmount(() => {
  destroyEditor();
});
</script>

<template>
  <div v-if="open" class="audio-editor-backdrop" @click.self="close">
    <div class="audio-editor-dialog">
      <div class="audio-editor-header">
        <div class="title-group">
          <h3>{{ title || '音频编辑' }}</h3>
          <span>{{ subtitle || '切片编辑' }}</span>
        </div>
        <button class="icon-btn" type="button" title="关闭" @click="close">×</button>
      </div>

      <div class="editor-main">
        <div
          ref="wavePanelRef"
          class="wave-panel"
          @wheel="onWaveWheel"
        >
          <div ref="waveRef" class="editor-waveform" @scroll="onWaveScroll" />
          <div
            ref="overviewRef"
            class="timeline-overview"
            :class="{ active: isTimelineDragging || canPanWaveform, dragging: isTimelineDragging, pannable: canPanWaveform }"
            @pointerdown="beginTimelineDrag"
            @pointermove="moveTimelineDrag"
            @pointerup="endTimelineDrag"
            @pointercancel="endTimelineDrag"
            @pointerleave="endTimelineDrag"
          >
            <div
              v-for="tick in overviewTicks"
              :key="tick.time"
              class="overview-tick"
              :class="{ major: tick.major }"
              :style="{ left: tick.left }"
            >
              <span>{{ tick.label }}</span>
            </div>
            <div class="timeline-window" :style="viewportStyle">
              <div class="window-edge left" />
              <div class="window-edge right" />
            </div>
          </div>
          <div v-if="isLoading" class="wave-overlay">加载中...</div>
          <div v-if="errorMessage" class="wave-overlay error">{{ errorMessage }}</div>
        </div>

        <div class="editor-toolbar">
          <button class="tool-btn primary" type="button" :disabled="!isReady" @click="togglePreviewPlay">
            {{ isPlaying ? '暂停' : '试听' }}
          </button>
          <button class="tool-btn" type="button" :disabled="!isReady" @click="addQuickCut">
            添加 1 秒切片
          </button>
          <button class="tool-btn danger" type="button" :disabled="cutRegions.length === 0" @click="clearRegions">
            清空切片
          </button>
          <button class="zoom-reset" type="button" :disabled="!isReady || zoomLevel === 1" @click="resetZoom">适配</button>
          <span class="zoom-readout mono-text">{{ Math.round(zoomLevel * 100) }}%</span>
          <span class="time-readout mono-text">{{ fmt(currentTime) }} / {{ fmt(duration) }}</span>
        </div>

        <div class="editor-summary">
          <span>切掉 {{ fmt(totalCutDuration) }}</span>
          <span>预计保留 {{ fmt(resultDuration) }}</span>
          <span>{{ cutRegions.length }} 个片段</span>
        </div>

        <div class="region-list" v-if="sortedRegions.length > 0">
          <div
            class="region-row"
            :class="{ active: activeRegionId === region.id }"
            v-for="(region, index) in sortedRegions"
            :key="region.id"
          >
            <span class="region-index mono-text">#{{ index + 1 }}</span>
            <span class="region-time mono-text">{{ fmt(region.start) }} - {{ fmt(region.end) }}</span>
            <span class="region-duration mono-text">{{ fmt(region.end - region.start) }}</span>
            <button class="row-btn danger" type="button" @click="removeRegion(region.id)">删除</button>
          </div>
        </div>
        <div class="empty-regions" v-else>
          暂无切片
        </div>
      </div>

      <div class="audio-editor-footer">
        <span class="footer-note">保存会覆盖当前对白音频。</span>
        <div class="footer-actions">
          <button class="export-btn" type="button" :disabled="!isReady || cutRegions.length === 0 || isProcessing || saving" @click="saveTrimmedAudio">
            {{ saving ? '保存中...' : '保存并覆盖' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.audio-editor-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, .72);
  backdrop-filter: blur(6px);
}

.audio-editor-dialog {
  width: min(920px, 100%);
  max-height: min(760px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-focus);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  box-shadow: 0 24px 80px rgba(0, 0, 0, .5);
  overflow: hidden;
}

.audio-editor-header,
.audio-editor-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color);
}

.audio-editor-footer {
  border-top: 1px solid var(--border-color);
  border-bottom: 0;
  background: rgba(255, 255, 255, .02);
}

.title-group {
  min-width: 0;
}

.title-group h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 16px;
  line-height: 1.4;
}

.title-group span,
.footer-note {
  display: block;
  color: var(--text-muted);
  font-size: 12px;
}

.icon-btn {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
}

.icon-btn:hover {
  border-color: var(--accent-cyan);
  color: var(--accent-cyan);
}

.editor-main {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}

.wave-panel {
  position: relative;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  overflow: hidden;
  user-select: none;
  touch-action: pan-y;
}

.editor-waveform {
  min-height: 128px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.timeline-overview {
  position: relative;
  height: 34px;
  border-top: 1px solid var(--border-color);
  background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.02));
  opacity: .84;
  cursor: default;
  overflow: hidden;
  transition: opacity .16s;
}

.timeline-overview.pannable {
  cursor: grab;
}

.timeline-overview.dragging {
  cursor: grabbing;
}

.timeline-overview.active {
  opacity: 1;
}

.overview-tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(255,255,255,.16);
  transform: translateX(-.5px);
  pointer-events: none;
}

.overview-tick span {
  position: absolute;
  bottom: 3px;
  left: 4px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  white-space: nowrap;
}

.timeline-window {
  position: absolute;
  top: 0;
  bottom: 0;
  border-left: 1px solid rgba(0, 212, 170, .9);
  border-right: 1px solid rgba(0, 212, 170, .9);
  background: rgba(0, 212, 170, .16);
  box-shadow: inset 0 0 0 1px rgba(0, 212, 170, .18), 0 0 12px rgba(0, 212, 170, .13);
  pointer-events: none;
}

.window-edge {
  position: absolute;
  top: 5px;
  bottom: 5px;
  width: 2px;
  background: rgba(0, 212, 170, .9);
}

.window-edge.left { left: 2px; }
.window-edge.right { right: 2px; }

.editor-waveform::-webkit-scrollbar {
  display: none;
}

.editor-waveform :deep(*)::part(scroll) {
  scrollbar-width: none;
}

.editor-waveform :deep(*)::part(scroll)::-webkit-scrollbar {
  display: none;
  -webkit-appearance: none;
}

.wave-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(13, 13, 15, .72);
  color: var(--text-secondary);
  font-size: 13px;
}

.wave-overlay.error {
  color: #fca5a5;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.tool-btn,
.row-btn,
.export-btn,
.download-link {
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 11px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  text-decoration: none;
  cursor: pointer;
  white-space: nowrap;
}

.tool-btn.primary,
.export-btn,
.download-link {
  border-color: rgba(0, 212, 170, .45);
  color: var(--accent-cyan);
}

.tool-btn.active {
  border-color: rgba(0, 212, 170, .58);
  background: rgba(0, 212, 170, .12);
  color: var(--accent-cyan);
}

.tool-btn.danger,
.row-btn.danger {
  border-color: rgba(248, 113, 113, .36);
  color: #fca5a5;
}

.tool-btn:hover:not(:disabled),
.row-btn:hover,
.export-btn:hover:not(:disabled),
.download-link:hover {
  border-color: var(--accent-cyan);
  color: var(--accent-cyan);
  background: rgba(0, 212, 170, .08);
}

.tool-btn:disabled,
.export-btn:disabled {
  opacity: .45;
  cursor: not-allowed;
}

.zoom-readout {
  height: 30px;
  display: inline-flex;
  align-items: center;
  color: var(--text-muted);
  font-size: 11px;
}

.zoom-control {
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, .025);
}

.zoom-control span {
  color: var(--text-muted);
  font-size: 10px;
}

.zoom-control input {
  width: 112px;
  accent-color: var(--accent-cyan);
}

.zoom-reset {
  height: 22px;
  padding: 0 7px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.zoom-reset:hover:not(:disabled) {
  border-color: var(--accent-cyan);
  color: var(--accent-cyan);
}

.zoom-reset:disabled {
  opacity: .45;
  cursor: not-allowed;
}

.time-readout {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 11px;
}

.editor-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.editor-summary span {
  padding: 4px 8px;
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, .03);
  color: var(--text-secondary);
  font-size: 12px;
}

.region-list {
  display: grid;
  gap: 6px;
  margin-top: 12px;
}

.region-row {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) 92px auto;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 5px 7px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, .025);
}

.region-row.active {
  border-color: rgba(0, 212, 170, .46);
  background: rgba(0, 212, 170, .07);
}

.region-index,
.region-time,
.region-duration {
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}

.region-time {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-regions {
  margin-top: 12px;
  padding: 14px;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

@media (max-width: 720px) {
  .audio-editor-backdrop {
    padding: 12px;
  }

  .audio-editor-header,
  .audio-editor-footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .region-row {
    grid-template-columns: 40px minmax(0, 1fr) auto;
  }

  .region-duration {
    display: none;
  }
}
</style>
