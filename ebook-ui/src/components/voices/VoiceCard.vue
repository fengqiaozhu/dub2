<script setup lang="ts">
import { computed } from 'vue';
import AudioTrack from '@/components/common/AudioTrack.vue';

const props = defineProps<{
  voice: {
    voice_id?: string;
    displayName?: string;
    status?: string;
    avatarChar?: string;
    audioSampleUrl?: string;
    previewAudioUrl?: string;
    description?: string;
    gender?: string;
    ageRange?: string;
    language?: string;
    accent?: string;
    speed?: number;
    pitch?: number;
    visibility?: string;
    apiPublished?: boolean;
    createdAt?: string;
    category?: string;
  };
  isPlaying: boolean;
}>();

const emit = defineEmits(['toggle-play']);

// 头像颜色（根据名称 hash 固定分配）
const hashCode = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
};

const avatarColor = computed(() => {
  const name = props.voice.displayName || 'U';
  const colors = ['#00d4aa', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6'];
  const index = Math.abs(hashCode(name)) % colors.length;
  return colors[index];
});

const audioSrc = computed(() => props.voice.audioSampleUrl || props.voice.previewAudioUrl || '');

// 性别标签
const genderLabel = computed(() => {
  const map: Record<string, string> = { male: '♂ 男声', female: '♀ 女声', neutral: '⊙ 中性' };
  return props.voice.gender ? (map[props.voice.gender] ?? props.voice.gender) : null;
});

// 年龄段标签
const ageRangeLabel = computed(() => {
  const map: Record<string, string> = { child: '儿童', teen: '青少年', adult: '成人', senior: '老年' };
  return props.voice.ageRange ? (map[props.voice.ageRange] ?? props.voice.ageRange) : null;
});

// 语言/口音标签
const langLabel = computed(() => {
  if (!props.voice.language) return null;
  const lang = props.voice.language.toUpperCase();
  const accentMap: Record<string, string> = { standard: '标准', regional: '方言' };
  const accent = props.voice.accent ? (accentMap[props.voice.accent] ?? props.voice.accent) : null;
  return accent ? `${lang} · ${accent}` : lang;
});

// 状态
const isActive = computed(() => props.voice.status === 'active');

// 创建时间格式化
const createdDate = computed(() => {
  if (!props.voice.createdAt) return null;
  const d = new Date(props.voice.createdAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});
</script>

<template>
  <div class="voice-card" :class="{ 'is-active': isPlaying }">
    <!-- 头部：头像 + 名称 + 状态角标 -->
    <div class="card-header">
      <div class="avatar" :style="{ backgroundColor: avatarColor }">
        {{ voice.avatarChar }}
      </div>
      <div class="voice-info">
        <div class="voice-name-row">
          <h4 class="voice-name">{{ voice.displayName }}</h4>
          <span class="status-dot" :class="{ active: isActive }" :title="isActive ? '正常' : voice.status"></span>
        </div>
        <div class="badge-row">
          <span v-if="langLabel" class="badge badge-lang">{{ langLabel }}</span>
        </div>
      </div>
    </div>

    <!-- 描述 -->
    <p v-if="voice.description" class="voice-desc-text">{{ voice.description }}</p>

    <!-- 标签行：性别 / 年龄 -->
    <div class="tag-row" v-if="genderLabel || ageRangeLabel">
      <span v-if="genderLabel" class="tag">{{ genderLabel }}</span>
      <span v-if="ageRangeLabel" class="tag">{{ ageRangeLabel }}</span>
    </div>

    <!-- 音轨播放器 -->
    <AudioTrack
      :src="audioSrc"
      :active="isPlaying"
      :filename="(voice.displayName || 'voice') + '.wav'"
      :show-download="true"
      @activate="emit('toggle-play')"
      @deactivate="emit('toggle-play')"
    />

    <!-- 底部：创建时间 -->
    <div class="card-footer" v-if="createdDate">
      <span class="created-at mono-text">{{ createdDate }}</span>
    </div>
  </div>
</template>

<style scoped>
.voice-card {
  background-color: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.voice-card:hover {
  border-color: var(--border-focus);
}

.voice-card.is-active {
  border-color: var(--accent-cyan);
  box-shadow: 0 0 0 1px rgba(0, 212, 170, 0.2);
}

/* ── 头部 ─────────────────────────── */
.card-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.avatar {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  color: #fff;
  font-weight: 700;
  font-size: 14px;
}

.voice-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.voice-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.voice-name {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
  background-color: var(--border-focus);
}

.status-dot.active {
  background-color: #22c55e;
  box-shadow: 0 0 4px rgba(34, 197, 94, 0.6);
}

.badge-row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.badge {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.4px;
  padding: 2px 5px;
  border-radius: 3px;
  line-height: 1.4;
}

.badge-lang {
  background-color: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.25);
  font-family: var(--font-mono, monospace);
}

/* ── 描述 ─────────────────────────── */
.voice-desc-text {
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── 标签行 ───────────────────────── */
.tag-row {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}

.tag {
  font-size: 10px;
  color: var(--text-secondary);
  background-color: var(--bg-input);
  border: 1px solid var(--border-color);
  padding: 2px 7px;
  border-radius: 20px;
  white-space: nowrap;
}

/* ── 底部 ─────────────────────────── */
.card-footer {
  display: flex;
  justify-content: flex-end;
}

.created-at {
  font-size: 10px;
  color: var(--text-muted);
}
</style>
