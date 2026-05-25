<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import WaveSurfer from 'wavesurfer.js';

const props = defineProps<{
  src: string;
  active?: boolean;
  filename?: string;
  showDownload?: boolean;
}>();

const emit = defineEmits<{
  activate: [];
  deactivate: [];
}>();

const waveRef = ref<HTMLElement | null>(null);
const currentTime = ref(0);
const duration = ref(0);
const isLoading = ref(false);
const isReady = ref(false);
const hasError = ref(false);

let wavesurfer: WaveSurfer | null = null;
let cleanupEvents: Array<() => void> = [];
let createId = 0;

const destroyWaveSurfer = () => {
  cleanupEvents.forEach(cleanup => cleanup());
  cleanupEvents = [];
  wavesurfer?.destroy();
  wavesurfer = null;
};

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

const timeLabel = computed(() => (
  duration.value ? `${fmt(currentTime.value)} / ${fmt(duration.value)}` : '--:--'
));

const showDl = computed(() => props.showDownload !== false && !!props.src);
const dlName = computed(() => props.filename || 'audio.wav');

const resetState = () => {
  currentTime.value = 0;
  duration.value = 0;
  isReady.value = false;
  hasError.value = false;
  isLoading.value = !!props.src;
};

const playFromStart = async (restart = true) => {
  if (!wavesurfer || !props.src || hasError.value) return;
  try {
    if (restart) wavesurfer.setTime(0);
    isLoading.value = !isReady.value;
    await wavesurfer.play();
    isLoading.value = false;
  } catch {
    isLoading.value = false;
    emit('deactivate');
  }
};

const stopAndReset = () => {
  if (!wavesurfer) return;
  wavesurfer.pause();
  wavesurfer.setTime(0);
  currentTime.value = 0;
};

const createWaveSurfer = async () => {
  const currentCreateId = ++createId;
  await nextTick();
  if (currentCreateId !== createId) return;

  destroyWaveSurfer();
  resetState();

  const container = waveRef.value;
  if (!container || !props.src) {
    isLoading.value = false;
    return;
  }

  const styles = getComputedStyle(container);
  const accentColor = styles.getPropertyValue('--accent-cyan').trim() || '#00d4aa';
  const waveColor = styles.getPropertyValue('--border-focus').trim() || '#3a4560';

  wavesurfer = WaveSurfer.create({
    container,
    url: props.src,
    height: 28,
    waveColor,
    progressColor: accentColor,
    cursorColor: accentColor,
    cursorWidth: 2,
    barWidth: 2,
    barGap: 2,
    barRadius: 1,
    barMinHeight: 2,
    normalize: true,
    dragToSeek: true,
    hideScrollbar: true,
  });

  cleanupEvents = [
    wavesurfer.on('ready', (readyDuration) => {
      duration.value = readyDuration;
      isReady.value = true;
      isLoading.value = false;
      if (props.active) playFromStart(false);
    }),
    wavesurfer.on('loading', () => {
      isLoading.value = true;
    }),
    wavesurfer.on('timeupdate', (time) => {
      currentTime.value = time;
    }),
    wavesurfer.on('seeking', (time) => {
      currentTime.value = time;
    }),
    wavesurfer.on('play', () => {
      isLoading.value = false;
    }),
    wavesurfer.on('finish', () => {
      currentTime.value = 0;
      emit('deactivate');
    }),
    wavesurfer.on('error', () => {
      hasError.value = true;
      isLoading.value = false;
      if (props.active) emit('deactivate');
    }),
  ];
};

const toggle = () => {
  if (!props.src || hasError.value) return;
  props.active ? emit('deactivate') : emit('activate');
};

watch(() => props.src, () => {
  createWaveSurfer();
});

watch(() => props.active, (val) => {
  if (!wavesurfer) return;
  if (val) {
    playFromStart();
  } else {
    stopAndReset();
  }
});

onMounted(() => {
  createWaveSurfer();
});

onBeforeUnmount(() => {
  destroyWaveSurfer();
});
</script>

<template>
  <div
    class="audio-track"
    :class="{ 'is-playing': active, 'no-src': !src, 'has-error': hasError }"
  >
    <button class="play-btn" :disabled="!src || hasError" @click="toggle">
      <svg v-if="isLoading" class="spinner" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="12" cy="12" r="9" stroke-opacity="0.25"/>
        <path d="M12 3a9 9 0 0 1 9 9" stroke-linecap="round"/>
      </svg>
      <svg v-else-if="active" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
        <rect x="6" y="4" width="4" height="16"/>
        <rect x="14" y="4" width="4" height="16"/>
      </svg>
      <svg v-else viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
    </button>

    <div class="track-body">
      <div ref="waveRef" class="waveform" />
      <div v-if="!src" class="track-placeholder mono-text">NO AUDIO</div>
      <div v-else-if="hasError" class="track-placeholder mono-text">LOAD FAILED</div>
    </div>

    <span class="time-label mono-text">{{ timeLabel }}</span>

    <a v-if="showDl" class="dl-btn" :href="src" :download="dlName" title="下载音频" @click.stop>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
    </a>
  </div>
</template>

<style scoped>
.audio-track {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background-color: var(--bg-input, #1a1f2e);
  border: 1px solid var(--border-color, #2a3040);
  border-radius: var(--radius-sm, 4px);
  transition: border-color 0.2s;
  min-width: 0;
}

.audio-track.is-playing { border-color: rgba(0, 212, 170, 0.35); }
.audio-track.no-src { opacity: 0.45; pointer-events: none; }
.audio-track.has-error { border-color: rgba(239, 68, 68, 0.35); }

.play-btn {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: transparent;
  border: 1px solid var(--border-color, #2a3040);
  color: var(--text-secondary, #8899aa);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.18s;
  cursor: pointer;
}

.play-btn:hover:not(:disabled) {
  border-color: var(--accent-cyan, #00d4aa);
  color: var(--accent-cyan, #00d4aa);
  background: rgba(0, 212, 170, 0.08);
}

.audio-track.is-playing .play-btn {
  border-color: var(--accent-cyan, #00d4aa);
  color: var(--accent-cyan, #00d4aa);
  background: rgba(0, 212, 170, 0.1);
}

.play-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.track-body {
  flex: 1;
  min-width: 0;
  height: 28px;
  position: relative;
  border-radius: 3px;
  overflow: hidden;
  background: var(--bg-panel, #161b27);
}

.waveform {
  position: absolute;
  inset: 0;
}

.track-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted, #566070);
  font-size: 10px;
  letter-spacing: 0;
  pointer-events: none;
}

.time-label {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-muted, #566070);
  white-space: nowrap;
  min-width: 68px;
  text-align: right;
}

.dl-btn {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm, 4px);
  border: 1px solid var(--border-color, #2a3040);
  color: var(--text-muted, #566070);
  display: flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  transition: all 0.18s;
}

.dl-btn:hover {
  border-color: var(--text-secondary, #8899aa);
  color: var(--text-primary, #e2e8f0);
}

.spinner { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
